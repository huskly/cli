import { ConsumerError } from "#src/gateway/gatewayErrors.js";
import { PrivateJsonFile } from "#src/storage/privateJsonFile.js";
import { createHash, randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { DerivativeDiscoveryClient } from "./derivativeDiscovery.js";
import type {
  DerivativeExecutionClient,
  OrderOperationView,
  OrderReconciliationView,
} from "./derivativeExecution.js";
import type {
  BrokerEnvironment,
  CanonicalComboIntent,
  DerivativePreviewClient,
} from "./derivativePreview.js";
import {
  canonicalComboIntentSchema,
  type DerivativePreviewService,
} from "./derivativePreviewService.js";

export type SubmissionState = "submission_pending" | "submission_uncertain" | "operation_known";

export interface SubmissionRecord {
  readonly schemaVersion: 1;
  readonly previewId: string;
  readonly operationKind: "combo";
  readonly idempotencyKey: string;
  readonly canonicalIntent: CanonicalComboIntent;
  readonly account: { readonly maskedId: string | null; readonly environment: BrokerEnvironment };
  readonly state: SubmissionState;
  readonly operationId: string | null;
  readonly operation: OrderOperationView | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ActionRecord {
  readonly schemaVersion: 1;
  readonly operationId: string;
  readonly action: "warning_acknowledgement" | "cancellation";
  readonly warningSequence: number | null;
  readonly replyId: string | null;
  readonly idempotencyKey: string;
  readonly state: "pending" | "uncertain" | "completed";
  readonly operation: OrderOperationView | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ExecutionStateStore {
  reserveSubmission(value: SubmissionRecord): Promise<boolean>;
  saveSubmission(value: SubmissionRecord): Promise<void>;
  loadSubmission(previewId: string): Promise<SubmissionRecord | undefined>;
  loadSubmissionByOperation(operationId: string): Promise<SubmissionRecord | undefined>;
  reserveAction(value: ActionRecord): Promise<boolean>;
  saveAction(value: ActionRecord): Promise<void>;
  loadAction(
    operationId: string,
    action: ActionRecord["action"],
    warningSequence?: number | null,
    replyId?: string | null
  ): Promise<ActionRecord | undefined>;
}

function actionIdentity(
  operationId: string,
  action: ActionRecord["action"],
  warningSequence: number | null,
  replyId: string | null
): string {
  return action === "cancellation"
    ? `${operationId}:cancellation`
    : `${operationId}:warning_acknowledgement:${String(warningSequence)}:${replyId ?? ""}`;
}

export class InMemoryExecutionStateStore implements ExecutionStateStore {
  private readonly submissions = new Map<string, SubmissionRecord>();
  private readonly operationIndex = new Map<string, string>();
  private readonly actions = new Map<string, ActionRecord>();

  reserveSubmission(value: SubmissionRecord): Promise<boolean> {
    if (this.submissions.has(value.previewId)) return Promise.resolve(false);
    this.submissions.set(value.previewId, value);
    return Promise.resolve(true);
  }
  saveSubmission(value: SubmissionRecord): Promise<void> {
    this.submissions.set(value.previewId, value);
    if (value.operationId !== null) this.operationIndex.set(value.operationId, value.previewId);
    return Promise.resolve();
  }
  loadSubmission(previewId: string): Promise<SubmissionRecord | undefined> {
    return Promise.resolve(this.submissions.get(previewId));
  }
  loadSubmissionByOperation(operationId: string): Promise<SubmissionRecord | undefined> {
    const previewId = this.operationIndex.get(operationId);
    if (previewId !== undefined) return Promise.resolve(this.submissions.get(previewId));
    const record = [...this.submissions.values()].find((item) => item.operationId === operationId);
    if (record !== undefined) this.operationIndex.set(operationId, record.previewId);
    return Promise.resolve(record);
  }
  reserveAction(value: ActionRecord): Promise<boolean> {
    const identity = actionIdentity(
      value.operationId,
      value.action,
      value.warningSequence,
      value.replyId
    );
    if (this.actions.has(identity)) return Promise.resolve(false);
    this.actions.set(identity, value);
    return Promise.resolve(true);
  }
  saveAction(value: ActionRecord): Promise<void> {
    this.actions.set(
      actionIdentity(value.operationId, value.action, value.warningSequence, value.replyId),
      value
    );
    return Promise.resolve();
  }
  loadAction(
    operationId: string,
    action: ActionRecord["action"],
    warningSequence: number | null = null,
    replyId: string | null = null
  ): Promise<ActionRecord | undefined> {
    return Promise.resolve(
      this.actions.get(actionIdentity(operationId, action, warningSequence, replyId))
    );
  }
}

const brokerOrderSchema = z.strictObject({
  memberId: z.string(),
  parentMemberId: z.string().nullable(),
  orderId: z.string().nullable(),
  parentOrderId: z.string().nullable(),
  clientOrderId: z.string().nullable(),
  status: z.enum([
    "WARNING_PENDING",
    "PENDING",
    "WORKING",
    "PARTIALLY_FILLED",
    "FILLED",
    "CANCELED",
    "REJECTED",
    "UNKNOWN",
  ]),
});
const outcomeBase = { orders: z.array(brokerOrderSchema), warningCount: z.number() };
const reasonCategories = z.array(
  z.enum([
    "validation",
    "risk",
    "permissions",
    "session",
    "market",
    "duplicate",
    "broker",
    "unknown",
  ])
);
const operationSchema = z.strictObject({
  operationId: z.string(),
  kind: z.enum(["single", "combo", "graph"]),
  action: z.literal("submission"),
  parentOperationId: z.string().nullable(),
  intentSchemaVersion: z.literal(1),
  intentHash: z.string(),
  state: z.enum([
    "received",
    "rejected_before_submission",
    "broker_attempt_started",
    "accepted",
    "warning_pending",
    "cancelled",
    "broker_refused",
    "unknown_outcome",
    "reconciliation_required",
  ]),
  correlations: z.array(
    z.strictObject({
      memberId: z.string(),
      parentMemberId: z.string().nullable(),
      clientOrderId: z.string(),
    })
  ),
  children: z.array(
    z.strictObject({
      operationId: z.string(),
      action: z.enum(["warning_acknowledgement", "cancellation"]),
      state: z.enum([
        "received",
        "rejected_before_submission",
        "broker_attempt_started",
        "accepted",
        "warning_pending",
        "cancelled",
        "broker_refused",
        "unknown_outcome",
        "reconciliation_required",
      ]),
      createdAt: z.iso.datetime(),
      latestTransitionAt: z.iso.datetime(),
    })
  ),
  pendingWarning: z.strictObject({ sequence: z.number(), replyId: z.string() }).nullable(),
  reconciliation: z
    .strictObject({
      observedAt: z.iso.datetime(),
      status: z.enum(["matched", "incomplete", "conflicting", "unavailable"]),
      reason: z.string(),
    })
    .nullable(),
  result: z
    .discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("accepted"), ...outcomeBase }),
      z.strictObject({ kind: z.literal("warning"), ...outcomeBase }),
      z.strictObject({ kind: z.literal("refused"), ...outcomeBase, reasonCategories }),
      z.strictObject({ kind: z.literal("recovery_required"), ...outcomeBase, reasonCategories }),
    ])
    .nullable(),
  createdAt: z.iso.datetime(),
  latestTransitionAt: z.iso.datetime(),
}) satisfies z.ZodType<OrderOperationView>;
const submissionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  previewId: z.string().regex(/^[a-f0-9]{64}$/u),
  operationKind: z.literal("combo"),
  idempotencyKey: z.string().min(1).max(128),
  canonicalIntent: canonicalComboIntentSchema,
  account: z.strictObject({
    maskedId: z.string().nullable(),
    environment: z.enum(["paper", "live"]),
  }),
  state: z.enum(["submission_pending", "submission_uncertain", "operation_known"]),
  operationId: z.string().nullable(),
  operation: operationSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}) as unknown as z.ZodType<SubmissionRecord>;
const actionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  operationId: z.string().min(1),
  action: z.enum(["warning_acknowledgement", "cancellation"]),
  warningSequence: z.number().int().positive().nullable(),
  replyId: z.string().nullable(),
  idempotencyKey: z.string().min(1).max(128),
  state: z.enum(["pending", "uncertain", "completed"]),
  operation: operationSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}) as unknown as z.ZodType<ActionRecord>;

const operationIndexSchema = z.strictObject({
  schemaVersion: z.literal(1),
  operationId: z.string().min(1),
  previewId: z.string().regex(/^[a-f0-9]{64}$/u),
});
/** Atomic owner-private state shared by separate CLI invocations. */
export class FileExecutionStateStore implements ExecutionStateStore {
  public constructor(
    private readonly directory = process.env["HUSKLY_EXECUTION_DIR"] ??
      join(homedir(), ".cache", "huskly-cli", "execution"),
    private readonly beforeOperationIndexWrite?: () => Promise<void>
  ) {}

  reserveSubmission(value: SubmissionRecord): Promise<boolean> {
    return this.file("submissions", value.previewId, submissionSchema).create(value);
  }
  async saveSubmission(value: SubmissionRecord): Promise<void> {
    await this.file("submissions", value.previewId, submissionSchema).save(value);
    if (value.operationId !== null) {
      await this.beforeOperationIndexWrite?.();
      await this.file("operations", value.operationId, operationIndexSchema).save({
        schemaVersion: 1,
        operationId: value.operationId,
        previewId: value.previewId,
      });
    }
  }
  loadSubmission(previewId: string): Promise<SubmissionRecord | undefined> {
    return this.file("submissions", previewId, submissionSchema).load();
  }
  async loadSubmissionByOperation(operationId: string): Promise<SubmissionRecord | undefined> {
    const index = await this.file("operations", operationId, operationIndexSchema).load();
    if (index !== undefined) {
      const indexed = await this.loadSubmission(index.previewId);
      if (indexed?.operationId === operationId) return indexed;
    }
    const derived = await this.deriveSubmission(operationId);
    if (derived !== undefined) await this.saveSubmission(derived);
    return derived;
  }
  reserveAction(value: ActionRecord): Promise<boolean> {
    return this.actionFile(
      value.operationId,
      value.action,
      value.warningSequence,
      value.replyId
    ).create(value);
  }
  saveAction(value: ActionRecord): Promise<void> {
    return this.actionFile(
      value.operationId,
      value.action,
      value.warningSequence,
      value.replyId
    ).save(value);
  }
  loadAction(
    operationId: string,
    action: ActionRecord["action"],
    warningSequence: number | null = null,
    replyId: string | null = null
  ): Promise<ActionRecord | undefined> {
    return this.actionFile(operationId, action, warningSequence, replyId).load();
  }
  private actionFile(
    operationId: string,
    action: ActionRecord["action"],
    warningSequence: number | null,
    replyId: string | null
  ): PrivateJsonFile<ActionRecord> {
    return this.file(
      "actions",
      actionIdentity(operationId, action, warningSequence, replyId),
      actionSchema
    );
  }
  private async deriveSubmission(operationId: string): Promise<SubmissionRecord | undefined> {
    const directory = join(this.directory, "submissions");
    let names: string[];
    try {
      names = await readdir(directory);
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
      throw error;
    }
    if (names.length > 4096) throw new Error("Execution submission directory is too large");
    for (const name of names) {
      if (!/^[a-f0-9]{64}\.json$/u.test(name)) continue;
      const record = await new PrivateJsonFile({
        directory,
        filename: name,
        schema: submissionSchema,
        maxBytes: 256 * 1024,
      }).load();
      if (record?.operationId === operationId) return record;
    }
    return undefined;
  }
  private file<T>(kind: string, id: string, schema: z.ZodType<T>): PrivateJsonFile<T> {
    const filename = `${createHash("sha256").update(id).digest("hex")}.json`;
    return new PrivateJsonFile({
      directory: join(this.directory, kind),
      filename,
      schema,
      maxBytes: 256 * 1024,
    });
  }
}

export interface SubmissionDto {
  readonly state: "accepted" | "warning" | "rejected" | "recovery_required";
  readonly previewId: string;
  readonly operationId: string;
  readonly operation: OrderOperationView;
  readonly account: {
    readonly maskedId: string | null;
    readonly environment: BrokerEnvironment | null;
  };
  readonly orderId: string | null;
  readonly clientOrderId: string | null;
  readonly status: NonNullable<OrderOperationView["result"]>["orders"][number]["status"] | null;
  readonly updatedAt: string | null;
  readonly warnings: readonly {
    readonly sequence: number;
    readonly replyId: string;
    readonly messages: string[];
    readonly messageIds: string[];
    readonly known: boolean;
  }[];
  readonly rejectionReasons: readonly string[];
}

export interface OrderLifecycleDto extends SubmissionDto {
  readonly verifiedAgainstPreview: true;
  readonly quantity: number | null;
  readonly filledQuantity: number | null;
  readonly remainingQuantity: number | null;
  readonly averagePrice: number | null;
  readonly limitPrice: number | null;
  readonly commissionAndFees: number | null;
}

const terminalStates = new Set(["accepted", "cancelled", "broker_refused"]);
const defaultDelay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Durable gateway operation workflow. Account and client-order identity stay gateway-owned. */
export class DerivativeExecutionService {
  public constructor(
    _discovery: DerivativeDiscoveryClient,
    _previewClient: DerivativePreviewClient,
    private readonly execution: DerivativeExecutionClient,
    private readonly previews: DerivativePreviewService,
    private readonly store: ExecutionStateStore = new InMemoryExecutionStateStore(),
    private readonly now: () => Date = () => new Date(),
    private readonly delay: (ms: number) => Promise<void> = defaultDelay,
    _livePolicy?: unknown,
    private readonly key: () => string = randomUUID
  ) {}

  async submit(input: {
    previewId: string;
    operator: string;
    confirm: true;
  }): Promise<SubmissionDto> {
    const preview = await this.previews.validatePreview(input.previewId);
    const createdAt = this.now().toISOString();
    const pending: SubmissionRecord = {
      schemaVersion: 1,
      previewId: preview.previewId,
      operationKind: "combo",
      idempotencyKey: this.key(),
      canonicalIntent: preview.order.gateway,
      account: preview.account,
      state: "submission_pending",
      operationId: null,
      operation: null,
      createdAt,
      updatedAt: createdAt,
    };
    if (!(await this.store.reserveSubmission(pending))) {
      throw new Error("A submission record already exists for this preview");
    }
    let operation: OrderOperationView;
    try {
      operation = await this.execution.create(
        pending.canonicalIntent,
        pending.idempotencyKey,
        input.operator
      );
    } catch (error: unknown) {
      if (!(error instanceof ConsumerError) || error.code === "gateway_transport_failure") {
        await this.store.saveSubmission({
          ...pending,
          state: "submission_uncertain",
          updatedAt: this.now().toISOString(),
        });
      }
      throw error;
    }
    const complete = this.completeSubmission(pending, operation);
    await this.store.saveSubmission(complete);
    await this.previews.consumePreview(preview.previewId);
    return this.submissionDto(complete);
  }

  async recover(input: { previewId: string }): Promise<SubmissionDto> {
    const record = await this.store.loadSubmission(input.previewId);
    if (record === undefined) throw new Error("Unknown submission record");
    const complete =
      record.state === "operation_known" && record.operation !== null && record.operationId !== null
        ? record
        : this.completeSubmission(
            record,
            await this.execution.lookup(record.operationKind, record.idempotencyKey)
          );
    await this.store.saveSubmission(complete);
    await this.previews.consumePreview(record.previewId);
    return this.submissionDto(complete);
  }

  async getStatus(operationId: string): Promise<OrderLifecycleDto> {
    const record = await this.requiredOperation(operationId);
    const operation = await this.execution.get(operationId);
    const updated = await this.saveParentOperation(record, operation);
    return this.operationDto(operation, updated);
  }

  async acknowledgeWarning(input: {
    operationId?: string;
    replyId: string;
    confirm: true;
    previewId?: string;
  }): Promise<OrderLifecycleDto> {
    const operationId = input.operationId ?? (await this.operationIdForPreview(input.previewId));
    const record = await this.requiredOperation(operationId);
    const warning = record.operation?.pendingWarning;
    if (warning?.replyId !== input.replyId) {
      throw new Error("Warning reply does not match the durable operation");
    }
    const existing = await this.store.loadAction(
      operationId,
      "warning_acknowledgement",
      warning.sequence,
      warning.replyId
    );
    if (existing !== undefined) return this.resumeAction(existing, record);
    const action = this.pendingAction(
      operationId,
      "warning_acknowledgement",
      warning.sequence,
      warning.replyId
    );
    if (!(await this.store.reserveAction(action))) {
      throw new Error("Warning acknowledgement is already reserved");
    }
    return this.runAction(action, record);
  }

  async reconcile(operationId: string): Promise<OrderReconciliationView> {
    const record = await this.requiredOperation(operationId);
    const operation = await this.execution.reconcile(operationId);
    await this.saveParentOperation(record, operation);
    return operation;
  }

  async watch(input: {
    operationId: string;
    timeoutMs?: number;
    pollMs?: number;
  }): Promise<OrderLifecycleDto> {
    const deadline = this.now().getTime() + (input.timeoutMs ?? 300_000);
    for (;;) {
      const status = await this.getStatus(input.operationId);
      if (terminalStates.has(status.operation.state)) return status;
      const remaining = deadline - this.now().getTime();
      if (remaining <= 0) throw new Error("Timed out waiting for terminal order operation");
      await this.delay(Math.min(input.pollMs ?? 2_000, remaining));
    }
  }

  async cancel(input: {
    operationId: string;
    confirm: true;
    operator?: string;
    timeoutMs?: number;
    pollMs?: number;
  }): Promise<OrderLifecycleDto> {
    const record = await this.requiredOperation(input.operationId);
    const existing = await this.store.loadAction(input.operationId, "cancellation");
    if (existing !== undefined) return this.resumeAction(existing, record);
    const action = this.pendingAction(input.operationId, "cancellation", null, null);
    if (!(await this.store.reserveAction(action))) {
      throw new Error("Cancellation is already reserved");
    }
    return this.runAction(action, record);
  }

  private async resumeAction(
    action: ActionRecord,
    record: SubmissionRecord
  ): Promise<OrderLifecycleDto> {
    if (action.state === "completed" && action.operation !== null) {
      return this.operationDto(action.operation, record);
    }
    if (action.state === "pending") {
      throw new Error(
        `${action.action === "cancellation" ? "Cancellation" : "Warning acknowledgement"} recovery is required`
      );
    }

    const parent = await this.execution.get(action.operationId);
    if (this.parentProvesAction(parent, action)) {
      const updated = await this.completeAction(action, record, parent);
      return this.operationDto(parent, updated);
    }
    return this.runAction(action, record);
  }

  private parentProvesAction(operation: OrderOperationView, action: ActionRecord): boolean {
    if (action.action === "cancellation") {
      return (
        operation.state === "cancelled" ||
        operation.children.some(
          (child) =>
            child.action === "cancellation" &&
            ["accepted", "cancelled", "broker_refused", "reconciliation_required"].includes(
              child.state
            )
        )
      );
    }
    return (
      operation.pendingWarning?.sequence !== action.warningSequence ||
      operation.pendingWarning.replyId !== action.replyId
    );
  }

  private async runAction(
    action: ActionRecord,
    record: SubmissionRecord
  ): Promise<OrderLifecycleDto> {
    try {
      const operation =
        action.action === "warning_acknowledgement"
          ? await this.execution.acknowledge(
              action.operationId,
              action.replyId ?? "",
              action.idempotencyKey
            )
          : await this.execution.cancel(action.operationId, action.idempotencyKey);
      const updated = await this.completeAction(action, record, operation);
      return this.operationDto(operation, updated);
    } catch (error: unknown) {
      await this.store.saveAction({
        ...action,
        state: "uncertain",
        updatedAt: this.now().toISOString(),
      });
      throw error;
    }
  }

  private async completeAction(
    action: ActionRecord,
    record: SubmissionRecord,
    operation: OrderOperationView
  ): Promise<SubmissionRecord> {
    const updated = await this.saveParentOperation(record, operation);
    await this.store.saveAction({
      ...action,
      state: "completed",
      operation,
      updatedAt: this.now().toISOString(),
    });
    return updated;
  }

  private async saveParentOperation(
    record: SubmissionRecord,
    operation: OrderOperationView
  ): Promise<SubmissionRecord> {
    if (operation.operationId !== record.operationId) {
      throw new Error("Gateway returned a different parent operation identity");
    }
    const updated: SubmissionRecord = {
      ...record,
      operation,
      updatedAt: this.now().toISOString(),
    };
    await this.store.saveSubmission(updated);
    return updated;
  }

  private completeSubmission(
    record: SubmissionRecord,
    operation: OrderOperationView
  ): SubmissionRecord {
    return {
      ...record,
      state: "operation_known",
      operationId: operation.operationId,
      operation,
      updatedAt: this.now().toISOString(),
    };
  }
  private pendingAction(
    operationId: string,
    action: ActionRecord["action"],
    warningSequence: number | null,
    replyId: string | null
  ): ActionRecord {
    const timestamp = this.now().toISOString();
    return {
      schemaVersion: 1,
      operationId,
      action,
      warningSequence,
      replyId,
      idempotencyKey: this.key(),
      state: "pending",
      operation: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }
  private async requiredOperation(operationId: string): Promise<SubmissionRecord> {
    const record = await this.store.loadSubmissionByOperation(operationId);
    if (record?.operationId !== operationId) throw new Error("Unknown guarded operation identity");
    return record;
  }
  private async operationIdForPreview(previewId: string | undefined): Promise<string> {
    if (previewId === undefined) throw new Error("Operation ID is required");
    const record = await this.store.loadSubmission(previewId);
    if (record?.operationId === null || record?.operationId === undefined)
      throw new Error("Preview has no known operation ID");
    return record.operationId;
  }
  private submissionDto(record: SubmissionRecord): SubmissionDto {
    const operation = record.operation;
    if (operation === null || record.operationId === null)
      throw new Error("Operation evidence is missing");
    const result = operation.result;
    const first = result?.orders[0];
    return {
      state: this.dtoState(operation),
      previewId: record.previewId,
      operationId: record.operationId,
      operation,
      account: record.account,
      orderId: first?.orderId ?? null,
      clientOrderId: first?.clientOrderId ?? null,
      status: first?.status ?? null,
      updatedAt: operation.latestTransitionAt,
      warnings: this.warnings(operation),
      rejectionReasons:
        result !== null && (result.kind === "refused" || result.kind === "recovery_required")
          ? result.reasonCategories
          : [],
    };
  }
  private operationDto(operation: OrderOperationView, record: SubmissionRecord): OrderLifecycleDto {
    const base = this.submissionDto({ ...record, operation });
    return {
      ...base,
      verifiedAgainstPreview: true,
      quantity: null,
      filledQuantity: null,
      remainingQuantity: null,
      averagePrice: null,
      limitPrice: null,
      commissionAndFees: null,
    };
  }
  private dtoState(operation: OrderOperationView): SubmissionDto["state"] {
    return operation.result?.kind === "warning"
      ? "warning"
      : operation.result?.kind === "refused"
        ? "rejected"
        : operation.result?.kind === "recovery_required"
          ? "recovery_required"
          : "accepted";
  }
  private warnings(operation: OrderOperationView): SubmissionDto["warnings"] {
    return operation.pendingWarning === null
      ? []
      : [
          {
            sequence: operation.pendingWarning.sequence,
            replyId: operation.pendingWarning.replyId,
            messages: [],
            messageIds: [],
            known: true,
          },
        ];
  }
}
