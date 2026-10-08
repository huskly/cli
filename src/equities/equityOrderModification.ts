import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type {
  CreateOrderModificationRequest,
  OrderModification,
} from "@huskly/ibkr-gateway-client";
import type { GatewayMutationApi } from "#src/gateway/gatewayMutationAdapter.js";
import { ConsumerError } from "#src/gateway/gatewayErrors.js";
import { PrivateJsonFile } from "#src/storage/privateJsonFile.js";

const changesSchema = z
  .strictObject({
    limit: z.number().positive().optional(),
    stopPrice: z.number().positive().optional(),
    quantity: z.number().int().positive().optional(),
    tif: z.enum(["DAY", "GTC"]).optional(),
  })
  .refine((changes) => Object.keys(changes).length > 0, "At least one order change is required")
  .refine(
    (changes) => changes.limit === undefined || changes.stopPrice === undefined,
    "Limit and stop price cannot be changed together"
  );
const inputSchema = z.strictObject({
  orderId: z.string().trim().min(1).max(128),
  changes: changesSchema,
  operator: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[ -~]+$/u)
    .refine((value) => value.trim() === value),
  confirm: z.literal(true),
});
const recordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  orderId: z.string(),
  changes: changesSchema,
  operator: z.string(),
  idempotencyKey: z.string().min(1),
  warning: z
    .strictObject({ replyId: z.string(), sequence: z.number(), key: z.string() })
    .nullable(),
});
const termsSchema = z.object({
  symbol: z.string().min(1).max(32),
  conid: z.number().int().positive(),
  side: z.enum(["BUY", "SELL"]),
  orderType: z.enum(["LMT", "STP"]),
  limit: z.number().positive().nullable(),
  stopPrice: z.number().positive().nullable(),
  quantity: z.number().int().positive(),
  tif: z.enum(["DAY", "GTC"]),
  session: z.enum(["REGULAR", "OVERNIGHT"]),
});
const modificationSchema = z.object({
  modificationId: z.string().min(1),
  orderId: z.string().min(1),
  ownerOperationId: z.string().nullable(),
  state: z.enum([
    "received",
    "rejected_before_submission",
    "broker_attempt_started",
    "accepted",
    "warning_pending",
    "warning_declined",
    "broker_refused",
    "unknown_outcome",
    "not_applied",
    "operator_resolved_absent",
  ]),
  before: termsSchema.extend({ filledQuantity: z.number().int().nonnegative() }).nullable(),
  requested: changesSchema,
  submitted: termsSchema.nullable(),
  reconciliation: z
    .object({
      observedAt: z.string(),
      status: z.enum(["matched", "conflicting", "unavailable"]),
      reason: z.string().max(256),
    })
    .nullable(),
  pendingWarning: z
    .object({
      replyId: z.string().min(1),
      sequence: z.number().int().positive(),
      messageIds: z.array(z.string()),
    })
    .nullable(),
  result: z
    .object({
      kind: z.enum(["accepted", "refused", "unknown_outcome", "not_applied"]),
      reasonCategories: z.array(z.string()),
    })
    .nullable(),
  createdAt: z.string(),
  latestTransitionAt: z.string(),
});
function safeModification(value: unknown): OrderModification {
  const parsed = modificationSchema.safeParse(value);
  if (!parsed.success) throw new Error("Gateway returned an invalid order modification");
  const requested = parsed.data.requested;
  return {
    ...parsed.data,
    requested: {
      ...(requested.limit === undefined ? {} : { limit: requested.limit }),
      ...(requested.stopPrice === undefined ? {} : { stopPrice: requested.stopPrice }),
      ...(requested.quantity === undefined ? {} : { quantity: requested.quantity }),
      ...(requested.tif === undefined ? {} : { tif: requested.tif }),
    },
  };
}
export type EquityModificationInput = z.input<typeof inputSchema>;
export type EquityModificationRecord = z.infer<typeof recordSchema>;
export type EquityModificationDto = Pick<
  OrderModification,
  | "modificationId"
  | "orderId"
  | "ownerOperationId"
  | "state"
  | "before"
  | "requested"
  | "submitted"
  | "result"
  | "createdAt"
  | "latestTransitionAt"
  | "reconciliation"
> & { readonly acknowledgedWarnings: number };

/** Private recovery state for the exact operator request. */
export interface EquityModificationStore {
  create(input: EquityModificationInput, record: EquityModificationRecord): Promise<boolean>;
  load(input: EquityModificationInput): Promise<EquityModificationRecord | undefined>;
  save(input: EquityModificationInput, record: EquityModificationRecord): Promise<void>;
  delete(input: EquityModificationInput): Promise<void>;
}
function fingerprint(input: EquityModificationInput): string {
  const changes = input.changes;
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.orderId,
        changes.limit ?? null,
        changes.stopPrice ?? null,
        changes.quantity ?? null,
        changes.tif ?? null,
        input.operator,
      ])
    )
    .digest("hex");
}
export class InMemoryEquityModificationStore implements EquityModificationStore {
  private readonly records = new Map<string, EquityModificationRecord>();
  async create(input: EquityModificationInput, record: EquityModificationRecord): Promise<boolean> {
    await Promise.resolve();
    const id = fingerprint(input);
    if (this.records.has(id)) return false;
    this.records.set(id, structuredClone(record));
    return true;
  }
  async load(input: EquityModificationInput): Promise<EquityModificationRecord | undefined> {
    await Promise.resolve();
    const record = this.records.get(fingerprint(input));
    return record === undefined ? undefined : structuredClone(record);
  }
  async save(input: EquityModificationInput, record: EquityModificationRecord): Promise<void> {
    await Promise.resolve();
    this.records.set(fingerprint(input), structuredClone(record));
  }
  async delete(input: EquityModificationInput): Promise<void> {
    await Promise.resolve();
    this.records.delete(fingerprint(input));
  }
}
export class FileEquityModificationStore implements EquityModificationStore {
  private readonly directory: string;
  constructor(
    directory = process.env["HUSKLY_EXECUTION_DIR"] ??
      join(homedir(), ".cache", "huskly-cli", "execution")
  ) {
    this.directory = join(directory, "equity-modifications");
  }
  private file(input: EquityModificationInput): PrivateJsonFile<EquityModificationRecord> {
    return new PrivateJsonFile({
      directory: this.directory,
      filename: `${fingerprint(input)}.json`,
      schema: recordSchema,
    });
  }
  create(input: EquityModificationInput, record: EquityModificationRecord): Promise<boolean> {
    return this.file(input).create(record);
  }
  load(input: EquityModificationInput): Promise<EquityModificationRecord | undefined> {
    return this.file(input).load();
  }
  save(input: EquityModificationInput, record: EquityModificationRecord): Promise<void> {
    return this.file(input).save(record);
  }
  delete(input: EquityModificationInput): Promise<void> {
    return this.file(input).delete();
  }
}

interface DeclineKeyStore {
  create(id: string, key: string): Promise<boolean>;
  load(id: string): Promise<string | undefined>;
  delete(id: string): Promise<void>;
}

/** Save a warning decline key before the gateway call so an uncertain answer can replay. */
export class FileModificationDeclineStore implements DeclineKeyStore {
  private readonly directory: string;
  constructor(
    directory = process.env["HUSKLY_EXECUTION_DIR"] ??
      join(homedir(), ".cache", "huskly-cli", "execution")
  ) {
    this.directory = join(directory, "equity-modification-declines");
  }
  private file(id: string): PrivateJsonFile<{ schemaVersion: 1; key: string }> {
    const name = createHash("sha256").update(id).digest("hex");
    return new PrivateJsonFile({
      directory: this.directory,
      filename: `${name}.json`,
      schema: z.strictObject({ schemaVersion: z.literal(1), key: z.string().min(1) }),
    });
  }
  create(id: string, key: string): Promise<boolean> {
    return this.file(id).create({ schemaVersion: 1, key });
  }
  async load(id: string): Promise<string | undefined> {
    return (await this.file(id).load())?.key;
  }
  delete(id: string): Promise<void> {
    return this.file(id).delete();
  }
}

/** In-memory recovery keys for tests and nonpersistent callers. */
export class InMemoryModificationDeclineStore implements DeclineKeyStore {
  private readonly keys = new Map<string, string>();
  async create(id: string, key: string): Promise<boolean> {
    await Promise.resolve();
    if (this.keys.has(id)) return false;
    this.keys.set(id, key);
    return true;
  }
  async load(id: string): Promise<string | undefined> {
    await Promise.resolve();
    return this.keys.get(id);
  }
  async delete(id: string): Promise<void> {
    await Promise.resolve();
    this.keys.delete(id);
  }
}

function validModificationId(value: string): string {
  if (value.length === 0 || value.length > 128 || value.trim() !== value || !/^[ -~]+$/.test(value))
    throw new Error("Invalid modification ID");
  return value;
}

type ValidatedInput = Omit<EquityModificationInput, "changes"> & {
  readonly changes: CreateOrderModificationRequest["changes"];
};

function validateInput(raw: EquityModificationInput): ValidatedInput {
  const validation = inputSchema.safeParse(raw);
  if (!validation.success) throw new Error("Invalid equity order modification request");
  const parsed = validation.data;
  return {
    ...parsed,
    changes: {
      ...(parsed.changes.limit === undefined ? {} : { limit: parsed.changes.limit }),
      ...(parsed.changes.stopPrice === undefined ? {} : { stopPrice: parsed.changes.stopPrice }),
      ...(parsed.changes.quantity === undefined ? {} : { quantity: parsed.changes.quantity }),
      ...(parsed.changes.tif === undefined ? {} : { tif: parsed.changes.tif }),
    } satisfies CreateOrderModificationRequest["changes"],
  };
}

function toDto(
  modification: OrderModification,
  acknowledgedWarnings: number
): EquityModificationDto {
  return {
    modificationId: modification.modificationId,
    orderId: modification.orderId,
    ownerOperationId: modification.ownerOperationId,
    state: modification.state,
    before: modification.before,
    requested: modification.requested,
    submitted: modification.submitted,
    result: modification.result,
    createdAt: modification.createdAt,
    latestTransitionAt: modification.latestTransitionAt,
    reconciliation: modification.reconciliation,
    acknowledgedWarnings,
  };
}

function definitiveNoWrite(error: unknown): boolean {
  return (
    error instanceof ConsumerError &&
    (error.status === 400 ||
      error.status === 422 ||
      [
        "order_not_found",
        "order_not_modifiable",
        "owner_operation_not_accepted",
        "no_change",
        "invalid_change",
        "blocked_by_operation",
      ].includes(error.code))
  );
}

/** Modify a live IBKR equity order with one durable key per unfinished request. */
export class EquityOrderModificationService {
  constructor(
    private readonly api: Pick<
      GatewayMutationApi,
      | "createOrderModification"
      | "getOrderModification"
      | "acknowledgeOrderModificationWarning"
      | "reconcileOrderModification"
      | "declineOrderModificationWarning"
    >,
    private readonly store: EquityModificationStore = new FileEquityModificationStore(),
    private readonly key: () => string = randomUUID,
    private readonly declines: DeclineKeyStore = new FileModificationDeclineStore()
  ) {}

  async modify(raw: EquityModificationInput): Promise<EquityModificationDto> {
    const input = validateInput(raw);
    const record = await this.reserve(input);
    const modification = await this.create(input, record);
    const { outcome, count } = await this.acknowledgeWarnings(input, record, modification);
    await this.store.delete(input);
    return toDto(outcome, count);
  }

  /** Read the latest known modification for the current machine. */
  async get(modificationId: string): Promise<EquityModificationDto> {
    const outcome = safeModification(
      await this.api.getOrderModification(validModificationId(modificationId))
    );
    return toDto(outcome, 0);
  }

  /** Use gateway reads to resolve an uncertain modification; never resend the broker write. */
  async reconcile(modificationId: string, confirm: boolean): Promise<EquityModificationDto> {
    if (!confirm) throw new Error("Confirmation must be exactly true");
    const outcome = safeModification(
      await this.api.reconcileOrderModification(validModificationId(modificationId))
    );
    return toDto(outcome, 0);
  }

  /** Decline an outstanding broker warning without a broker write. */
  async decline(modificationId: string, confirm: boolean): Promise<EquityModificationDto> {
    if (!confirm) throw new Error("Confirmation must be exactly true");
    const id = validModificationId(modificationId);
    let key = await this.declines.load(id);
    if (key === undefined) {
      const candidate = this.key();
      key = (await this.declines.create(id, candidate)) ? candidate : await this.declines.load(id);
      if (key === undefined) throw new Error("Warning decline reservation is unavailable");
    }
    let outcome: OrderModification;
    try {
      outcome = safeModification(await this.api.declineOrderModificationWarning(id, key));
    } catch (error: unknown) {
      if (definitiveNoWrite(error)) await this.declines.delete(id);
      throw error;
    }
    await this.declines.delete(id);
    return toDto(outcome, 0);
  }

  private async reserve(input: ValidatedInput): Promise<EquityModificationRecord> {
    let record = await this.store.load(input);
    if (record === undefined) {
      record = {
        schemaVersion: 1,
        orderId: input.orderId,
        changes: input.changes,
        operator: input.operator,
        idempotencyKey: this.key(),
        warning: null,
      };
      if (!(await this.store.create(input, record))) {
        record = await this.store.load(input);
        if (record === undefined) throw new Error("Order modification reservation is unavailable");
      }
    }
    if (
      record.orderId !== input.orderId ||
      JSON.stringify(record.changes) !== JSON.stringify(input.changes) ||
      record.operator !== input.operator
    )
      throw new Error("Order modification reservation does not match the request");
    return record;
  }

  private async create(
    input: ValidatedInput,
    record: EquityModificationRecord
  ): Promise<OrderModification> {
    try {
      // Replaying the same key is safe if the first gateway answer was lost.
      return safeModification(
        await this.api.createOrderModification(
          {
            orderId: input.orderId,
            changes: input.changes,
            extOperator: input.operator,
            manualIndicator: true,
            confirm: true,
          },
          record.idempotencyKey
        )
      );
    } catch (error: unknown) {
      if (definitiveNoWrite(error)) await this.store.delete(input);
      throw error;
    }
  }

  private async acknowledgeWarnings(
    input: EquityModificationInput,
    initialRecord: EquityModificationRecord,
    initial: OrderModification
  ): Promise<{ outcome: OrderModification; count: number }> {
    let record = initialRecord;
    let outcome = initial;
    let count = 0;
    const handled = new Set<string>();
    while (outcome.state === "warning_pending") {
      const warning = outcome.pendingWarning;
      if (warning === null)
        throw new Error("Broker modification is warning_pending without a warning reply");
      const identity = `${String(warning.sequence)}:${warning.replyId}`;
      if (handled.has(identity)) throw new Error("Broker returned a repeated warning reply");
      if (handled.size >= 32) throw new Error("Broker returned too many sequential warnings");
      handled.add(identity);
      const pending: NonNullable<EquityModificationRecord["warning"]> =
        record.warning?.replyId === warning.replyId && record.warning.sequence === warning.sequence
          ? record.warning
          : { replyId: warning.replyId, sequence: warning.sequence, key: this.key() };
      record = { ...record, warning: pending };
      await this.store.save(input, record);
      outcome = safeModification(
        await this.api.acknowledgeOrderModificationWarning(
          outcome.modificationId,
          warning.replyId,
          pending.key
        )
      );
      count++;
    }
    return { outcome, count };
  }
}
