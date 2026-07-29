import { createHash } from "node:crypto";
import type {
  DerivativeContract,
  DerivativeDiscoveryClient,
  DerivativeRight,
} from "./derivativeDiscovery.js";
import type {
  BrokerEnvironment,
  DerivativeComboPreviewResult,
  DerivativePreviewClient,
  TradingDiagnostics,
} from "./derivativePreview.js";
import type { VerticalSpreadKind } from "./verticalSpread.js";

export interface PreviewVerticalRequest {
  accountId: string;
  kind: VerticalSpreadKind;
  assetClass: "OPT" | "FOP";
  underlying: string;
  expiration: string;
  tradingClass?: string;
  exchange?: string;
  longStrike: number;
  shortStrike: number;
  quantity: number;
  priceEffect: "CREDIT" | "DEBIT";
  limit: number;
  tif: "DAY" | "GTC";
  session: "REGULAR" | "OVERNIGHT";
}

export interface SpreadPreviewDto {
  previewId: string;
  createdAt: string;
  expiresAt: string;
  account: { maskedId: string; environment: BrokerEnvironment };
  order: {
    kind: VerticalSpreadKind;
    legs: [
      { side: "LONG"; ratio: 1; contract: DerivativeContract },
      { side: "SHORT"; ratio: -1; contract: DerivativeContract },
    ];
    quantity: number;
    priceEffect: "CREDIT" | "DEBIT";
    limit: number;
    tif: "DAY" | "GTC";
    session: "REGULAR" | "OVERNIGHT";
  };
  whatIf: Omit<DerivativeComboPreviewResult, "accountId" | "environment">;
  submitted: false;
}

interface StoredPreview {
  dto: SpreadPreviewDto;
  accountId: string;
  environment: BrokerEnvironment;
}

function rightForKind(kind: VerticalSpreadKind): DerivativeRight {
  return kind.startsWith("call") ? "CALL" : "PUT";
}

export function maskAccountId(accountId: string): string {
  if (accountId.length <= 4) return `${accountId[0] ?? "*"}***`;
  return `${accountId[0] ?? "*"}***${accountId.slice(-3)}`;
}

/** Short-lived, process-local preview registry reusable by CLI and MCP. */
export class DerivativePreviewService {
  private readonly previews = new Map<string, StoredPreview>();

  constructor(
    private readonly discovery: DerivativeDiscoveryClient,
    private readonly preview: DerivativePreviewClient,
    private readonly now: () => Date = () => new Date(),
    private readonly ttlMs = 5 * 60 * 1000
  ) {}

  getTradingDiagnostics(accountId: string): Promise<TradingDiagnostics> {
    return this.preview.getTradingDiagnostics(accountId);
  }

  async previewVertical(request: PreviewVerticalRequest): Promise<SpreadPreviewDto> {
    if (request.priceEffect === "CREDIT" && !request.kind.endsWith("credit")) {
      throw new Error(`${request.kind} requires a debit limit`);
    }
    if (request.priceEffect === "DEBIT" && !request.kind.endsWith("debit")) {
      throw new Error(`${request.kind} requires a credit limit`);
    }
    const right = rightForKind(request.kind);
    const base = {
      assetClass: request.assetClass,
      underlying: request.underlying,
      expiration: request.expiration,
      right,
      ...(request.tradingClass !== undefined ? { tradingClass: request.tradingClass } : {}),
      ...(request.exchange !== undefined ? { exchange: request.exchange } : {}),
    };
    const [longContract, shortContract] = await Promise.all([
      this.discovery.resolveContract({ ...base, strike: request.longStrike }),
      this.discovery.resolveContract({ ...base, strike: request.shortStrike }),
    ]);
    const result = await this.preview.previewDerivativeCombo({
      accountId: request.accountId,
      legs: [
        { contract: longContract, ratio: 1 },
        { contract: shortContract, ratio: -1 },
      ],
      quantity: request.quantity,
      priceEffect: request.priceEffect,
      limit: request.limit,
      tif: request.tif,
      session: request.session,
    });
    if (result.accountId !== request.accountId) {
      throw new Error("What-If account does not match the requested account");
    }
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + this.ttlMs);
    const material = {
      broker: "ibkr",
      accountId: request.accountId,
      environment: result.environment,
      legs: [
        { identity: longContract.identity, reference: longContract.brokerReference, ratio: 1 },
        { identity: shortContract.identity, reference: shortContract.brokerReference, ratio: -1 },
      ],
      quantity: request.quantity,
      priceEffect: request.priceEffect,
      limit: request.limit,
      tif: request.tif,
      session: request.session,
      createdAt: createdAt.toISOString(),
      whatIf: result,
    };
    const previewId = createHash("sha256").update(JSON.stringify(material)).digest("hex");
    const dto: SpreadPreviewDto = {
      previewId,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      account: { maskedId: maskAccountId(request.accountId), environment: result.environment },
      order: {
        kind: request.kind,
        legs: [
          { side: "LONG", ratio: 1, contract: longContract },
          { side: "SHORT", ratio: -1, contract: shortContract },
        ],
        quantity: request.quantity,
        priceEffect: request.priceEffect,
        limit: request.limit,
        tif: request.tif,
        session: request.session,
      },
      whatIf: {
        accepted: result.accepted,
        submitted: false,
        commission: result.commission,
        initialMargin: result.initialMargin,
        maintenanceMargin: result.maintenanceMargin,
        warnings: result.warnings,
        rejectionReasons: result.rejectionReasons,
        advisoryAssetPermissions: result.advisoryAssetPermissions,
      },
      submitted: false,
    };
    this.previews.set(previewId, {
      dto,
      accountId: request.accountId,
      environment: result.environment,
    });
    return dto;
  }

  validatePreview(
    previewId: string,
    context: { accountId: string; environment: BrokerEnvironment }
  ): SpreadPreviewDto {
    const stored = this.previews.get(previewId);
    if (stored === undefined) throw new Error("Unknown preview ID");
    if (this.now().getTime() >= new Date(stored.dto.expiresAt).getTime()) {
      this.previews.delete(previewId);
      throw new Error("Preview has expired");
    }
    if (stored.accountId !== context.accountId || stored.environment !== context.environment) {
      throw new Error("Preview account or environment does not match");
    }
    if (!stored.dto.whatIf.accepted) {
      throw new Error("Preview was rejected by broker What-If");
    }
    return stored.dto;
  }
}
