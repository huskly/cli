import { createHash, randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { PrivateJsonFile } from "#src/storage/privateJsonFile.js";
import {
  FileExecutionStateStore,
  type ExecutionStateStore,
  type SubmissionRecord,
} from "#src/derivatives/derivativeExecutionService.js";
import type { OrderOperation } from "@huskly/ibkr-gateway-client";
import type {
  CanonicalEquityIntent,
  EquityGatewayClient,
  EquityPreviewResult,
} from "./equityOrder.js";

export interface PreviewEquityOrderInput {
  readonly symbol: string;
  readonly side: "BUY" | "SELL";
  readonly quantity: number;
  readonly limit: number;
  readonly tif?: "DAY" | "GTC";
  readonly session?: "REGULAR" | "OVERNIGHT";
}

export interface EquityPreviewRecord {
  readonly schemaVersion: 1;
  readonly previewId: string;
  readonly nonce: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly environment: "live" | "paper";
  readonly account: {
    readonly maskedId: string | null;
    readonly environment: "live" | "paper";
  };
  readonly canonicalIntent: CanonicalEquityIntent;
  readonly previewResult: EquityPreviewResult;
}

export interface EquityPreviewDto {
  readonly previewId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly environment: "live" | "paper";
  readonly account: {
    readonly maskedId: string | null;
    readonly environment: "live" | "paper";
  };
  readonly order: CanonicalEquityIntent;
  readonly whatIf: Omit<EquityPreviewResult, "environment">;
  readonly submitted: false;
}

export interface EquitySubmissionRecord {
  readonly schemaVersion: 1;
  readonly previewId: string;
  readonly operationKind: "single";
  readonly idempotencyKey: string;
  readonly canonicalIntent: CanonicalEquityIntent;
  readonly operator: string;
  readonly intentHash: string;
  readonly account: {
    readonly maskedId: string | null;
    readonly environment: "live" | "paper";
  };
  readonly state: "submission_pending" | "submission_uncertain" | "operation_known";
  readonly operationId: string | null;
  readonly operation: OrderOperation | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EquitySubmissionDto {
  readonly previewId: string;
  readonly environment: "live" | "paper";
  readonly account: {
    readonly maskedId: string | null;
    readonly environment: "live" | "paper";
  };
  readonly order: CanonicalEquityIntent;
  readonly operation: OrderOperation;
  readonly recovered: boolean;
}

const contractSchema = z.strictObject({
  conid: z.number().int().positive(),
  assetClass: z.literal("STK"),
  symbol: z.string().regex(/^[A-Z0-9][A-Z0-9 .-]{0,31}$/),
  exchange: z.literal("SMART"),
  primaryExchange: z.string().min(1).max(32),
  currency: z.literal("USD"),
});
export const canonicalEquityIntentSchema = z.strictObject({
  contract: contractSchema,
  side: z.enum(["BUY", "SELL"]),
  quantity: z.number().int().positive(),
  tif: z.enum(["DAY", "GTC"]),
  session: z.enum(["REGULAR", "OVERNIGHT"]),
  orderType: z.literal("LMT"),
  limit: z.number().positive(),
});
const marginSchema = z
  .strictObject({ current: z.number(), change: z.number(), after: z.number() })
  .nullable();
const previewResultSchema = z.strictObject({
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
const previewRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  previewId: z.string().regex(/^[a-f0-9]{64}$/),
  nonce: z.uuid(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  environment: z.enum(["live", "paper"]),
  account: z.strictObject({
    maskedId: z.string().nullable(),
    environment: z.enum(["live", "paper"]),
  }),
  canonicalIntent: canonicalEquityIntentSchema,
  previewResult: previewResultSchema,
});

export interface EquityPreviewStore {
  create(value: EquityPreviewRecord): Promise<boolean>;
  load(previewId: string): Promise<EquityPreviewRecord | undefined>;
  delete(previewId: string): Promise<void>;
  pruneExpired(now: Date): Promise<void>;
}

export interface EquitySubmissionStore {
  reserve(value: EquitySubmissionRecord): Promise<boolean>;
  load(previewId: string): Promise<EquitySubmissionRecord | undefined>;
  save(value: EquitySubmissionRecord): Promise<void>;
}

export class InMemoryEquityPreviewStore implements EquityPreviewStore {
  private readonly values = new Map<string, EquityPreviewRecord>();
  public create(value: EquityPreviewRecord): Promise<boolean> {
    if (this.values.has(value.previewId)) return Promise.resolve(false);
    this.values.set(value.previewId, structuredClone(value));
    return Promise.resolve(true);
  }
  public load(previewId: string): Promise<EquityPreviewRecord | undefined> {
    const value = this.values.get(previewId);
    return Promise.resolve(value === undefined ? undefined : structuredClone(value));
  }
  public delete(previewId: string): Promise<void> {
    this.values.delete(previewId);
    return Promise.resolve();
  }
  public pruneExpired(now: Date): Promise<void> {
    const cutoff = now.getTime();
    for (const [previewId, value] of this.values) {
      if (new Date(value.expiresAt).getTime() <= cutoff) this.values.delete(previewId);
    }
    return Promise.resolve();
  }
}

export class InMemoryEquitySubmissionStore implements EquitySubmissionStore {
  private readonly values = new Map<string, EquitySubmissionRecord>();
  public reserve(value: EquitySubmissionRecord): Promise<boolean> {
    if (this.values.has(value.previewId)) return Promise.resolve(false);
    this.values.set(value.previewId, structuredClone(value));
    return Promise.resolve(true);
  }
  public load(previewId: string): Promise<EquitySubmissionRecord | undefined> {
    const value = this.values.get(previewId);
    return Promise.resolve(value === undefined ? undefined : structuredClone(value));
  }
  public save(value: EquitySubmissionRecord): Promise<void> {
    this.values.set(value.previewId, structuredClone(value));
    return Promise.resolve();
  }
}

export class FileEquityPreviewStore implements EquityPreviewStore {
  public constructor(
    private readonly directory = process.env["HUSKLY_EQUITY_PREVIEW_DIR"] ??
      join(homedir(), ".cache", "huskly-cli", "equity-previews")
  ) {}
  public create(value: EquityPreviewRecord): Promise<boolean> {
    return this.file(value.previewId).create(value);
  }
  public async load(previewId: string): Promise<EquityPreviewRecord | undefined> {
    validatePreviewId(previewId);
    const value = await this.file(previewId).load();
    if (value !== undefined && value.previewId !== previewId)
      throw new Error("Preview file identity mismatch");
    return value;
  }
  public delete(previewId: string): Promise<void> {
    validatePreviewId(previewId);
    return this.file(previewId).delete();
  }
  public async pruneExpired(now: Date): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.directory);
    } catch (error: unknown) {
      if (isNodeErrorWithCode(error, "ENOENT")) return;
      throw error;
    }
    if (names.length > 4096) throw new Error("Equity preview directory is too large");
    const cutoff = now.getTime();
    for (const name of names) {
      const match = /^([a-f0-9]{64})\.json$/u.exec(name);
      if (match?.[1] === undefined) continue;
      const preview = await this.load(match[1]);
      if (preview !== undefined && new Date(preview.expiresAt).getTime() <= cutoff)
        await this.delete(preview.previewId);
    }
  }
  private file(previewId: string): PrivateJsonFile<EquityPreviewRecord> {
    validatePreviewId(previewId);
    return new PrivateJsonFile({
      directory: this.directory,
      filename: `${previewId}.json`,
      schema: previewRecordSchema,
      maxBytes: 64 * 1024,
    });
  }
}

export class FileEquitySubmissionStore implements EquitySubmissionStore {
  private readonly store: ExecutionStateStore;
  public constructor(
    directory = process.env["HUSKLY_EXECUTION_DIR"] ??
      join(homedir(), ".cache", "huskly-cli", "execution")
  ) {
    this.store = new FileExecutionStateStore(directory);
  }
  public reserve(value: EquitySubmissionRecord): Promise<boolean> {
    return this.store.reserveSubmission(value satisfies SubmissionRecord);
  }
  public async load(previewId: string): Promise<EquitySubmissionRecord | undefined> {
    validatePreviewId(previewId);
    const value = await this.store.loadSubmission(previewId);
    if (value === undefined) return undefined;
    if (value.operationKind !== "single" || !("contract" in value.canonicalIntent))
      throw new Error("Submission record is not an equity order");
    return value;
  }
  public save(value: EquitySubmissionRecord): Promise<void> {
    return this.store.saveSubmission(value satisfies SubmissionRecord);
  }
}

export class EquityOrderService {
  public constructor(
    private readonly gateway: EquityGatewayClient,
    private readonly previews: EquityPreviewStore,
    private readonly submissions: EquitySubmissionStore,
    private readonly now: () => Date = () => new Date(),
    private readonly ttlMs = 5 * 60 * 1000,
    private readonly nonce: () => string = randomUUID,
    private readonly key: () => string = randomUUID
  ) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new Error("Invalid preview TTL");
  }

  public async preview(input: PreviewEquityOrderInput): Promise<EquityPreviewDto> {
    await this.previews.pruneExpired(this.now());
    const symbol = normalizeSymbol(input.symbol);
    const diagnostics = await this.gateway.getTradingDiagnostics();
    requireMutationReady(diagnostics);
    const contract = await this.gateway.resolveContract(symbol);
    if (contract.symbol !== symbol) throw new Error("Resolved equity symbol does not match");
    const canonicalIntent = canonicalEquityIntentSchema.parse({
      contract,
      side: input.side,
      quantity: input.quantity,
      tif: input.tif ?? "DAY",
      session: input.session ?? "REGULAR",
      orderType: "LMT",
      limit: input.limit,
    });
    const previewResult = await this.gateway.preview(canonicalIntent);
    if (previewResult.environment !== diagnostics.environment)
      throw new Error("Preview environment does not match gateway diagnostics");
    const createdAt = this.now();
    const recordWithoutId = {
      schemaVersion: 1 as const,
      nonce: this.nonce(),
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + this.ttlMs).toISOString(),
      environment: diagnostics.environment,
      account: {
        maskedId: diagnostics.maskedAccountDisplay,
        environment: diagnostics.environment,
      },
      canonicalIntent,
      previewResult,
    };
    const previewId = hash(recordWithoutId);
    const record = previewRecordSchema.parse({ ...recordWithoutId, previewId });
    if (!(await this.previews.create(record))) throw new Error("Duplicate preview ID");
    return previewDto(record);
  }

  public async submit(input: {
    readonly previewId: string;
    readonly operator: string;
    readonly confirm: boolean;
  }): Promise<EquitySubmissionDto> {
    if (!input.confirm) throw new Error("Confirmation must be exactly true");
    validatePreviewId(input.previewId);
    const operator = validateOperator(input.operator);
    const existing = await this.submissions.load(input.previewId);
    if (existing !== undefined) return this.recoverExisting(existing, operator);

    const preview = await this.requiredPreview(input.previewId);
    const diagnostics = await this.gateway.getTradingDiagnostics();
    requireMutationReady(diagnostics);
    if (diagnostics.environment !== preview.environment)
      throw new Error("Preview environment does not match the current gateway");
    const intentHash = hash(preview.canonicalIntent);
    const now = this.now().toISOString();
    const pending: EquitySubmissionRecord = {
      schemaVersion: 1,
      previewId: preview.previewId,
      operationKind: "single",
      idempotencyKey: this.key(),
      canonicalIntent: preview.canonicalIntent,
      operator,
      intentHash,
      account: preview.account,
      state: "submission_pending",
      operationId: null,
      operation: null,
      createdAt: now,
      updatedAt: now,
    };
    if (!(await this.submissions.reserve(pending))) {
      const raced = await this.submissions.load(preview.previewId);
      if (raced === undefined) throw new Error("Submission reservation is unavailable");
      this.validateExisting(raced, operator, preview);
      return this.recoverExisting(raced, operator, diagnostics);
    }
    let operation: OrderOperation;
    try {
      operation = await this.gateway.create(
        preview.canonicalIntent,
        pending.idempotencyKey,
        operator
      );
      validateOperation(operation);
    } catch (error: unknown) {
      await this.submissions.save({
        ...pending,
        state: "submission_uncertain",
        updatedAt: this.now().toISOString(),
      });
      throw error;
    }
    await this.submissions.save({
      ...pending,
      state: "operation_known",
      operationId: operation.operationId,
      operation,
      updatedAt: this.now().toISOString(),
    });
    return submissionDto(pending, operation, false);
  }

  private async requiredPreview(previewId: string): Promise<EquityPreviewRecord> {
    validatePreviewId(previewId);
    const preview = await this.previews.load(previewId);
    if (preview === undefined) throw new Error("Unknown preview ID");
    const { previewId: _previewId, ...payload } = preview;
    if (hash(payload) !== previewId) throw new Error("Preview content hash mismatch");
    if (this.now().getTime() >= new Date(preview.expiresAt).getTime()) {
      await this.previews.delete(previewId);
      throw new Error("Preview has expired");
    }
    if (!preview.previewResult.accepted) throw new Error("Preview was rejected by broker What-If");
    return preview;
  }

  private validateExisting(
    existing: EquitySubmissionRecord,
    operator: string,
    preview?: EquityPreviewRecord
  ): void {
    if (
      existing.operator !== operator ||
      existing.intentHash !== hash(existing.canonicalIntent) ||
      (preview !== undefined &&
        (existing.previewId !== preview.previewId ||
          existing.account.environment !== preview.environment ||
          existing.account.maskedId !== preview.account.maskedId ||
          existing.intentHash !== hash(preview.canonicalIntent)))
    )
      throw new Error("Submission reservation does not match the preview");
  }

  private async recoverExisting(
    record: EquitySubmissionRecord,
    operator: string,
    knownDiagnostics?: Awaited<ReturnType<EquityGatewayClient["getTradingDiagnostics"]>>
  ): Promise<EquitySubmissionDto> {
    this.validateExisting(record, operator);
    if (record.state === "operation_known" && record.operation !== null) {
      validateOperation(record.operation);
      return submissionDto(record, record.operation, true);
    }
    const diagnostics = knownDiagnostics ?? (await this.gateway.getTradingDiagnostics());
    requireRecoveryReady(diagnostics);
    if (diagnostics.environment !== record.account.environment)
      throw new Error("Submission environment does not match the current gateway");
    const operation = await this.gateway.lookup(record.idempotencyKey);
    validateOperation(operation);
    await this.submissions.save({
      ...record,
      state: "operation_known",
      operationId: operation.operationId,
      operation,
      updatedAt: this.now().toISOString(),
    });
    return submissionDto(record, operation, true);
  }
}

function previewDto(record: EquityPreviewRecord): EquityPreviewDto {
  const { environment: _environment, ...whatIf } = record.previewResult;
  return {
    previewId: record.previewId,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    environment: record.environment,
    account: record.account,
    order: record.canonicalIntent,
    whatIf,
    submitted: false,
  };
}

function submissionDto(
  record: Pick<EquitySubmissionRecord, "previewId" | "canonicalIntent" | "account">,
  operation: OrderOperation,
  recovered: boolean
): EquitySubmissionDto {
  return {
    previewId: record.previewId,
    environment: record.account.environment,
    account: record.account,
    order: record.canonicalIntent,
    operation,
    recovered,
  };
}

function validateOperation(operation: OrderOperation): void {
  if (operation.kind !== "single" || operation.operationId.length === 0)
    throw new Error("Gateway returned an invalid equity operation");
}

function normalizeSymbol(value: string): string {
  const symbol = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9 .-]{0,31}$/.test(symbol)) throw new Error("Invalid equity symbol");
  return symbol;
}

function validatePreviewId(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid preview ID");
}

function validateOperator(value: string): string {
  if (value.length < 1 || value.length > 64 || value.trim() !== value || /[^ -~]/.test(value))
    throw new Error("Invalid operator identity");
  return value;
}

function requireMutationReady(diagnostics: {
  readonly environment: "live" | "paper";
  readonly accountVerified: boolean;
  readonly newMutationReady: boolean;
}): void {
  if (!diagnostics.accountVerified || !diagnostics.newMutationReady)
    throw new Error("Gateway is not ready for a new order mutation");
}

function requireRecoveryReady(diagnostics: {
  readonly accountVerified: boolean;
  readonly recoveryMutationReady: boolean;
}): void {
  if (!diagnostics.accountVerified || !diagnostics.recoveryMutationReady)
    throw new Error("Gateway is not ready for order recovery");
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}
