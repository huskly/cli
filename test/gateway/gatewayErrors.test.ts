import assert from "node:assert/strict";
import test from "node:test";
import {
  IbkrGatewayApiError,
  IbkrGatewayTransportError,
  IbkrGatewayVersionError,
} from "@huskly/ibkr-gateway-client";
import { ConsumerError, toConsumerError } from "#src/gateway/gatewayErrors.js";

void test("keeps only safe fields when it serializes a consumer error", () => {
  const error = new ConsumerError({
    code: "authorization_failure",
    operation: "createOrderOperation",
    message: "Gateway authorization failed",
    status: 403,
    gatewayCode: "forbidden",
    retryAfterSeconds: 120,
  });

  const serialized = JSON.stringify(error);
  assert.match(serialized, /authorization_failure/u);
  assert.match(serialized, /createOrderOperation/u);
  assert.doesNotMatch(serialized, /bearer-token|basic\s+[a-z0-9+/=]+|client-secret|acct-123/u);
});

void test("translates only stable generated-client failures with fixed messages", () => {
  const unauthorized = toConsumerError(
    "queryQuotes",
    new IbkrGatewayApiError({ operation: "queryQuotes", status: 401, code: "unauthenticated" })
  );
  assert.equal(unauthorized.code, "authentication_failure");
  assert.equal(unauthorized.message, "Gateway authentication failed");

  const forbidden = toConsumerError(
    "createOrderOperation",
    new IbkrGatewayApiError({ operation: "createOrderOperation", status: 403, code: "forbidden" })
  );
  assert.equal(forbidden.code, "authorization_failure");
  assert.equal(forbidden.message, "Gateway authorization failed");

  const version = toConsumerError(
    "queryQuotes",
    new IbkrGatewayVersionError({ expected: "0.5.0", received: "0.4.0" })
  );
  assert.equal(version.code, "api_version_mismatch");
  assert.equal(version.message, "Gateway API version is not compatible");

  const transport = toConsumerError(
    "queryQuotes",
    new IbkrGatewayTransportError("queryQuotes", "queryQuotes could not reach the gateway")
  );
  assert.equal(transport.code, "gateway_transport_failure");
  assert.equal(transport.message, "Gateway request failed");

  const broker = toConsumerError(
    "queryQuotes",
    new IbkrGatewayApiError({ operation: "queryQuotes", status: 503, code: "broker_unavailable" })
  );
  assert.equal(broker.code, "broker_data_unavailable");

  const mutation = toConsumerError(
    "createOrderOperation",
    new IbkrGatewayApiError({
      operation: "createOrderOperation",
      status: 503,
      code: "mutation_unavailable",
    })
  );
  assert.equal(mutation.code, "mutation_unavailable");

  const conflict = toConsumerError(
    "createOrderOperation",
    new IbkrGatewayApiError({
      operation: "createOrderOperation",
      status: 409,
      code: "idempotency_conflict",
    })
  );
  assert.equal(conflict.code, "idempotency_conflict");
});

void test("does not copy unstable messages, causes, or response details", () => {
  const source = new Error("bearer-token client-secret acct-123");
  const error = toConsumerError(
    "queryQuotes",
    new IbkrGatewayTransportError(
      "queryQuotes",
      "queryQuotes could not read the gateway response body"
    )
  );

  assert.equal(error.operation, "queryQuotes");
  assert.doesNotMatch(error.message, /bearer-token|client-secret|acct-123/u);
  assert.doesNotMatch(JSON.stringify({ error, source }), /bearer-token|client-secret|acct-123/u);
});
