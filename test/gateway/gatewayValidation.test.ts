import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { ConsumerError } from "#src/gateway/gatewayErrors.js";
import { parseGatewayResponse } from "#src/gateway/gatewayValidation.js";

test("parseGatewayResponse returns validated data", () => {
  const result = parseGatewayResponse(
    "queryQuotes",
    z.object({ observedAt: z.string() }).strict(),
    { observedAt: "2026-09-04T00:00:00.000Z" }
  );
  assert.deepEqual(result, { observedAt: "2026-09-04T00:00:00.000Z" });
});

test("parseGatewayResponse throws a fixed redacted transport failure", () => {
  assert.throws(
    () =>
      parseGatewayResponse("queryQuotes", z.object({ observedAt: z.string() }).strict(), {
        observedAt: 123,
        secrets: { token: "abc" },
      }),
    (error: unknown) => {
      assert.ok(error instanceof ConsumerError);
      assert.equal(error.code, "gateway_transport_failure");
      assert.equal(error.operation, "queryQuotes");
      assert.equal(error.message, "Gateway request failed");
      assert.equal(error.status, undefined);
      assert.equal(error.gatewayCode, undefined);
      assert.equal(error.retryAfterSeconds, undefined);
      assert.doesNotMatch(JSON.stringify(error), /123|secrets|token|observedAt/i);
      return true;
    }
  );
});
