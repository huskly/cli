import { ConsumerError } from "#src/gateway/gatewayErrors.js";
import { PrivateJsonFile } from "#src/storage/privateJsonFile.js";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { DerivativeDiscoveryClient } from "./derivativeDiscovery.js";
import type {
  DerivativeExecutionClient,
  OrderOperationView,
  OrderReconciliationView,
} from "./derivativeExecution.js";
import type { CanonicalComboIntent, DerivativePreviewClient } from "./derivativePreview.js";
import {
  canonicalComboIntentSchema,
  type DerivativePreviewService,
  type SpreadPreviewDto,
} from "./derivativePreviewService.js";

export type SubmissionState = "submission_pending" | "submission_uncertain" | "operation_known";

export interface SubmissionRecord {
  readonly schemaVersion: 1;
  readonly previewId: string;
  readonly operationKind: "combo";
  readonly idempotencyKey: string;
  readonly canonicalIntent: CanonicalComboIntent;
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
  readonly replyId: string | null;
  readonly idempotencyKey: string;
  readonly state: "pending" | "uncertain" | "completed";
  readonly operation: OrderOperationView | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ExecutionStateStore {
  saveSubmission(value: SubmissionRecord): Promise<void>;
  loadSubmission(previewId: string): Promise<SubmissionRecord | undefined>;
  loadSubmissionByOperation(operationId: string): Promise<SubmissionRecord | undefined>;
  saveAction(value: ActionRecord): Promise<void>;
  loadAction(
    operationId: string,
    action: ActionRecord["action"]
  ): Promise<ActionRecord | undefined>;
}

export class InMemoryExecutionStateStore implements ExecutionStateStore {
  private readonly submissions = new Map<string, SubmissionRecord>();
  private readonly operationIndex = new Map<string, SubmissionRecord>();
  private readonly actions = new Map<string, ActionRecord>();

  saveSubmission(value: SubmissionRecord): Promise<void> {
    this.submissions.set(value.previewId, value);
    if (value.operationId !== null) this.operationIndex.set(value.operationId, value);
    return Promise.resolve();
  }
  loadSubmission(previewId: string): Promise<SubmissionRecord | undefined> {
    return Promise.resolve(this.submissions.get(previewId));
  }
  loadSubmissionByOperation(operationId: string): Promise<SubmissionRecord | undefined> {
    return Promise.resolve(this.operationIndex.get(operationId));
  }
  saveAction(value: ActionRecord): Promise<void> {
    this.actions.set(`${value.operationId}:${value.action}`, value);
    return Promise.resolve();
  }
  loadAction(
    operationId: string,
    action: ActionRecord["action"]
  ): Promise<ActionRecord | undefined> {
    return Promise.resolve(this.actions.get(`${operationId}:${action}`));
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
  replyId: z.string().nullable(),
  idempotencyKey: z.string().min(1).max(128),
  state: z.enum(["pending", "uncertain", "completed"]),
  operation: operationSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}) as unknown as z.ZodType<ActionRecord>;

/** Atomic owner-private state shared by separate CLI invocations. */
export class FileExecutionStateStore implements ExecutionStateStore {
  public constructor(
    private readonly directory = process.env["HUSKLY_EXECUTION_DIR"] ??
      join(homedir(), ".cache", "huskly-cli", "execution")
  ) {}
  async saveSubmission(value: SubmissionRecord): Promise<void> {
    await this.file("submissions", value.previewId, submissionSchema).save(value);
    if (value.operationId !== null) {
      await this.file("operations", value.operationId, submissionSchema).save(value);
    }
  }
  loadSubmission(previewId: string): Promise<SubmissionRecord | undefined> {
    return this.file("submissions", previewId, submissionSchema).load();
  }
  loadSubmissionByOperation(operationId: string): Promise<SubmissionRecord | undefined> {
    return this.file("operations", operationId, submissionSchema).load();
  }
  saveAction(value: ActionRecord): Promise<void> {
    return this.file("actions", `${value.operationId}:${value.action}`, actionSchema).save(value);
  }
  loadAction(
    operationId: string,
    action: ActionRecord["action"]
  ): Promise<ActionRecord | undefined> {
    return this.file("actions", `${operationId}:${action}`, actionSchema).load();
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
  readonly account: { readonly maskedId: string; readonly environment: "paper" | "live" };
  readonly orderId?: string;
  readonly clientOrderId?: string;
  readonly status?: NonNullable<OrderOperationView["result"]>["orders"][number]["status"];
  readonly updatedAt?: string | null;
  readonly warnings: readonly {
    readonly replyId: string;
    readonly messages: string[];
    readonly messageIds: string[];
    readonly known: boolean;
  }[];
  readonly rejectionReasons: readonly string[];
  readonly recovery?: {
    readonly reasons: readonly string[];
    readonly orders: readonly unknown[];
    readonly errors: readonly unknown[];
    readonly unrecognizedResponses: readonly unknown[];
  };
}

export interface OrderLifecycleDto extends SubmissionDto {
  readonly operationId: string;
  readonly operation: OrderOperationView;
  readonly account: { readonly maskedId: string; readonly environment: "paper" | "live" };
  readonly verifiedAgainstPreview: true;
  readonly orderId: string;
  readonly clientOrderId: string;
  readonly status: NonNullable<OrderOperationView["result"]>["orders"][number]["status"];
  readonly quantity: number;
  readonly filledQuantity: number;
  readonly remainingQuantity: number;
  readonly averagePrice: number | null;
  readonly limitPrice: number | null;
  readonly commissionAndFees: number | null;
  readonly legs: readonly { conid: number; ratio: number }[];
  readonly updatedAt: string;
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
    accountId?: string;
  }): Promise<SubmissionDto> {
    const existing = await this.store.loadSubmission(input.previewId);
    if (existing !== undefined)
      throw new Error("A submission record already exists for this preview");
    const preview = await this.previews.validatePreview(input.previewId);
    const createdAt = this.now().toISOString();
    const pending: SubmissionRecord = {
      schemaVersion: 1,
      previewId: preview.previewId,
      operationKind: "combo",
      idempotencyKey: this.key(),
      canonicalIntent: preview.order.gateway,
      state: "submission_pending",
      operationId: null,
      operation: null,
      createdAt,
      updatedAt: createdAt,
    };
    await this.store.saveSubmission(pending);
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
    return this.submissionDto(complete, preview.account);
  }

  async recover(input: { previewId: string }): Promise<SubmissionDto> {
    const record = await this.store.loadSubmission(input.previewId);
    if (record === undefined) throw new Error("Unknown submission record");
    if (record.state === "operation_known") throw new Error("Submission recovery is not required");
    const operation = await this.execution.lookup(record.operationKind, record.idempotencyKey);
    const complete = this.completeSubmission(record, operation);
    await this.store.saveSubmission(complete);
    await this.previews.consumePreview(record.previewId);
    return this.submissionDto(complete, { maskedId: "****", environment: "paper" });
  }

  async getStatus(operationId: string, _accountId?: string): Promise<OrderLifecycleDto> {
    const record = await this.requiredOperation(operationId);
    return this.operationDto(await this.execution.get(operationId), record);
  }

  async acknowledgeWarning(input: {
    operationId?: string;
    replyId: string;
    confirm: true;
    previewId?: string;
    accountId?: string;
  }): Promise<OrderLifecycleDto> {
    const operationId = input.operationId ?? (await this.operationIdForPreview(input.previewId));
    const record = await this.requiredOperation(operationId);
    if (record.operation?.pendingWarning?.replyId !== input.replyId) {
      throw new Error("Warning reply does not match the durable operation");
    }
    const existing = await this.store.loadAction(operationId, "warning_acknowledgement");
    if (existing !== undefined) {
      if (existing.state === "completed" && existing.operation !== null) {
        return this.operationDto(existing.operation, record);
      }
      throw new Error("Warning acknowledgement recovery is required");
    }
    const action = this.pendingAction(operationId, "warning_acknowledgement", input.replyId);
    await this.store.saveAction(action);
    try {
      const operation = await this.execution.acknowledge(
        operationId,
        input.replyId,
        action.idempotencyKey
      );
      await this.store.saveAction({
        ...action,
        state: "completed",
        operation,
        updatedAt: this.now().toISOString(),
      });
      return this.operationDto(operation, record);
    } catch (error: unknown) {
      await this.store.saveAction({
        ...action,
        state: "uncertain",
        updatedAt: this.now().toISOString(),
      });
      throw error;
    }
  }

  async reconcile(operationId: string): Promise<OrderReconciliationView> {
    await this.requiredOperation(operationId);
    return this.execution.reconcile(operationId);
  }

  async watch(input: {
    operationId: string;
    accountId?: string;
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
    accountId?: string;
    operator?: string;
    timeoutMs?: number;
    pollMs?: number;
  }): Promise<OrderLifecycleDto> {
    const record = await this.requiredOperation(input.operationId);
    const existing = await this.store.loadAction(input.operationId, "cancellation");
    if (existing !== undefined) {
      if (existing.state === "completed" && existing.operation !== null) {
        return this.operationDto(existing.operation, record);
      }
      throw new Error("Cancellation recovery is required");
    }
    const action = this.pendingAction(input.operationId, "cancellation", null);
    await this.store.saveAction(action);
    try {
      const operation = await this.execution.cancel(input.operationId, action.idempotencyKey);
      await this.store.saveAction({
        ...action,
        state: "completed",
        operation,
        updatedAt: this.now().toISOString(),
      });
      return this.operationDto(operation, record);
    } catch (error: unknown) {
      await this.store.saveAction({
        ...action,
        state: "uncertain",
        updatedAt: this.now().toISOString(),
      });
      throw error;
    }
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
    replyId: string | null
  ): ActionRecord {
    const timestamp = this.now().toISOString();
    return {
      schemaVersion: 1,
      operationId,
      action,
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
  private submissionDto(
    record: SubmissionRecord,
    account: SpreadPreviewDto["account"]
  ): SubmissionDto {
    const operation = record.operation;
    if (operation === null || record.operationId === null)
      throw new Error("Operation evidence is missing");
    const result = operation.result;
    const first = result?.orders[0];
    const state =
      result?.kind === "warning"
        ? "warning"
        : result?.kind === "refused"
          ? "rejected"
          : result?.kind === "recovery_required"
            ? "recovery_required"
            : "accepted";
    return {
      state,
      previewId: record.previewId,
      operationId: record.operationId,
      operation,
      account: { maskedId: account.maskedId ?? "****", environment: account.environment },
      ...(first?.orderId === null || first?.orderId === undefined
        ? {}
        : { orderId: first.orderId }),
      ...(first?.clientOrderId === null || first?.clientOrderId === undefined
        ? {}
        : { clientOrderId: first.clientOrderId }),
      ...(first === undefined ? {} : { status: first.status }),
      updatedAt: operation.latestTransitionAt,
      warnings:
        operation.pendingWarning === null
          ? []
          : [
              {
                replyId: operation.pendingWarning.replyId,
                messages: [],
                messageIds: [],
                known: true,
              },
            ],
      rejectionReasons:
        result !== null && (result.kind === "refused" || result.kind === "recovery_required")
          ? result.reasonCategories
          : [],
    };
  }
  private operationDto(operation: OrderOperationView, record: SubmissionRecord): OrderLifecycleDto {
    const first = operation.result?.orders[0];
    return {
      operationId: operation.operationId,
      operation,
      state:
        operation.result?.kind === "warning"
          ? "warning"
          : operation.result?.kind === "refused"
            ? "rejected"
            : operation.result?.kind === "recovery_required"
              ? "recovery_required"
              : "accepted",
      previewId: record.previewId,
      account: { maskedId: "****", environment: "paper" },
      verifiedAgainstPreview: true,
      warnings:
        operation.pendingWarning === null
          ? []
          : [
              {
                replyId: operation.pendingWarning.replyId,
                messages: [],
                messageIds: [],
                known: true,
              },
            ],
      rejectionReasons:
        operation.result !== null &&
        (operation.result.kind === "refused" || operation.result.kind === "recovery_required")
          ? operation.result.reasonCategories
          : [],
      orderId: first?.orderId ?? operation.operationId,
      clientOrderId: first?.clientOrderId ?? "",
      status: first?.status ?? "UNKNOWN",
      quantity: record.canonicalIntent.quantity,
      filledQuantity: 0,
      remainingQuantity: record.canonicalIntent.quantity,
      averagePrice: null,
      limitPrice:
        record.canonicalIntent.priceEffect === "CREDIT"
          ? -record.canonicalIntent.limit
          : record.canonicalIntent.limit,
      commissionAndFees: null,
      legs: record.canonicalIntent.legs.map((leg) => ({
        conid: Number(leg.contract.brokerReference?.contractId),
        ratio: leg.ratio,
      })),
      updatedAt: operation.latestTransitionAt,
    };
  }
}
