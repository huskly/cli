import assert from "node:assert/strict";
import test from "node:test";
import { requireObservation } from "#src/brokers/brokerClient.js";

test("requireObservation preserves available evidence and rejects unavailable evidence", () => {
  const available = requireObservation("quotes", {
    observedAt: "2026-09-04T00:00:00.000Z",
    completeness: "partial",
    value: { ok: true },
  });
  assert.deepEqual(available.value, { ok: true });

  assert.throws(
    () =>
      requireObservation("quotes", {
        observedAt: "2026-09-04T00:00:00.000Z",
        completeness: "unavailable",
        value: {},
      }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "broker_data_unavailable"
  );
});
