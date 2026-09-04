import { requireObservation } from "#src/brokers/brokerClient.js";
import type { Observation } from "#src/brokers/brokerClient.js";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { PrivateJsonFile } from "#src/storage/privateJsonFile.js";
import type {
  DerivativeContract,
  DerivativeDiscoveryClient,
  DerivativeRight,
} from "./derivativeDiscovery.js";
import type {
  BrokerEnvironment,
  CanonicalComboIntent,
  DerivativeComboPreviewResult,
  DerivativePreviewClient,
  TradingDiagnostics,
} from "./derivativePreview.js";
import type { VerticalSpreadKind } from "./verticalSpread.js";

export interface PreviewVerticalRequest {
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
  account: { maskedId: string | null; environment: BrokerEnvironment };
  order: {
    kind: VerticalSpreadKind;
    gateway: CanonicalComboIntent;
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
  whatIf: Omit<DerivativeComboPreviewResult, "environment">;
  submitted: false;
}

interface StoredPreviewRecord {
  schemaVersion: 1;
  previewId: string;
  createdAt: string;
  expiresAt: string;
  account: { maskedId: string | null; environment: BrokerEnvironment };
  canonicalIntent: CanonicalComboIntent;
  previewResult: DerivativeComboPreviewResult;
}

const marginSchema = z
  .strictObject({ current: z.number(), change: z.number(), after: z.number() })
  .nullable();
const identitySchema = z.strictObject({
  assetClass: z.enum(["OPT", "FOP"]),
  underlying: z.string(),
  expiration: z.string(),
  strike: z.number(),
  right: z.enum(["CALL", "PUT"]),
  tradingClass: z.string(),
  exchange: z.string(),
  multiplier: z.number(),
  settlement: z.string().optional(),
  exerciseStyle: z.string().optional(),
});
const contractSchema = z.strictObject({
  identity: identitySchema,
  brokerReference: z
    .strictObject({ broker: z.enum(["schwab", "ibkr"]), contractId: z.string() })
    .optional(),
});
export const canonicalComboIntentSchema = z.strictObject({
  legs: z.tuple([
    z.strictObject({ contract: contractSchema, ratio: z.literal(1) }),
    z.strictObject({ contract: contractSchema, ratio: z.literal(-1) }),
  ]),
  quantity: z.number().int().positive(),
  tif: z.enum(["DAY", "GTC"]),
  session: z.enum(["REGULAR", "OVERNIGHT"]),
  priceEffect: z.enum(["CREDIT", "DEBIT"]),
  orderType: z.literal("LMT"),
  limit: z.number().positive(),
});
const derivativeComboPreviewResultSchema = z.strictObject({
  environment: z.enum(["live", "paper"]),
  accepted: z.boolean(),
  submitted: z.literal(false),
  commission: z.number().nullable(),
  initialMargin: marginSchema,
  maintenanceMargin: marginSchema,
  warnings: z.array(z.string()),
  rejectionReasons: z.array(z.string()),
  advisoryAssetPermissions: z.array(z.string()),
});
export const spreadPreviewDtoSchema = z.strictObject({
  previewId: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  account: z.strictObject({
    maskedId: z.string().nullable(),
    environment: z.enum(["live", "paper"]),
  }),
  order: z.strictObject({
    kind: z.enum(["call-debit", "call-credit", "put-debit", "put-credit"]),
    gateway: canonicalComboIntentSchema,
    legs: z.tuple([
      z.strictObject({ side: z.literal("LONG"), ratio: z.literal(1), contract: contractSchema }),
      z.strictObject({ side: z.literal("SHORT"), ratio: z.literal(-1), contract: contractSchema }),
    ]),
    quantity: z.number().int().positive(),
    priceEffect: z.enum(["CREDIT", "DEBIT"]),
    limit: z.number().positive(),
    tif: z.enum(["DAY", "GTC"]),
    session: z.enum(["REGULAR", "OVERNIGHT"]),
  }),
  whatIf: z.strictObject({
    accepted: z.boolean(),
    submitted: z.literal(false),
    commission: z.number().nullable(),
    initialMargin: marginSchema,
    maintenanceMargin: marginSchema,
    warnings: z.array(z.string()),
    rejectionReasons: z.array(z.string()),
    advisoryAssetPermissions: z.array(z.string()),
  }),
  submitted: z.literal(false),
});
const storedPreviewRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  previewId: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  account: z.strictObject({
    maskedId: z.string().nullable(),
    environment: z.enum(["live", "paper"]),
  }),
  canonicalIntent: canonicalComboIntentSchema,
  previewResult: derivativeComboPreviewResultSchema,
});

export interface PreviewStore {
  save(previewId: string, preview: StoredPreviewRecord): Promise<void>;
  load(previewId: string): Promise<StoredPreviewRecord | undefined>;
  delete(previewId: string): Promise<void>;
}

export class InMemoryPreviewStore implements PreviewStore {
  private readonly previews = new Map<string, StoredPreviewRecord>();

  save(previewId: string, preview: StoredPreviewRecord): Promise<void> {
    this.previews.set(previewId, preview);
    return Promise.resolve();
  }

  load(previewId: string): Promise<StoredPreviewRecord | undefined> {
    return Promise.resolve(this.previews.get(previewId));
  }

  delete(previewId: string): Promise<void> {
    this.previews.delete(previewId);
    return Promise.resolve();
  }
}

/** Owner-readable preview persistence for separate CLI invocations. */
export class FilePreviewStore implements PreviewStore {
  constructor(
    private readonly directory = process.env["HUSKLY_PREVIEW_DIR"] ??
      join(homedir(), ".cache", "huskly-cli", "previews")
  ) {}

  async save(previewId: string, preview: StoredPreviewRecord): Promise<void> {
    this.assertPreviewId(previewId);
    await this.file(previewId).save(preview);
  }

  async load(previewId: string): Promise<StoredPreviewRecord | undefined> {
    this.assertPreviewId(previewId);
    const parsed = await this.file(previewId).load();
    if (parsed === undefined) {
      return undefined;
    }
    if (parsed.previewId !== previewId) {
      throw new Error("Preview file identity mismatch");
    }
    return parsed;
  }

  async delete(previewId: string): Promise<void> {
    this.assertPreviewId(previewId);
    await this.file(previewId).delete();
  }

  private file(previewId: string): PrivateJsonFile<StoredPreviewRecord> {
    return new PrivateJsonFile({
      directory: this.directory,
      filename: `${previewId}.json`,
      schema: storedPreviewRecordSchema as z.ZodType<StoredPreviewRecord>,
      maxBytes: 128 * 1024,
    });
  }

  private assertPreviewId(previewId: string): void {
    if (!/^[a-f0-9]{64}$/.test(previewId)) {
      throw new Error("Invalid preview ID");
    }
  }
}

function rightForKind(kind: VerticalSpreadKind): DerivativeRight {
  return kind.startsWith("call") ? "CALL" : "PUT";
}

export function maskAccountId(accountId: string): string {
  if (accountId.length <= 4) return `${accountId[0] ?? "*"}***`;
  return `${accountId[0] ?? "*"}***${accountId.slice(-3)}`;
}

function requireResolvedContract(
  observation: Observation<DerivativeContract | null>,
  strike: number
): DerivativeContract {
  const resolved = requireObservation("resolveDerivativeContract", observation);
  if (resolved.value === null) {
    throw new Error(`No exact derivative contract returned for strike ${String(strike)}`);
  }
  return resolved.value;
}

function deriveKind(intent: CanonicalComboIntent): VerticalSpreadKind {
  const right = intent.legs[0].contract.identity.right;
  if (right === "CALL") {
    return intent.priceEffect === "DEBIT" ? "call-debit" : "call-credit";
  }
  return intent.priceEffect === "DEBIT" ? "put-debit" : "put-credit";
}

function toSpreadPreviewDto(record: StoredPreviewRecord): SpreadPreviewDto {
  return {
    previewId: record.previewId,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    account: record.account,
    order: {
      kind: deriveKind(record.canonicalIntent),
      gateway: record.canonicalIntent,
      legs: [
        { side: "LONG", ratio: 1, contract: record.canonicalIntent.legs[0].contract },
        { side: "SHORT", ratio: -1, contract: record.canonicalIntent.legs[1].contract },
      ],
      quantity: record.canonicalIntent.quantity,
      priceEffect: record.canonicalIntent.priceEffect,
      limit: record.canonicalIntent.limit,
      tif: record.canonicalIntent.tif,
      session: record.canonicalIntent.session,
    },
    whatIf: {
      accepted: record.previewResult.accepted,
      submitted: false,
      commission: record.previewResult.commission,
      initialMargin: record.previewResult.initialMargin,
      maintenanceMargin: record.previewResult.maintenanceMargin,
      warnings: record.previewResult.warnings,
      rejectionReasons: record.previewResult.rejectionReasons,
      advisoryAssetPermissions: record.previewResult.advisoryAssetPermissions,
    },
    submitted: false,
  };
}

/** Short-lived, process-local preview registry reusable by CLI and MCP. */
export class DerivativePreviewService {
  constructor(
    private readonly discovery: DerivativeDiscoveryClient,
    private readonly preview: DerivativePreviewClient,
    private readonly now: () => Date = () => new Date(),
    private readonly ttlMs = 5 * 60 * 1000,
    private readonly store: PreviewStore = new InMemoryPreviewStore()
  ) {}

  getTradingDiagnostics(): Promise<TradingDiagnostics> {
    return this.preview.getTradingDiagnostics();
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
    const [longContractResult, shortContractResult] = await Promise.all([
      this.discovery.resolveContract({ ...base, strike: request.longStrike }),
      this.discovery.resolveContract({ ...base, strike: request.shortStrike }),
    ]);
    const longContract = requireResolvedContract(longContractResult, request.longStrike);
    const shortContract = requireResolvedContract(shortContractResult, request.shortStrike);
    const diagnostics = await this.preview.getTradingDiagnostics();
    const previewResult = await this.preview.previewDerivativeCombo({
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
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + this.ttlMs);
    const canonicalIntent: CanonicalComboIntent = {
      legs: [
        { contract: longContract, ratio: 1 },
        { contract: shortContract, ratio: -1 },
      ],
      quantity: request.quantity,
      tif: request.tif,
      session: request.session,
      priceEffect: request.priceEffect,
      orderType: "LMT",
      limit: request.limit,
    };
    const account = {
      maskedId: diagnostics.maskedAccountDisplay ?? null,
      environment: previewResult.environment,
    };
    const previewId = createHash("sha256")
      .update(
        JSON.stringify({
          createdAt: createdAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
          canonicalIntent,
          previewResult,
          account,
        })
      )
      .digest("hex");
    const record: StoredPreviewRecord = {
      schemaVersion: 1,
      previewId,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      account,
      canonicalIntent,
      previewResult,
    };
    await this.store.save(previewId, record);
    return toSpreadPreviewDto(record);
  }

  async validatePreview(previewId: string): Promise<SpreadPreviewDto> {
    const stored = await this.store.load(previewId);
    if (stored === undefined) throw new Error("Unknown preview ID");
    if (this.now().getTime() >= new Date(stored.expiresAt).getTime()) {
      await this.store.delete(previewId);
      throw new Error("Preview has expired");
    }
    if (!stored.previewResult.accepted) {
      throw new Error("Preview was rejected by broker What-If");
    }
    return toSpreadPreviewDto(stored);
  }

  async consumePreview(previewId: string): Promise<void> {
    await this.store.delete(previewId);
  }
}
