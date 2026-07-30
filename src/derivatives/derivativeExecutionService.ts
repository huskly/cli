import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { DerivativeDiscoveryClient } from "./derivativeDiscovery.js";
import type {
  DerivativeExecutionClient,
  DerivativeOrderLifecycle,
  DerivativeOrderSubmissionResult,
  OrderWarning,
} from "./derivativeExecution.js";
import type { BrokerEnvironment, DerivativePreviewClient } from "./derivativePreview.js";
import { maskAccountId, spreadPreviewDtoSchema } from "./derivativePreviewService.js";
import type { DerivativePreviewService, SpreadPreviewDto } from "./derivativePreviewService.js";

interface PendingWarning {
  replyId: string;
  previewId: string;
  accountDigest: string;
  environment: BrokerEnvironment;
  warning: OrderWarning;
  clientOrderId: string;
}

interface OrderExpectation {
  orderId: string;
  previewId: string;
  accountDigest: string;
  environment: BrokerEnvironment;
  clientOrderId: string;
  preview: SpreadPreviewDto;
}

export interface ExecutionStateStore {
  saveWarning(value: PendingWarning): Promise<void>;
  loadWarning(replyId: string): Promise<PendingWarning | undefined>;
  deleteWarning(replyId: string): Promise<void>;
  saveOrder(value: OrderExpectation): Promise<void>;
  loadOrder(orderId: string): Promise<OrderExpectation | undefined>;
}

export class InMemoryExecutionStateStore implements ExecutionStateStore {
  private readonly warnings = new Map<string, PendingWarning>();
  private readonly orders = new Map<string, OrderExpectation>();

  saveWarning(value: PendingWarning): Promise<void> {
    this.warnings.set(value.replyId, value);
    return Promise.resolve();
  }

  loadWarning(replyId: string): Promise<PendingWarning | undefined> {
    return Promise.resolve(this.warnings.get(replyId));
  }

  deleteWarning(replyId: string): Promise<void> {
    this.warnings.delete(replyId);
    return Promise.resolve();
  }

  saveOrder(value: OrderExpectation): Promise<void> {
    this.orders.set(value.orderId, value);
    return Promise.resolve();
  }

  loadOrder(orderId: string): Promise<OrderExpectation | undefined> {
    return Promise.resolve(this.orders.get(orderId));
  }
}

const warningSchema = z.object({
  replyId: z.string(),
  previewId: z.string().regex(/^[a-f0-9]{64}$/),
  accountDigest: z.string().regex(/^[a-f0-9]{64}$/),
  environment: z.enum(["live", "paper"]),
  warning: z.object({
    replyId: z.string(),
    messages: z.array(z.string()),
    messageIds: z.array(z.string()),
    known: z.boolean(),
  }),
  clientOrderId: z.string(),
});
const orderExpectationSchema = z.object({
  orderId: z.string(),
  previewId: z.string().regex(/^[a-f0-9]{64}$/),
  accountDigest: z.string().regex(/^[a-f0-9]{64}$/),
  environment: z.enum(["live", "paper"]),
  clientOrderId: z.string(),
  preview: spreadPreviewDtoSchema,
});

/** Owner-readable workflow state; full account identifiers are never persisted. */
export class FileExecutionStateStore implements ExecutionStateStore {
  constructor(
    private readonly directory = process.env["HUSKLY_EXECUTION_DIR"] ??
      join(homedir(), ".cache", "huskly-cli", "execution")
  ) {}

  saveWarning(value: PendingWarning): Promise<void> {
    return this.write("warnings", value.replyId, value);
  }

  async loadWarning(replyId: string): Promise<PendingWarning | undefined> {
    const value = await this.read("warnings", replyId);
    return value === undefined ? undefined : warningSchema.parse(value);
  }

  deleteWarning(replyId: string): Promise<void> {
    return this.delete("warnings", replyId);
  }

  saveOrder(value: OrderExpectation): Promise<void> {
    return this.write("orders", value.orderId, value);
  }

  async loadOrder(orderId: string): Promise<OrderExpectation | undefined> {
    const value = await this.read("orders", orderId);
    return value === undefined
      ? undefined
      : (orderExpectationSchema.parse(value) as unknown as OrderExpectation);
  }

  private async write(kind: string, id: string, value: object): Promise<void> {
    const directory = join(this.directory, kind);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(join(directory, this.filename(id)), JSON.stringify(value), {
      encoding: "utf8",
      mode: 0o600,
    });
  }

  private async read(kind: string, id: string): Promise<unknown> {
    try {
      return JSON.parse(
        await readFile(join(this.directory, kind, this.filename(id)), "utf8")
      ) as unknown;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  private async delete(kind: string, id: string): Promise<void> {
    try {
      await unlink(join(this.directory, kind, this.filename(id)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private filename(id: string): string {
    return `${createHash("sha256").update(id).digest("hex")}.json`;
  }
}

export interface SubmissionDto {
  state: "accepted" | "warning" | "rejected";
  account: { maskedId: string; environment: BrokerEnvironment };
  previewId: string;
  orderId?: string;
  clientOrderId?: string;
  status?: DerivativeOrderLifecycle["status"];
  updatedAt?: string | null;
  warnings: OrderWarning[];
  rejectionReasons: string[];
}

export interface OrderLifecycleDto extends Omit<DerivativeOrderLifecycle, "accountId"> {
  account: { maskedId: string; environment: BrokerEnvironment };
  verifiedAgainstPreview: true;
}

interface LiveExecutionPolicy {
  enabled: boolean;
  accountAllowlist: string[];
}

const terminalStatuses = new Set(["FILLED", "CANCELED", "REJECTED"]);
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Guarded execution workflow shared by CLI and MCP handlers. */
export class DerivativeExecutionService {
  constructor(
    private readonly discovery: DerivativeDiscoveryClient,
    private readonly previewClient: DerivativePreviewClient,
    private readonly execution: DerivativeExecutionClient,
    private readonly previews: DerivativePreviewService,
    private readonly store: ExecutionStateStore = new InMemoryExecutionStateStore(),
    private readonly now: () => Date = () => new Date(),
    private readonly sleep: (ms: number) => Promise<void> = wait,
    private readonly livePolicy: LiveExecutionPolicy = {
      enabled: process.env["HUSKLY_ENABLE_LIVE_EXECUTION"] === "true",
      accountAllowlist: (process.env["HUSKLY_LIVE_ACCOUNT_ALLOWLIST"] ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    }
  ) {}

  async submit(input: {
    previewId: string;
    accountId: string;
    operator: string;
    confirm: true;
  }): Promise<SubmissionDto> {
    const diagnostics = await this.safeDiagnostics(input.accountId);
    this.assertEnvironmentAllowed(input.accountId, diagnostics.environment);
    const preview = await this.previews.validatePreview(input.previewId, {
      accountId: input.accountId,
      environment: diagnostics.environment,
    });
    await this.assertContractsUnchanged(preview);
    const clientOrderId = `huskly-${this.now().getTime().toString(36)}-${randomUUID()}`.slice(
      0,
      64
    );
    const result = await this.execution.submitDerivativeCombo({
      ...this.executionRequest(preview, input.accountId),
      clientOrderId,
      extOperator: input.operator,
      manualIndicator: true,
    });
    return this.handleSubmissionResult(result, preview, input.accountId, clientOrderId);
  }

  async acknowledgeWarning(input: {
    previewId: string;
    replyId: string;
    accountId: string;
    confirm: true;
  }): Promise<SubmissionDto> {
    const pending = await this.store.loadWarning(input.replyId);
    if (pending?.previewId !== input.previewId) {
      throw new Error("Warning reply does not match the exact preview");
    }
    if (!pending.warning.known) throw new Error("Unknown broker warning requires manual review");
    if (pending.accountDigest !== this.accountDigest(input.accountId)) {
      throw new Error("Warning reply account does not match");
    }
    const diagnostics = await this.safeDiagnostics(input.accountId);
    if (diagnostics.environment !== pending.environment) {
      throw new Error("Warning reply environment does not match");
    }
    const preview = await this.previews.validatePreview(input.previewId, {
      accountId: input.accountId,
      environment: diagnostics.environment,
    });
    await this.store.deleteWarning(input.replyId);
    const result = await this.execution.acknowledgeOrderWarning({
      replyId: input.replyId,
      confirmed: true,
    });
    return this.handleSubmissionResult(result, preview, input.accountId, pending.clientOrderId);
  }

  async getStatus(orderId: string, accountId: string): Promise<OrderLifecycleDto> {
    const expectation = await this.requiredExpectation(orderId, accountId);
    const lifecycle = await this.execution.getDerivativeOrderStatus(accountId, orderId);
    this.verifyLifecycle(lifecycle, expectation);
    return this.lifecycleDto(lifecycle, expectation.environment);
  }

  async watch(input: {
    orderId: string;
    accountId: string;
    timeoutMs?: number;
    pollMs?: number;
  }): Promise<OrderLifecycleDto> {
    const deadline = this.now().getTime() + (input.timeoutMs ?? 5 * 60 * 1000);
    for (;;) {
      const status = await this.getStatus(input.orderId, input.accountId);
      if (terminalStatuses.has(status.status)) return status;
      if (this.now().getTime() >= deadline)
        throw new Error("Timed out waiting for terminal order status");
      await this.sleep(input.pollMs ?? 2000);
    }
  }

  async cancel(input: {
    orderId: string;
    accountId: string;
    operator: string;
    confirm: true;
    timeoutMs?: number;
    pollMs?: number;
  }): Promise<OrderLifecycleDto> {
    const expectation = await this.requiredExpectation(input.orderId, input.accountId);
    const diagnostics = await this.safeDiagnostics(input.accountId);
    if (diagnostics.environment !== expectation.environment) {
      throw new Error("Order cancellation environment does not match its reviewed preview");
    }
    this.assertEnvironmentAllowed(input.accountId, diagnostics.environment);
    await this.execution.cancelDerivativeOrder({
      accountId: input.accountId,
      orderId: input.orderId,
      assetClass: expectation.preview.order.legs[0].contract.identity.assetClass,
      extOperator: input.operator,
      manualIndicator: true,
    });
    const terminal = await this.watch(input);
    if (terminal.status !== "CANCELED") {
      throw new Error(`Cancellation did not reach CANCELED; terminal status is ${terminal.status}`);
    }
    return terminal;
  }

  private async handleSubmissionResult(
    result: DerivativeOrderSubmissionResult,
    preview: SpreadPreviewDto,
    accountId: string,
    clientOrderId: string | null
  ): Promise<SubmissionDto> {
    if (result.state === "warning") {
      if (clientOrderId === null) throw new Error("Warning response omitted client order identity");
      for (const warning of result.warnings) {
        await this.store.saveWarning({
          replyId: warning.replyId,
          previewId: preview.previewId,
          accountDigest: this.accountDigest(accountId),
          environment: preview.account.environment,
          warning,
          clientOrderId,
        });
      }
      return {
        state: "warning",
        account: { maskedId: maskAccountId(accountId), environment: preview.account.environment },
        previewId: preview.previewId,
        status: "WARNING_PENDING",
        warnings: result.warnings,
        rejectionReasons: [],
      };
    }
    if (result.state === "rejected") {
      return {
        state: "rejected",
        account: { maskedId: maskAccountId(accountId), environment: preview.account.environment },
        previewId: preview.previewId,
        warnings: [],
        rejectionReasons: result.reasons,
      };
    }
    const effectiveClientOrderId = result.clientOrderId ?? clientOrderId;
    if (effectiveClientOrderId === null)
      throw new Error("Accepted order omitted client order identity");
    const expectation: OrderExpectation = {
      orderId: result.orderId,
      previewId: preview.previewId,
      accountDigest: this.accountDigest(accountId),
      environment: preview.account.environment,
      clientOrderId: effectiveClientOrderId,
      preview,
    };
    await this.store.saveOrder(expectation);
    await this.previews.consumePreview(preview.previewId);
    const lifecycle = await this.execution.getDerivativeOrderStatus(accountId, result.orderId);
    this.verifyLifecycle(lifecycle, expectation);
    return {
      state: "accepted",
      account: { maskedId: maskAccountId(accountId), environment: preview.account.environment },
      previewId: preview.previewId,
      orderId: result.orderId,
      clientOrderId: effectiveClientOrderId,
      status: lifecycle.status,
      updatedAt: lifecycle.updatedAt,
      warnings: result.warnings,
      rejectionReasons: [],
    };
  }

  private executionRequest(preview: SpreadPreviewDto, accountId: string) {
    return {
      accountId,
      legs: [
        { contract: preview.order.legs[0].contract, ratio: 1 as const },
        { contract: preview.order.legs[1].contract, ratio: -1 as const },
      ] as const,
      quantity: preview.order.quantity,
      priceEffect: preview.order.priceEffect,
      limit: preview.order.limit,
      tif: preview.order.tif,
      session: preview.order.session,
    };
  }

  private async assertContractsUnchanged(preview: SpreadPreviewDto): Promise<void> {
    for (const leg of preview.order.legs) {
      const identity = leg.contract.identity;
      const current = await this.discovery.resolveContract({
        assetClass: identity.assetClass,
        underlying: identity.underlying,
        expiration: identity.expiration,
        strike: identity.strike,
        right: identity.right,
        tradingClass: identity.tradingClass,
        exchange: identity.exchange,
      });
      if (JSON.stringify(current) !== JSON.stringify(leg.contract)) {
        throw new Error("Resolved contract drifted since preview");
      }
    }
  }

  private async safeDiagnostics(accountId: string) {
    const diagnostics = await this.previewClient.getTradingDiagnostics(accountId);
    if (
      !diagnostics.authenticated ||
      diagnostics.competingSession ||
      diagnostics.selectedAccountId !== accountId
    ) {
      throw new Error("Broker account/session is not safe for execution");
    }
    return diagnostics;
  }

  private assertEnvironmentAllowed(accountId: string, environment: BrokerEnvironment): void {
    if (environment === "paper") return;
    if (!this.livePolicy.enabled || !this.livePolicy.accountAllowlist.includes(accountId)) {
      throw new Error("Live execution requires explicit enablement and exact account allowlisting");
    }
  }

  private async requiredExpectation(orderId: string, accountId: string): Promise<OrderExpectation> {
    const expectation = await this.store.loadOrder(orderId);
    if (expectation === undefined) throw new Error("Unknown guarded order identity");
    if (expectation.accountDigest !== this.accountDigest(accountId)) {
      throw new Error("Order account does not match");
    }
    return expectation;
  }

  private verifyLifecycle(
    lifecycle: DerivativeOrderLifecycle,
    expectation: OrderExpectation
  ): void {
    const preview = expectation.preview;
    const expectedLegs = preview.order.legs.map(({ contract, ratio }) => ({
      conid: Number(contract.brokerReference?.contractId),
      ratio,
    }));
    if (JSON.stringify(lifecycle.legs) !== JSON.stringify(expectedLegs)) {
      throw new Error("Returned combo legs or ratios do not match the preview");
    }
    if (lifecycle.quantity !== preview.order.quantity) {
      throw new Error("Returned order quantity does not match the preview");
    }
    const expectedLimit =
      preview.order.priceEffect === "CREDIT" ? -preview.order.limit : preview.order.limit;
    if (lifecycle.limitPrice !== expectedLimit) {
      throw new Error("Returned order limit does not match the preview");
    }
    if (lifecycle.clientOrderId !== null && lifecycle.clientOrderId !== expectation.clientOrderId) {
      throw new Error("Returned client order ID does not match");
    }
  }

  private lifecycleDto(
    lifecycle: DerivativeOrderLifecycle,
    environment: BrokerEnvironment
  ): OrderLifecycleDto {
    const { accountId, ...rest } = lifecycle;
    return {
      ...rest,
      account: { maskedId: maskAccountId(accountId), environment },
      verifiedAgainstPreview: true,
    };
  }

  private accountDigest(accountId: string): string {
    return createHash("sha256").update(accountId).digest("hex");
  }
}
