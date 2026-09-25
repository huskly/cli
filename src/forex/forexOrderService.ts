import { homedir } from "node:os";
import { join } from "node:path";
import type { SingleSubmissionRecord } from "#src/derivatives/derivativeExecutionService.js";
import {
  FileSingleOrderPreviewStore,
  FileSingleOrderSubmissionStore,
  SingleOrderWorkflow,
  singleOrderPreviewRecordSchema,
  type SingleOrderPreviewDto,
  type SingleOrderPreviewStore,
  type SingleOrderSubmissionDto,
  type SingleOrderSubmissionStore,
} from "#src/orders/singleOrderWorkflow.js";
import {
  canonicalForexIntentSchema,
  type CanonicalForexIntent,
  type ForexGatewayClient,
} from "./forexOrder.js";
import { parseForexPair } from "./forexPair.js";

export interface PreviewForexOrderInput {
  /** `USD.JPY`, `USD/JPY`, or `USDJPY`. */
  readonly pair: string;
  readonly side: "BUY" | "SELL";
  /** Whole base-currency units. */
  readonly quantity: number;
  /** Quote-currency price of one base unit. */
  readonly limit: number;
  readonly tif?: "DAY" | "GTC";
}

export type ForexPreviewDto = SingleOrderPreviewDto<CanonicalForexIntent>;
export type ForexSubmissionDto = SingleOrderSubmissionDto<CanonicalForexIntent>;
export type ForexPreviewStore = SingleOrderPreviewStore<CanonicalForexIntent>;
export type ForexSubmissionStore = SingleOrderSubmissionStore<CanonicalForexIntent>;

export class FileForexPreviewStore extends FileSingleOrderPreviewStore<CanonicalForexIntent> {
  public constructor(
    directory = process.env["HUSKLY_FOREX_PREVIEW_DIR"] ??
      join(homedir(), ".cache", "huskly-cli", "forex-previews")
  ) {
    super(directory, singleOrderPreviewRecordSchema(canonicalForexIntentSchema));
  }
}

export class FileForexSubmissionStore extends FileSingleOrderSubmissionStore<CanonicalForexIntent> {
  public constructor(
    directory = process.env["HUSKLY_EXECUTION_DIR"] ??
      join(homedir(), ".cache", "huskly-cli", "execution")
  ) {
    super(directory, isForexIntent, "a forex order");
  }
}

export interface ForexOrderServiceOptions {
  readonly gateway: ForexGatewayClient;
  readonly previews: ForexPreviewStore;
  readonly submissions: ForexSubmissionStore;
  readonly now?: () => Date;
  readonly ttlMs?: number;
  readonly nonce?: () => string;
  readonly key?: () => string;
}

/**
 * Guarded IDEALPRO spot FX LIMIT orders.
 *
 * @remarks
 * The preview/submit flow is the shared single-order workflow. The service
 * adds only pair resolution and the FX order terms. IBKR checks the price
 * increment and the minimum size, and the preview keeps its warnings, for
 * example an odd-lot route for a small order.
 */
export class ForexOrderService {
  private readonly gateway: ForexGatewayClient;
  private readonly workflow: SingleOrderWorkflow<CanonicalForexIntent>;

  public constructor(options: ForexOrderServiceOptions) {
    this.gateway = options.gateway;
    this.workflow = new SingleOrderWorkflow({
      ...options,
      intentSchema: canonicalForexIntentSchema,
    });
  }

  public preview(input: PreviewForexOrderInput): Promise<ForexPreviewDto> {
    const pair = parseForexPair(input.pair);
    if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0)
      throw new Error("FX quantity must be a whole number of base-currency units above zero.");
    if (!Number.isFinite(input.limit) || input.limit <= 0)
      throw new Error(`Invalid limit price '${String(input.limit)}'.`);
    return this.workflow.preview(async () => {
      const contract = await this.gateway.resolveContract(pair.pair);
      if (contract.localSymbol !== pair.pair) throw new Error("Resolved FX pair does not match");
      return {
        contract,
        side: input.side,
        quantity: input.quantity,
        tif: input.tif ?? "DAY",
        orderType: "LMT",
        limit: input.limit,
      };
    });
  }

  public submit(input: {
    readonly previewId: string;
    readonly operator: string;
    readonly confirm: boolean;
  }): Promise<ForexSubmissionDto> {
    return this.workflow.submit(input);
  }
}

function isForexIntent(
  intent: SingleSubmissionRecord["canonicalIntent"]
): intent is CanonicalForexIntent {
  return intent.contract.assetClass === "CASH";
}
