import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { SingleSubmissionRecord } from "#src/derivatives/derivativeExecutionService.js";
import {
  FileSingleOrderPreviewStore,
  FileSingleOrderSubmissionStore,
  InMemorySingleOrderPreviewStore,
  InMemorySingleOrderSubmissionStore,
  SingleOrderWorkflow,
  singleOrderPreviewRecordSchema,
  type SingleOrderPreviewDto,
  type SingleOrderPreviewRecord,
  type SingleOrderPreviewStore,
  type SingleOrderSubmissionDto,
  type SingleOrderSubmissionRecord,
  type SingleOrderSubmissionStore,
} from "#src/orders/singleOrderWorkflow.js";
import type { CanonicalEquityIntent, EquityGatewayClient } from "./equityOrder.js";

export type NormalizedEquityTerms =
  | { readonly orderType: "LIMIT"; readonly limit: number }
  | { readonly orderType: "STOP"; readonly stopPrice: number };

/**
 * Raw order-type input before normalization.
 *
 * @remarks
 * CLI passes strings from Commander options; MCP passes typed values from Zod.
 * Both paths converge here for a single validation and discrimination pass.
 */
export interface RawEquityOrderTerms {
  readonly orderType?: string;
  readonly limit?: number;
  readonly stopPrice?: number;
}

/**
 * Validate and discriminate raw order-type inputs into service-ready terms.
 *
 * @remarks
 * Applies the exclusive-price rule: LIMIT requires `limit` and forbids
 * `stopPrice`; STOP requires `stopPrice` and forbids `limit`. Zero, negative,
 * and non-finite prices fail. Defaults to LIMIT when `orderType` is omitted.
 */
export function normalizeEquityOrderTerms(raw: RawEquityOrderTerms): NormalizedEquityTerms {
  const orderType = (raw.orderType ?? "LIMIT").toUpperCase();
  if (orderType !== "LIMIT" && orderType !== "STOP") {
    throw new Error(`Unknown order type '${raw.orderType ?? ""}'. Expected LIMIT or STOP.`);
  }
  if (orderType === "LIMIT") {
    if (raw.stopPrice !== undefined) {
      throw new Error("--stop-price is not valid for LIMIT orders. Use --limit instead.");
    }
    if (raw.limit === undefined) {
      throw new Error("LIMIT orders require --limit <price>.");
    }
    if (!Number.isFinite(raw.limit) || raw.limit <= 0) {
      throw new Error(`Invalid limit price '${String(raw.limit)}'.`);
    }
    return { orderType: "LIMIT", limit: raw.limit };
  }
  // STOP
  if (raw.limit !== undefined) {
    throw new Error("--limit is not valid for STOP orders. Use --stop-price instead.");
  }
  if (raw.stopPrice === undefined) {
    throw new Error("STOP orders require --stop-price <price>.");
  }
  if (!Number.isFinite(raw.stopPrice) || raw.stopPrice <= 0) {
    throw new Error(`Invalid stop price '${String(raw.stopPrice)}'.`);
  }
  return { orderType: "STOP", stopPrice: raw.stopPrice };
}

export type PreviewEquityOrderInput = {
  readonly symbol: string;
  readonly side: "BUY" | "SELL";
  readonly quantity: number;
  readonly tif?: "DAY" | "GTC";
  readonly session?: "REGULAR" | "OVERNIGHT";
} & NormalizedEquityTerms;

export type EquityPreviewRecord = SingleOrderPreviewRecord<CanonicalEquityIntent>;
export type EquityPreviewDto = SingleOrderPreviewDto<CanonicalEquityIntent>;
export type EquitySubmissionRecord = SingleOrderSubmissionRecord<CanonicalEquityIntent>;
export type EquitySubmissionDto = SingleOrderSubmissionDto<CanonicalEquityIntent>;
export type EquityPreviewStore = SingleOrderPreviewStore<CanonicalEquityIntent>;
export type EquitySubmissionStore = SingleOrderSubmissionStore<CanonicalEquityIntent>;

const contractSchema = z.strictObject({
  conid: z.number().int().positive(),
  assetClass: z.literal("STK"),
  symbol: z.string().regex(/^[A-Z0-9][A-Z0-9 .-]{0,31}$/),
  exchange: z.literal("SMART"),
  primaryExchange: z.string().min(1).max(32),
  currency: z.literal("USD"),
});
const sharedIntentFields = {
  contract: contractSchema,
  side: z.enum(["BUY", "SELL"]),
  quantity: z.number().int().positive(),
  tif: z.enum(["DAY", "GTC"]),
  session: z.enum(["REGULAR", "OVERNIGHT"]),
};
export const canonicalEquityIntentSchema = z.discriminatedUnion("orderType", [
  z.strictObject({
    ...sharedIntentFields,
    orderType: z.literal("LMT"),
    limit: z.number().positive(),
  }),
  z.strictObject({
    ...sharedIntentFields,
    orderType: z.literal("STP"),
    stopPrice: z.number().positive(),
  }),
]);

export class InMemoryEquityPreviewStore extends InMemorySingleOrderPreviewStore<CanonicalEquityIntent> {}

export class InMemoryEquitySubmissionStore extends InMemorySingleOrderSubmissionStore<CanonicalEquityIntent> {}

export class FileEquityPreviewStore extends FileSingleOrderPreviewStore<CanonicalEquityIntent> {
  public constructor(
    directory = process.env["HUSKLY_EQUITY_PREVIEW_DIR"] ??
      join(homedir(), ".cache", "huskly-cli", "equity-previews")
  ) {
    super(directory, singleOrderPreviewRecordSchema(canonicalEquityIntentSchema));
  }
}

export class FileEquitySubmissionStore extends FileSingleOrderSubmissionStore<CanonicalEquityIntent> {
  public constructor(
    directory = process.env["HUSKLY_EXECUTION_DIR"] ??
      join(homedir(), ".cache", "huskly-cli", "execution")
  ) {
    super(directory, isEquityIntent, "an equity order");
  }
}

export class EquityOrderService {
  private readonly workflow: SingleOrderWorkflow<CanonicalEquityIntent>;

  public constructor(
    private readonly gateway: EquityGatewayClient,
    previews: EquityPreviewStore,
    submissions: EquitySubmissionStore,
    now?: () => Date,
    ttlMs?: number,
    nonce?: () => string,
    key?: () => string
  ) {
    this.workflow = new SingleOrderWorkflow({
      gateway,
      intentSchema: canonicalEquityIntentSchema,
      previews,
      submissions,
      ...(now === undefined ? {} : { now }),
      ...(ttlMs === undefined ? {} : { ttlMs }),
      ...(nonce === undefined ? {} : { nonce }),
      ...(key === undefined ? {} : { key }),
    });
  }

  public preview(input: PreviewEquityOrderInput): Promise<EquityPreviewDto> {
    const symbol = normalizeSymbol(input.symbol);
    return this.workflow.preview(async () => {
      const contract = await this.gateway.resolveContract(symbol);
      if (contract.symbol !== symbol) throw new Error("Resolved equity symbol does not match");
      return canonicalEquityIntentSchema.parse({
        contract,
        side: input.side,
        quantity: input.quantity,
        tif: input.tif ?? "DAY",
        session: input.session ?? "REGULAR",
        ...normalizedTermsToCanonical(input),
      });
    });
  }

  public submit(input: {
    readonly previewId: string;
    readonly operator: string;
    readonly confirm: boolean;
  }): Promise<EquitySubmissionDto> {
    return this.workflow.submit(input);
  }
}

/** A `single` submission record can hold an equity, forex, or option intent. */
function isEquityIntent(
  intent: SingleSubmissionRecord["canonicalIntent"]
): intent is CanonicalEquityIntent {
  return intent.contract.assetClass === "STK";
}

function normalizeSymbol(value: string): string {
  const symbol = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9 .-]{0,31}$/.test(symbol)) throw new Error("Invalid equity symbol");
  return symbol;
}

function normalizedTermsToCanonical(
  input: NormalizedEquityTerms
): { orderType: "LMT"; limit: number } | { orderType: "STP"; stopPrice: number } {
  if (input.orderType === "STOP") return { orderType: "STP", stopPrice: input.stopPrice };
  return { orderType: "LMT", limit: input.limit };
}
