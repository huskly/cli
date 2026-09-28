import { createHash, randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { z } from "zod";
import type { OrderOperation } from "@huskly/ibkr-gateway-client";
import { PrivateJsonFile } from "#src/storage/privateJsonFile.js";
import {
  FileExecutionStateStore,
  type ExecutionStateStore,
  type SingleSubmissionRecord,
} from "#src/derivatives/derivativeExecutionService.js";
import type { BrokerEnvironment, MarginImpact } from "#src/derivatives/derivativePreview.js";

/**
 * One broker What-If for a single-instrument order.
 *
 * @remarks
 * `currency` is the account base currency. The commission and both margin
 * impacts are in this currency, whatever currency the instrument trades in.
 */
export interface SingleOrderPreviewResult {
  readonly environment: BrokerEnvironment;
  readonly accepted: boolean;
  readonly submitted: false;
  readonly commission: number | null;
  readonly initialMargin: MarginImpact | null;
  readonly maintenanceMargin: MarginImpact | null;
  readonly warnings: readonly string[];
  readonly rejectionReasons: readonly string[];
  readonly advisoryAssetPermissions: readonly string[];
  readonly currency: string;
}

export interface SingleOrderTradingDiagnostics {
  readonly environment: BrokerEnvironment;
  readonly accountVerified: boolean;
  readonly newMutationReady: boolean;
  readonly recoveryMutationReady: boolean;
  readonly maskedAccountDisplay: string;
}

/** The gateway calls that one guarded single-instrument order needs. */
export interface SingleOrderGateway<Intent> {
  getTradingDiagnostics(): Promise<SingleOrderTradingDiagnostics>;
  preview(intent: Intent): Promise<SingleOrderPreviewResult>;
  create(intent: Intent, idempotencyKey: string, operator: string): Promise<OrderOperation>;
  lookup(idempotencyKey: string): Promise<OrderOperation>;
}

export interface OrderAccount {
  readonly maskedId: string | null;
  readonly environment: BrokerEnvironment;
}

export interface SingleOrderPreviewRecord<Intent> {
  readonly schemaVersion: 1;
  readonly previewId: string;
  readonly nonce: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly environment: BrokerEnvironment;
  readonly account: OrderAccount;
  readonly canonicalIntent: Intent;
  readonly previewResult: SingleOrderPreviewResult;
}

export interface SingleOrderPreviewDto<Intent> {
  readonly previewId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly environment: BrokerEnvironment;
  readonly account: OrderAccount;
  readonly order: Intent;
  readonly whatIf: Omit<SingleOrderPreviewResult, "environment">;
  readonly submitted: false;
}

export interface SingleOrderSubmissionRecord<Intent> {
  readonly schemaVersion: 1;
  readonly previewId: string;
  readonly operationKind: "single";
  readonly idempotencyKey: string;
  readonly canonicalIntent: Intent;
  readonly operator: string;
  readonly intentHash: string;
  readonly account: OrderAccount;
  readonly state: "submission_pending" | "submission_uncertain" | "operation_known";
  readonly operationId: string | null;
  readonly operation: OrderOperation | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SingleOrderSubmissionDto<Intent> {
  readonly previewId: string;
  readonly environment: BrokerEnvironment;
  readonly account: OrderAccount;
  readonly order: Intent;
  readonly operation: OrderOperation;
  readonly recovered: boolean;
}

export interface SingleOrderPreviewStore<Intent> {
  create(value: SingleOrderPreviewRecord<Intent>): Promise<boolean>;
  load(previewId: string): Promise<SingleOrderPreviewRecord<Intent> | undefined>;
  delete(previewId: string): Promise<void>;
  pruneExpired(now: Date): Promise<void>;
}

export interface SingleOrderSubmissionStore<Intent> {
  reserve(value: SingleOrderSubmissionRecord<Intent>): Promise<boolean>;
  load(previewId: string): Promise<SingleOrderSubmissionRecord<Intent> | undefined>;
  save(value: SingleOrderSubmissionRecord<Intent>): Promise<void>;
}

const marginSchema = z
  .strictObject({ current: z.number(), change: z.number(), after: z.number() })
  .nullable();
export const singleOrderPreviewResultSchema = z.strictObject({
  environment: z.enum(["live", "paper"]),
  accepted: z.boolean(),
  submitted: z.literal(false),
  commission: z.number().nullable(),
  initialMargin: marginSchema,
  maintenanceMargin: marginSchema,
  warnings: z.array(z.string()),
  rejectionReasons: z.array(z.string()),
  advisoryAssetPermissions: z.array(z.string()),
  currency: z.string().regex(/^[A-Z]{3}$/u),
});

/** The durable preview record schema for one intent schema. */
export function singleOrderPreviewRecordSchema<Intent>(
  intentSchema: z.ZodType<Intent>
): z.ZodType<SingleOrderPreviewRecord<Intent>> {
  return z.strictObject({
    schemaVersion: z.literal(1),
    previewId: z.string().regex(/^[a-f0-9]{64}$/u),
    nonce: z.uuid(),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    environment: z.enum(["live", "paper"]),
    account: z.strictObject({
      maskedId: z.string().nullable(),
      environment: z.enum(["live", "paper"]),
    }),
    canonicalIntent: intentSchema,
    previewResult: singleOrderPreviewResultSchema,
  });
}

export class InMemorySingleOrderPreviewStore<Intent> implements SingleOrderPreviewStore<Intent> {
  private readonly values = new Map<string, SingleOrderPreviewRecord<Intent>>();
  public create(value: SingleOrderPreviewRecord<Intent>): Promise<boolean> {
    if (this.values.has(value.previewId)) return Promise.resolve(false);
    this.values.set(value.previewId, structuredClone(value));
    return Promise.resolve(true);
  }
  public load(previewId: string): Promise<SingleOrderPreviewRecord<Intent> | undefined> {
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

export class InMemorySingleOrderSubmissionStore<
  Intent,
> implements SingleOrderSubmissionStore<Intent> {
  private readonly values = new Map<string, SingleOrderSubmissionRecord<Intent>>();
  public reserve(value: SingleOrderSubmissionRecord<Intent>): Promise<boolean> {
    if (this.values.has(value.previewId)) return Promise.resolve(false);
    this.values.set(value.previewId, structuredClone(value));
    return Promise.resolve(true);
  }
  public load(previewId: string): Promise<SingleOrderSubmissionRecord<Intent> | undefined> {
    const value = this.values.get(previewId);
    return Promise.resolve(value === undefined ? undefined : structuredClone(value));
  }
  public save(value: SingleOrderSubmissionRecord<Intent>): Promise<void> {
    this.values.set(value.previewId, structuredClone(value));
    return Promise.resolve();
  }
}

/** Private preview files, one per preview ID, in one directory per order family. */
export class FileSingleOrderPreviewStore<Intent> implements SingleOrderPreviewStore<Intent> {
  public constructor(
    private readonly directory: string,
    private readonly schema: z.ZodType<SingleOrderPreviewRecord<Intent>>
  ) {}
  public create(value: SingleOrderPreviewRecord<Intent>): Promise<boolean> {
    return this.file(value.previewId).create(value);
  }
  public async load(previewId: string): Promise<SingleOrderPreviewRecord<Intent> | undefined> {
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
    if (names.length > 4096) throw new Error("Preview directory is too large");
    const cutoff = now.getTime();
    for (const name of names) {
      const match = /^([a-f0-9]{64})\.json$/u.exec(name);
      if (match?.[1] === undefined) continue;
      const preview = await this.load(match[1]);
      if (preview !== undefined && new Date(preview.expiresAt).getTime() <= cutoff)
        await this.delete(preview.previewId);
    }
  }
  private file(previewId: string): PrivateJsonFile<SingleOrderPreviewRecord<Intent>> {
    validatePreviewId(previewId);
    return new PrivateJsonFile({
      directory: this.directory,
      filename: `${previewId}.json`,
      schema: this.schema,
      maxBytes: 64 * 1024,
    });
  }
}

/**
 * Single submissions in the shared execution store.
 *
 * @remarks
 * Every `single` order family shares one durable record shape, so the
 * `order` commands can follow any of them. `isIntent` refuses a record that
 * another family wrote for the same preview ID.
 */
export class FileSingleOrderSubmissionStore<
  Intent extends SingleSubmissionRecord["canonicalIntent"],
> implements SingleOrderSubmissionStore<Intent> {
  private readonly store: ExecutionStateStore;
  public constructor(
    directory: string,
    private readonly isIntent: (
      intent: SingleSubmissionRecord["canonicalIntent"]
    ) => intent is Intent,
    private readonly family: string
  ) {
    this.store = new FileExecutionStateStore(directory);
  }
  public reserve(value: SingleOrderSubmissionRecord<Intent>): Promise<boolean> {
    return this.store.reserveSubmission(value satisfies SingleSubmissionRecord);
  }
  public async load(previewId: string): Promise<SingleOrderSubmissionRecord<Intent> | undefined> {
    validatePreviewId(previewId);
    const value = await this.store.loadSubmission(previewId);
    if (value === undefined) return undefined;
    if (value.operationKind !== "single" || !this.isIntent(value.canonicalIntent))
      throw new Error(`Submission record is not ${this.family}`);
    return { ...value, canonicalIntent: value.canonicalIntent };
  }
  public save(value: SingleOrderSubmissionRecord<Intent>): Promise<void> {
    return this.store.saveSubmission(value satisfies SingleSubmissionRecord);
  }
}

export interface SingleOrderWorkflowOptions<Intent> {
  readonly gateway: SingleOrderGateway<Intent>;
  readonly intentSchema: z.ZodType<Intent>;
  readonly previews: SingleOrderPreviewStore<Intent>;
  readonly submissions: SingleOrderSubmissionStore<Intent>;
  readonly now?: () => Date;
  readonly ttlMs?: number;
  readonly nonce?: () => string;
  readonly key?: () => string;
}

/**
 * The guarded preview/submit flow that every single-instrument order shares.
 *
 * @remarks
 * A preview stores the exact reviewed terms under a content-hash ID with a
 * short expiry. A submission accepts only an unexpired, broker-accepted
 * preview, reserves one idempotency key before the broker write, and recovers
 * an uncertain write by that key instead of writing again.
 */
export class SingleOrderWorkflow<Intent> {
  private readonly gateway: SingleOrderGateway<Intent>;
  private readonly intentSchema: z.ZodType<Intent>;
  private readonly recordSchema: z.ZodType<SingleOrderPreviewRecord<Intent>>;
  private readonly previews: SingleOrderPreviewStore<Intent>;
  private readonly submissions: SingleOrderSubmissionStore<Intent>;
  private readonly now: () => Date;
  private readonly ttlMs: number;
  private readonly nonce: () => string;
  private readonly key: () => string;

  public constructor(options: SingleOrderWorkflowOptions<Intent>) {
    this.gateway = options.gateway;
    this.intentSchema = options.intentSchema;
    this.recordSchema = singleOrderPreviewRecordSchema(options.intentSchema);
    this.previews = options.previews;
    this.submissions = options.submissions;
    this.now = options.now ?? (() => new Date());
    this.ttlMs = options.ttlMs ?? 5 * 60 * 1000;
    this.nonce = options.nonce ?? randomUUID;
    this.key = options.key ?? randomUUID;
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs <= 0)
      throw new Error("Invalid preview TTL");
  }

  /** Preview the intent that `buildIntent` resolves once the gateway is ready. */
  public async preview(buildIntent: () => Promise<Intent>): Promise<SingleOrderPreviewDto<Intent>> {
    await this.previews.pruneExpired(this.now());
    const diagnostics = await this.gateway.getTradingDiagnostics();
    requireMutationReady(diagnostics);
    const canonicalIntent = this.intentSchema.parse(await buildIntent());
    const previewResult = singleOrderPreviewResultSchema.parse(
      await this.gateway.preview(canonicalIntent)
    );
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
    const record = this.recordSchema.parse({ ...recordWithoutId, previewId });
    if (!(await this.previews.create(record))) throw new Error("Duplicate preview ID");
    return previewDto(record);
  }

  public async submit(input: {
    readonly previewId: string;
    readonly operator: string;
    readonly confirm: boolean;
  }): Promise<SingleOrderSubmissionDto<Intent>> {
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
    const now = this.now().toISOString();
    const pending: SingleOrderSubmissionRecord<Intent> = {
      schemaVersion: 1,
      previewId: preview.previewId,
      operationKind: "single",
      idempotencyKey: this.key(),
      canonicalIntent: preview.canonicalIntent,
      operator,
      intentHash: hash(preview.canonicalIntent),
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
      validateExisting(raced, operator, preview);
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

  private async requiredPreview(previewId: string): Promise<SingleOrderPreviewRecord<Intent>> {
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

  private async recoverExisting(
    record: SingleOrderSubmissionRecord<Intent>,
    operator: string,
    knownDiagnostics?: SingleOrderTradingDiagnostics
  ): Promise<SingleOrderSubmissionDto<Intent>> {
    validateExisting(record, operator);
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

function validateExisting<Intent>(
  existing: SingleOrderSubmissionRecord<Intent>,
  operator: string,
  preview?: SingleOrderPreviewRecord<Intent>
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

function previewDto<Intent>(
  record: SingleOrderPreviewRecord<Intent>
): SingleOrderPreviewDto<Intent> {
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

function submissionDto<Intent>(
  record: Pick<SingleOrderSubmissionRecord<Intent>, "previewId" | "canonicalIntent" | "account">,
  operation: OrderOperation,
  recovered: boolean
): SingleOrderSubmissionDto<Intent> {
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
    throw new Error("Gateway returned an invalid single-order operation");
}

export function validatePreviewId(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid preview ID");
}

function validateOperator(value: string): string {
  if (value.length < 1 || value.length > 64 || value.trim() !== value || /[^ -~]/.test(value))
    throw new Error("Invalid operator identity");
  return value;
}

function requireMutationReady(diagnostics: SingleOrderTradingDiagnostics): void {
  if (!diagnostics.accountVerified || !diagnostics.newMutationReady)
    throw new Error("Gateway is not ready for a new order mutation");
}

function requireRecoveryReady(diagnostics: SingleOrderTradingDiagnostics): void {
  if (!diagnostics.accountVerified || !diagnostics.recoveryMutationReady)
    throw new Error("Gateway is not ready for order recovery");
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}
