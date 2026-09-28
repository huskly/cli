import { createHash, randomUUID } from "node:crypto";
import type { OrderOperation } from "@huskly/ibkr-gateway-client";
import { requireObservation } from "#src/brokers/brokerClient.js";
import type {
  DerivativeAssetClass,
  DerivativeDiscoveryClient,
  DerivativeRight,
} from "#src/derivatives/derivativeDiscovery.js";
import type { BrokerEnvironment } from "#src/derivatives/derivativePreview.js";
import {
  InMemoryExecutionStateStore,
  type ExecutionStateStore,
  type SingleSubmissionRecord,
} from "#src/derivatives/derivativeExecutionService.js";
import { derivativeMutationContract } from "#src/gateway/gatewayMutationAdapter.js";
import type {
  CanonicalSingleOptionIntent,
  OptionOrderDiagnostics,
  OptionOrderGatewayClient,
} from "./optionOrder.js";

export interface PlaceSingleOptionOrderInput {
  readonly assetClass: DerivativeAssetClass;
  readonly underlying: string;
  readonly expiration: string;
  readonly strike: number;
  readonly right: DerivativeRight;
  readonly tradingClass?: string;
  readonly exchange?: string;
  readonly side: "BUY" | "SELL";
  readonly quantity: number;
  readonly limit: number;
  readonly tif: "DAY" | "GTC";
  readonly session: "REGULAR" | "OVERNIGHT";
  readonly operator: string;
  readonly confirm: boolean;
}

export interface OptionSubmissionDto {
  readonly orderRef: string;
  readonly account: {
    readonly maskedId: string | null;
    readonly environment: BrokerEnvironment;
  };
  readonly order: CanonicalSingleOptionIntent;
  readonly operation: OrderOperation;
  readonly recovered: boolean;
}

/**
 * Guarded single-leg option orders for the IBKR gateway.
 *
 * @remarks
 * The gateway has no What-If for one derivative leg, so this service cannot
 * offer the preview/submit split that equities and verticals use. It keeps the
 * two properties that matter instead: an explicit confirmation, and a durable
 * idempotency reservation written before the broker call. A lost response
 * leaves an `submission_uncertain` record that {@link OptionOrderService.recover}
 * resolves through the same reservation. It never submits the order twice.
 */
export class OptionOrderService {
  public constructor(
    private readonly discovery: DerivativeDiscoveryClient,
    private readonly gateway: OptionOrderGatewayClient,
    private readonly store: ExecutionStateStore = new InMemoryExecutionStateStore(),
    private readonly now: () => Date = () => new Date(),
    private readonly nonce: () => string = randomUUID,
    private readonly key: () => string = randomUUID
  ) {}

  public async place(input: PlaceSingleOptionOrderInput): Promise<OptionSubmissionDto> {
    if (!input.confirm) throw new Error("This operation requires --confirm.");
    const operator = validateOperator(input.operator);
    const diagnostics = await this.gateway.getTradingDiagnostics();
    requireMutationReady(diagnostics);
    const canonicalIntent = await this.resolveIntent(input);
    const timestamp = this.now().toISOString();
    const orderRef = hash({ canonicalIntent, nonce: this.nonce() });
    const pending: SingleSubmissionRecord = {
      schemaVersion: 1,
      previewId: orderRef,
      operationKind: "single",
      idempotencyKey: this.key(),
      canonicalIntent,
      operator,
      intentHash: hash(canonicalIntent),
      account: account(diagnostics),
      state: "submission_pending",
      operationId: null,
      operation: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    if (!(await this.store.reserveSubmission(pending))) {
      throw new Error("A submission record already exists for this order reference");
    }
    let operation: OrderOperation;
    try {
      operation = await this.gateway.create(canonicalIntent, pending.idempotencyKey, operator);
    } catch (error: unknown) {
      await this.store.saveSubmission({
        ...pending,
        state: "submission_uncertain",
        updatedAt: this.now().toISOString(),
      });
      throw new Error(
        `The option order outcome is unknown. Recover it with the order reference ${orderRef}.`,
        { cause: error }
      );
    }
    return this.complete(pending, operation, false);
  }

  /** Resolve a lost or uncertain submission through its durable reservation. */
  public async recover(orderRef: string): Promise<OptionSubmissionDto> {
    const record = await this.requiredRecord(orderRef);
    if (record.state === "operation_known" && record.operation !== null) {
      return dto(record, record.operation, true);
    }
    const diagnostics = await this.gateway.getTradingDiagnostics();
    requireRecoveryReady(diagnostics);
    if (diagnostics.environment !== record.account.environment) {
      throw new Error("Submission environment does not match the current gateway");
    }
    return this.complete(record, await this.gateway.lookup(record.idempotencyKey), true);
  }

  private async resolveIntent(
    input: PlaceSingleOptionOrderInput
  ): Promise<CanonicalSingleOptionIntent> {
    if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
      throw new Error("Quantity must be a whole number of contracts above zero");
    }
    if (!Number.isFinite(input.limit) || input.limit <= 0) {
      throw new Error("A limit price above zero is required");
    }
    const observation = await this.discovery.resolveContract({
      assetClass: input.assetClass,
      underlying: input.underlying,
      expiration: input.expiration,
      right: input.right,
      strike: input.strike,
      ...(input.tradingClass === undefined ? {} : { tradingClass: input.tradingClass }),
      ...(input.exchange === undefined ? {} : { exchange: input.exchange }),
    });
    const resolved = requireObservation("resolveDerivativeContract", observation);
    if (resolved.value === null) {
      throw new Error(
        `No exact ${input.underlying} ${input.expiration} ${String(input.strike)} ${input.right} contract was returned.`
      );
    }
    return {
      contract: derivativeMutationContract(resolved.value),
      side: input.side,
      quantity: input.quantity,
      tif: input.tif,
      session: input.session,
      orderType: "LMT",
      limit: input.limit,
    };
  }

  private async requiredRecord(orderRef: string): Promise<SingleSubmissionRecord> {
    if (!/^[a-f0-9]{64}$/.test(orderRef)) throw new Error("Invalid order reference");
    const record = await this.store.loadSubmission(orderRef);
    if (record === undefined) throw new Error("Unknown order reference");
    if (record.operationKind !== "single" || !isOptionIntent(record.canonicalIntent)) {
      throw new Error("Order reference is not a single-leg option order");
    }
    if (record.intentHash !== hash(record.canonicalIntent)) {
      throw new Error("Submission record does not match its stored intent");
    }
    return record;
  }

  private async complete(
    record: SingleSubmissionRecord,
    operation: OrderOperation,
    recovered: boolean
  ): Promise<OptionSubmissionDto> {
    validateOperation(operation);
    const complete: SingleSubmissionRecord = {
      ...record,
      state: "operation_known",
      operationId: operation.operationId,
      operation,
      updatedAt: this.now().toISOString(),
    };
    await this.store.saveSubmission(complete);
    return dto(complete, operation, recovered);
  }
}

function dto(
  record: SingleSubmissionRecord,
  operation: OrderOperation,
  recovered: boolean
): OptionSubmissionDto {
  const order = record.canonicalIntent;
  if (!isOptionIntent(order)) {
    throw new Error("Order reference is not a single-leg option order");
  }
  return {
    orderRef: record.previewId,
    account: record.account,
    order,
    operation,
    recovered,
  };
}

/** A `single` submission record can hold an equity, forex, or option intent. */
function isOptionIntent(
  intent: SingleSubmissionRecord["canonicalIntent"]
): intent is CanonicalSingleOptionIntent {
  return intent.contract.assetClass === "OPT" || intent.contract.assetClass === "FOP";
}

function account(diagnostics: OptionOrderDiagnostics): SingleSubmissionRecord["account"] {
  return {
    maskedId: diagnostics.maskedAccountDisplay,
    environment: diagnostics.environment,
  };
}

function validateOperation(operation: OrderOperation): void {
  if (operation.kind !== "single" || operation.operationId.length === 0) {
    throw new Error("Gateway returned an invalid option operation");
  }
}

function validateOperator(value: string): string {
  if (value.length < 1 || value.length > 64 || value.trim() !== value || /[^ -~]/.test(value)) {
    throw new Error("Invalid operator identity");
  }
  return value;
}

function requireMutationReady(diagnostics: OptionOrderDiagnostics): void {
  if (!diagnostics.accountVerified || !diagnostics.newMutationReady) {
    throw new Error("Gateway is not ready for a new order mutation");
  }
}

function requireRecoveryReady(diagnostics: OptionOrderDiagnostics): void {
  if (!diagnostics.accountVerified || !diagnostics.recoveryMutationReady) {
    throw new Error("Gateway is not ready for order recovery");
  }
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}
