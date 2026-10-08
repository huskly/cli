import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConsumerError } from "#src/gateway/gatewayErrors.js";
import {
  EquityOrderModificationService,
  InMemoryEquityModificationStore,
  FileEquityModificationStore,
  InMemoryModificationDeclineStore,
  FileModificationDeclineStore,
} from "#src/equities/equityOrderModification.js";
import type { GatewayMutationApi, OrderModification } from "#src/gateway/gatewayMutationAdapter.js";

const before = {
  symbol: "AAPL",
  conid: 265598,
  side: "BUY",
  orderType: "LMT",
  limit: 250,
  stopPrice: null,
  quantity: 10,
  filledQuantity: 2,
  tif: "DAY",
  session: "REGULAR",
} as const;
const accepted: OrderModification = {
  modificationId: "mod-1",
  orderId: "1234",
  ownerOperationId: null,
  state: "accepted",
  before,
  requested: { limit: 251 },
  submitted: { ...before, limit: 251, quantity: 10 },
  pendingWarning: null,
  reconciliation: null,
  result: { kind: "accepted", reasonCategories: [] },
  createdAt: "2026-10-08T00:00:00Z",
  latestTransitionAt: "2026-10-08T00:00:01Z",
};
function setup(initial: OrderModification = accepted) {
  const calls: { key: string; body: unknown }[] = [];
  const acknowledgements: { key: string; replyId: string }[] = [];
  let response = initial;
  const api = {
    createOrderModification: (body: unknown, key: string) => {
      calls.push({ body, key });
      return Promise.resolve(response);
    },
    acknowledgeOrderModificationWarning: (_id: string, replyId: string, key: string) => {
      acknowledgements.push({ key, replyId });
      response = { ...accepted };
      return Promise.resolve(response);
    },
    getOrderModification: () => Promise.resolve(response),
  } as unknown as GatewayMutationApi;
  const store = new InMemoryEquityModificationStore();
  const service = new EquityOrderModificationService(api, store, () => "key-1");
  return {
    service,
    store,
    calls,
    acknowledgements,
    setResponse: (next: OrderModification) => {
      response = next;
    },
  };
}
const input = {
  orderId: "1234",
  changes: { limit: 251 },
  operator: "alice",
  confirm: true,
} as const;

test("modification saves its key before its single create call and returns safe terms", async () => {
  const fake = setup();
  const dto = await fake.service.modify(input);
  assert.deepEqual(fake.calls, [
    {
      key: "key-1",
      body: {
        orderId: "1234",
        changes: { limit: 251 },
        extOperator: "alice",
        manualIndicator: true,
        confirm: true,
      },
    },
  ]);
  assert.equal(dto.modificationId, "mod-1");
  assert.ok(dto.before);
  assert.equal(dto.before.limit, 250);
  assert.equal(dto.submitted?.limit, 251);
  assert.equal(dto.acknowledgedWarnings, 0);
  assert.equal((await fake.store.load(input))?.idempotencyKey, undefined);
});

test("validation fails before any broker call or state write", async () => {
  const fake = setup();
  for (const changes of [
    {},
    { limit: 1, stopPrice: 2 },
    { limit: Infinity },
    { quantity: 1.5 },
    { tif: "IOC" },
  ]) {
    await assert.rejects(fake.service.modify({ ...input, changes } as never));
  }
  await assert.rejects(fake.service.modify({ ...input, confirm: false } as never));
  await assert.rejects(fake.service.modify({ ...input, orderId: " " }));
  await assert.rejects(fake.service.modify({ ...input, operator: " " }));
  assert.equal(fake.calls.length, 0);
});

test("a lost create answer keeps the saved key for a later run", async () => {
  const fake = setup();
  let count = 0;
  const api = {
    createOrderModification: (body: unknown, key: string) => {
      fake.calls.push({ body, key });
      if (++count === 1) return Promise.reject(new Error("lost"));
      return Promise.resolve(accepted);
    },
    acknowledgeOrderModificationWarning: () => Promise.resolve(accepted),
    getOrderModification: () => Promise.resolve(accepted),
  } as unknown as GatewayMutationApi;
  const service = new EquityOrderModificationService(api, fake.store, () => "key-2");
  await assert.rejects(service.modify(input), /lost/);
  assert.equal((await fake.store.load(input))?.idempotencyKey, "key-2");
  await service.modify(input);
  assert.deepEqual(
    fake.calls.map((call) => call.key),
    ["key-2", "key-2"]
  );
  assert.equal(await fake.store.load(input), undefined);
});

test("warning continuation uses bounded replies and the confirmed write", async () => {
  const warning: OrderModification = {
    ...accepted,
    state: "warning_pending",
    pendingWarning: { replyId: "reply-1", sequence: 1, messageIds: [] },
    result: null,
  };
  const fake = setup(warning);
  const result = await fake.service.modify(input);
  assert.equal(result.state, "accepted");
  assert.equal(result.acknowledgedWarnings, 1);
  assert.deepEqual(fake.acknowledgements, [{ key: "key-1", replyId: "reply-1" }]);
});

test("a repeated warning stops and preserves state", async () => {
  const warning: OrderModification = {
    ...accepted,
    state: "warning_pending",
    pendingWarning: { replyId: "reply-1", sequence: 1, messageIds: [] },
    result: null,
  };
  const fake = setup(warning);
  fake.setResponse(warning);
  const api = {
    createOrderModification: () => Promise.resolve(warning),
    acknowledgeOrderModificationWarning: () => Promise.resolve(warning),
    getOrderModification: () => Promise.resolve(warning),
  } as unknown as GatewayMutationApi;
  const service = new EquityOrderModificationService(api, fake.store);
  await assert.rejects(service.modify(input), /repeated warning reply/);
  assert.ok(await fake.store.load(input));
});

test("file recovery uses private modes and survives service restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "equity-modification-"));
  try {
    const directory = join(root, "state");
    const store = new FileEquityModificationStore(directory);
    const failed = {
      createOrderModification: () => Promise.reject(new Error("answer lost")),
    } as unknown as GatewayMutationApi;
    await assert.rejects(
      new EquityOrderModificationService(failed, store, () => "durable-key").modify(input),
      /answer lost/
    );
    assert.equal((await store.load(input))?.idempotencyKey, "durable-key");
    assert.equal((await stat(join(directory, "equity-modifications"))).mode & 0o777, 0o700);
    const resumed = setup();
    const api = {
      createOrderModification: (_body: unknown, key: string) => {
        assert.equal(key, "durable-key");
        return Promise.resolve(accepted);
      },
    } as unknown as GatewayMutationApi;
    await new EquityOrderModificationService(
      api,
      new FileEquityModificationStore(directory)
    ).modify(input);
    assert.equal(await store.load(input), undefined);
    assert.equal(resumed.calls.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("known preflight errors release reservation for a new command run", async () => {
  const store = new InMemoryEquityModificationStore();
  const preflight = new ConsumerError({
    code: "no_change",
    operation: "createOrderModification",
    message: "No change",
    status: 422,
    gatewayCode: null,
    retryAfterSeconds: undefined,
  });
  const api = {
    createOrderModification: () => Promise.reject(preflight),
  } as unknown as GatewayMutationApi;
  await assert.rejects(new EquityOrderModificationService(api, store).modify(input), /No change/);
  assert.equal(await store.load(input), undefined);
});

test("definitive validation errors release a reserved key", async () => {
  for (const status of [400, 422]) {
    const store = new InMemoryEquityModificationStore();
    const error = new ConsumerError({
      code: "gateway_transport_failure",
      operation: "createOrderModification",
      message: "Gateway request failed",
      status,
      gatewayCode: "invalid_request",
      retryAfterSeconds: undefined,
    });
    const api = {
      createOrderModification: () => Promise.reject(error),
    } as unknown as GatewayMutationApi;
    await assert.rejects(new EquityOrderModificationService(api, store).modify(input));
    assert.equal(await store.load(input), undefined);
  }
});
test("ambiguous outcomes preserve the reserved key for safe replay", async () => {
  for (const status of [undefined, 409, 500, 503]) {
    const store = new InMemoryEquityModificationStore();
    const error = new ConsumerError({
      code: "gateway_transport_failure",
      operation: "createOrderModification",
      message: "Gateway request failed",
      status,
      gatewayCode: null,
      retryAfterSeconds: undefined,
    });
    const api = {
      createOrderModification: () => Promise.reject(error),
    } as unknown as GatewayMutationApi;
    await assert.rejects(
      new EquityOrderModificationService(api, store, () => "saved-key").modify(input)
    );
    assert.equal((await store.load(input))?.idempotencyKey, "saved-key");
  }
});

test("rejected modification without live terms returns a nullable before", async () => {
  const fake = setup({
    ...accepted,
    before: null,
    submitted: null,
    state: "rejected_before_submission",
    result: null,
  });
  const dto = await fake.service.modify(input);
  assert.equal(dto.before, null);
  assert.equal(dto.state, "rejected_before_submission");
});

test("show reads one modification and reconciliation returns the safe new state", async () => {
  const calls: string[] = [];
  const next: OrderModification = {
    ...accepted,
    state: "not_applied",
    result: { kind: "not_applied", reasonCategories: [] },
    reconciliation: {
      observedAt: "2026-10-08T01:00:00Z",
      status: "matched",
      reason: "before_terms_match",
    },
  };
  const api = {
    getOrderModification: (id: string) => {
      calls.push(`get:${id}`);
      return Promise.resolve(accepted);
    },
    reconcileOrderModification: (id: string) => {
      calls.push(`reconcile:${id}`);
      return Promise.resolve(next);
    },
  } as unknown as GatewayMutationApi;
  const service = new EquityOrderModificationService(api, new InMemoryEquityModificationStore());
  assert.equal((await service.get("mod-1")).state, "accepted");
  const outcome = await service.reconcile("mod-1", true);
  assert.equal(outcome.state, "not_applied");
  assert.equal(outcome.result?.kind, "not_applied");
  assert.deepEqual(outcome.reconciliation, {
    observedAt: "2026-10-08T01:00:00Z",
    status: "matched",
    reason: "before_terms_match",
  });
  assert.deepEqual(calls, ["get:mod-1", "reconcile:mod-1"]);
  await assert.rejects(service.reconcile("mod-1", false), /Confirmation/);
  await assert.rejects(service.get("  "), /Invalid modification ID/);
});

test("decline saves one durable key, then uses it again after a lost response", async () => {
  const ids: string[] = [];
  let calls = 0;
  const declined: OrderModification = { ...accepted, state: "warning_declined" };
  const api = {
    declineOrderModificationWarning: (_id: string, key: string) => {
      ids.push(key);
      if (++calls === 1) return Promise.reject(new Error("answer lost"));
      return Promise.resolve(declined);
    },
  } as unknown as GatewayMutationApi;
  const service = new EquityOrderModificationService(
    api,
    new InMemoryEquityModificationStore(),
    () => "decline-key",
    new InMemoryModificationDeclineStore()
  );
  await assert.rejects(service.decline("mod-1", true), /answer lost/);
  assert.equal((await service.decline("mod-1", true)).state, "warning_declined");
  assert.deepEqual(ids, ["decline-key", "decline-key"]);
  await assert.rejects(service.decline("mod-1", false), /Confirmation/);
});

test("warning decline key survives restart in the private state directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "equity-decline-"));
  try {
    const store = new FileModificationDeclineStore(root);
    assert.equal(await store.create("mod-1", "first-key"), true);
    assert.equal(await new FileModificationDeclineStore(root).load("mod-1"), "first-key");
    assert.equal((await stat(join(root, "equity-modification-declines"))).mode & 0o777, 0o700);
    await store.delete("mod-1");
    assert.equal(await store.load("mod-1"), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("attested absence remains a distinct terminal modification state", async () => {
  const absent: OrderModification = {
    ...accepted,
    state: "operator_resolved_absent",
    reconciliation: {
      observedAt: "2026-10-08T01:00:00Z",
      status: "unavailable",
      reason: "operator_attested_absence",
    },
  };
  const api = {
    getOrderModification: () => Promise.resolve(absent),
  } as unknown as GatewayMutationApi;
  const service = new EquityOrderModificationService(api, new InMemoryEquityModificationStore());
  assert.equal((await service.get("mod-1")).state, "operator_resolved_absent");
});
