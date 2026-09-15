import assert from "node:assert/strict";
import test from "node:test";
import type { OrderOperation } from "@huskly/ibkr-gateway-client";
import type { Observation } from "#src/brokers/brokerClient.js";
import type {
  DerivativeContract,
  DerivativeDiscoveryClient,
} from "#src/derivatives/derivativeDiscovery.js";
import { InMemoryExecutionStateStore } from "#src/derivatives/derivativeExecutionService.js";
import type {
  CanonicalSingleOptionIntent,
  OptionOrderDiagnostics,
  OptionOrderGatewayClient,
} from "#src/options/optionOrder.js";
import {
  OptionOrderService,
  type PlaceSingleOptionOrderInput,
} from "#src/options/optionOrderService.js";

const contract: DerivativeContract = {
  identity: {
    assetClass: "OPT",
    underlying: "IBIT",
    expiration: "2026-10-02",
    strike: 42,
    right: "PUT",
    tradingClass: "IBIT",
    exchange: "SMART",
    multiplier: 100,
  },
  brokerReference: { broker: "ibkr", contractId: "775665501" },
};

const diagnostics: OptionOrderDiagnostics = {
  environment: "paper",
  accountVerified: true,
  newMutationReady: true,
  recoveryMutationReady: true,
  maskedAccountDisplay: "D***567",
};

const operation = {
  operationId: "op-1",
  kind: "single",
  action: "submission",
  state: "accepted",
  createdAt: "2026-09-15T00:00:00.000Z",
  latestTransitionAt: "2026-09-15T00:00:01.000Z",
  pendingWarning: null,
  reconciliation: null,
  children: [],
  correlations: [],
  parentOperationId: null,
  intentSchemaVersion: 1,
  intentHash: "hash",
  result: { kind: "accepted", warningCount: 0, orders: [] },
} as unknown as OrderOperation;

const input: PlaceSingleOptionOrderInput = {
  assetClass: "OPT",
  underlying: "IBIT",
  expiration: "2026-10-02",
  strike: 42,
  right: "PUT",
  side: "SELL",
  quantity: 1,
  limit: 0.99,
  tif: "DAY",
  session: "REGULAR",
  operator: "alice",
  confirm: true,
};

function discovery(value: DerivativeContract | null = contract): DerivativeDiscoveryClient {
  return {
    resolveContract: () =>
      Promise.resolve({
        value,
        completeness: "complete",
        observedAt: "2026-09-15T00:00:00.000Z",
      } as unknown as Observation<DerivativeContract | null>),
  } as unknown as DerivativeDiscoveryClient;
}

function gateway(overrides: Partial<OptionOrderGatewayClient> = {}): OptionOrderGatewayClient {
  return {
    getTradingDiagnostics: () => Promise.resolve(diagnostics),
    create: () => Promise.resolve(operation),
    lookup: () => Promise.resolve(operation),
    ...overrides,
  };
}

function service(
  overrides: Partial<OptionOrderGatewayClient> = {},
  store = new InMemoryExecutionStateStore(),
  contractValue: DerivativeContract | null = contract
): { service: OptionOrderService; store: InMemoryExecutionStateStore } {
  return {
    service: new OptionOrderService(
      discovery(contractValue),
      gateway(overrides),
      store,
      () => new Date("2026-09-15T00:00:00.000Z"),
      () => "nonce",
      () => "key-1"
    ),
    store,
  };
}

void test("place resolves the exact contract and submits one guarded order", async () => {
  let received: [CanonicalSingleOptionIntent, string, string] | undefined;
  const { service: subject, store } = service({
    create: (intent, key, operator) => {
      received = [intent, key, operator];
      return Promise.resolve(operation);
    },
  });

  const result = await subject.place(input);

  assert.ok(received !== undefined);
  const [intent, key, operator] = received;
  assert.deepEqual(intent, {
    contract: {
      conid: 775665501,
      assetClass: "OPT",
      underlying: "IBIT",
      expiration: "2026-10-02",
      tradingClass: "IBIT",
      exchange: "SMART",
      multiplier: 100,
      strike: 42,
      right: "P",
    },
    side: "SELL",
    quantity: 1,
    tif: "DAY",
    session: "REGULAR",
    orderType: "LMT",
    limit: 0.99,
  });
  assert.equal(key, "key-1");
  assert.equal(operator, "alice");
  assert.equal(result.recovered, false);
  assert.equal(result.account.maskedId, "D***567");
  assert.match(result.orderRef, /^[a-f0-9]{64}$/);

  const stored = await store.loadSubmission(result.orderRef);
  assert.ok(stored !== undefined);
  assert.equal(stored.state, "operation_known");
  assert.equal(stored.operationId, "op-1");
  assert.deepEqual(await store.loadSubmissionByOperation("op-1"), stored);
});

void test("place refuses an unconfirmed order before it touches the gateway", async () => {
  let called = false;
  const { service: subject } = service({
    getTradingDiagnostics: () => {
      called = true;
      return Promise.resolve(diagnostics);
    },
  });

  await assert.rejects(subject.place({ ...input, confirm: false }), /requires --confirm/);
  assert.equal(called, false);
});

void test("place refuses invalid terms, a closed gateway, and an unresolved contract", async () => {
  await assert.rejects(
    service().service.place({ ...input, quantity: 0 }),
    /whole number of contracts/
  );
  await assert.rejects(service().service.place({ ...input, limit: 0 }), /limit price above zero/);
  await assert.rejects(service().service.place({ ...input, operator: " a" }), /operator identity/);
  await assert.rejects(
    service({
      getTradingDiagnostics: () => Promise.resolve({ ...diagnostics, newMutationReady: false }),
    }).service.place(input),
    /not ready for a new order mutation/
  );
  await assert.rejects(
    service({}, new InMemoryExecutionStateStore(), null).service.place(input),
    /No exact IBIT 2026-10-02 42 PUT contract/
  );
});

void test("a lost create response stays recoverable through one reservation", async () => {
  const store = new InMemoryExecutionStateStore();
  const { service: failing } = service(
    { create: () => Promise.reject(new Error("timeout")) },
    store
  );

  const orderRef = await refFromFailure(failing);
  const stored = await store.loadSubmission(orderRef);
  assert.equal(stored?.state, "submission_uncertain");

  let lookedUp: string | undefined;
  const { service: recovering } = service(
    {
      lookup: (key) => {
        lookedUp = key;
        return Promise.resolve(operation);
      },
      create: () => Promise.reject(new Error("must not submit again")),
    },
    store
  );
  const recovered = await recovering.recover(orderRef);

  assert.equal(lookedUp, "key-1");
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.operation.operationId, "op-1");
  assert.equal((await store.loadSubmission(orderRef))?.state, "operation_known");
});

void test("recover refuses an unknown or malformed order reference", async () => {
  const { service: subject } = service();
  await assert.rejects(subject.recover("not-a-ref"), /Invalid order reference/);
  await assert.rejects(subject.recover("a".repeat(64)), /Unknown order reference/);
});

/** The failure states the durable order reference. Recovery starts from it. */
async function refFromFailure(subject: OptionOrderService): Promise<string> {
  try {
    await subject.place(input);
  } catch (error: unknown) {
    const match = /[a-f0-9]{64}/.exec(error instanceof Error ? error.message : "");
    if (match !== null) return match[0];
  }
  throw new Error("The failing submission stated no order reference");
}
