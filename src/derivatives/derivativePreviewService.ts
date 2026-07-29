import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
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
  accountDigest: string;
  environment: BrokerEnvironment;
}

const marginSchema = z
  .object({ current: z.number(), change: z.number(), after: z.number() })
  .nullable();
const identitySchema = z.object({
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
const contractSchema = z.object({
  identity: identitySchema,
  brokerReference: z
    .object({ broker: z.enum(["schwab", "ibkr"]), contractId: z.string() })
    .optional(),
});
export const spreadPreviewDtoSchema = z.object({
  previewId: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  account: z.object({ maskedId: z.string(), environment: z.enum(["live", "paper"]) }),
  order: z.object({
    kind: z.enum(["call-debit", "call-credit", "put-debit", "put-credit"]),
    legs: z.tuple([
      z.object({ side: z.literal("LONG"), ratio: z.literal(1), contract: contractSchema }),
      z.object({ side: z.literal("SHORT"), ratio: z.literal(-1), contract: contractSchema }),
    ]),
    quantity: z.number().int().positive(),
    priceEffect: z.enum(["CREDIT", "DEBIT"]),
    limit: z.number().positive(),
    tif: z.enum(["DAY", "GTC"]),
    session: z.enum(["REGULAR", "OVERNIGHT"]),
  }),
  whatIf: z.object({
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
const storedPreviewSchema = z.object({
  accountDigest: z.string().regex(/^[a-f0-9]{64}$/),
  environment: z.enum(["live", "paper"]),
  dto: spreadPreviewDtoSchema,
});

export interface PreviewStore {
  save(previewId: string, preview: StoredPreview): Promise<void>;
  load(previewId: string): Promise<StoredPreview | undefined>;
  delete(previewId: string): Promise<void>;
}

export class InMemoryPreviewStore implements PreviewStore {
  private readonly previews = new Map<string, StoredPreview>();

  save(previewId: string, preview: StoredPreview): Promise<void> {
    this.previews.set(previewId, preview);
    return Promise.resolve();
  }

  load(previewId: string): Promise<StoredPreview | undefined> {
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

  async save(previewId: string, preview: StoredPreview): Promise<void> {
    this.assertPreviewId(previewId);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await writeFile(join(this.directory, `${previewId}.json`), JSON.stringify(preview), {
      encoding: "utf8",
      mode: 0o600,
    });
  }

  async load(previewId: string): Promise<StoredPreview | undefined> {
    this.assertPreviewId(previewId);
    try {
      const parsed = storedPreviewSchema.parse(
        JSON.parse(await readFile(join(this.directory, `${previewId}.json`), "utf8")) as unknown
      );
      if (parsed.dto.previewId !== previewId) throw new Error("Preview file identity mismatch");
      // Zod represents optional keys as `T | undefined`; the domain uses exact optional keys.
      // The schema has already validated every persisted execution-sensitive field.
      return parsed as unknown as StoredPreview;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async delete(previewId: string): Promise<void> {
    this.assertPreviewId(previewId);
    try {
      await unlink(join(this.directory, `${previewId}.json`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private assertPreviewId(previewId: string): void {
    if (!/^[a-f0-9]{64}$/.test(previewId)) throw new Error("Invalid preview ID");
  }
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
  constructor(
    private readonly discovery: DerivativeDiscoveryClient,
    private readonly preview: DerivativePreviewClient,
    private readonly now: () => Date = () => new Date(),
    private readonly ttlMs = 5 * 60 * 1000,
    private readonly store: PreviewStore = new InMemoryPreviewStore()
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
    await this.store.save(previewId, {
      dto,
      accountDigest: this.accountDigest(request.accountId),
      environment: result.environment,
    });
    return dto;
  }

  async validatePreview(
    previewId: string,
    context: { accountId: string; environment: BrokerEnvironment }
  ): Promise<SpreadPreviewDto> {
    const stored = await this.store.load(previewId);
    if (stored === undefined) throw new Error("Unknown preview ID");
    if (this.now().getTime() >= new Date(stored.dto.expiresAt).getTime()) {
      await this.store.delete(previewId);
      throw new Error("Preview has expired");
    }
    if (
      stored.accountDigest !== this.accountDigest(context.accountId) ||
      stored.environment !== context.environment
    ) {
      throw new Error("Preview account or environment does not match");
    }
    if (!stored.dto.whatIf.accepted) {
      throw new Error("Preview was rejected by broker What-If");
    }
    return stored.dto;
  }

  async consumePreview(previewId: string): Promise<void> {
    await this.store.delete(previewId);
  }

  private accountDigest(accountId: string): string {
    return createHash("sha256").update(accountId).digest("hex");
  }
}
