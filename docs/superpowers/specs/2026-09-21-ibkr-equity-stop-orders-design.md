# Guarded IBKR Equity STOP Orders Design

## Goal

Add native IBKR stop-market orders to the guarded equity preview and submit flow. Keep all current limit-order commands valid. Keep preview non-submitting and bind submission to the exact reviewed terms.

This change applies to these repositories:

1. `@huskly/ibkr-client`
2. `@huskly/ibkr-gateway` and its generated client
3. `huskly-cli`

## Scope

The feature supports positive whole-share BUY and SELL STOP orders for the US-listed stocks and ETFs that the equity flow already resolves. It supports the existing `DAY` and `GTC` durations and `REGULAR` and `OVERNIGHT` session values. IBKR What-If remains the authority for combinations that the broker does not accept.

The feature does not add stop-limit, trailing-stop, bracket, synthetic, or client-monitored orders. It does not change contract resolution, account authority, warning handling, recovery, reconciliation, status, or cancellation.

## Public behavior

The current limit command stays valid and defaults to a limit order:

```sh
huskly-cli equity preview AAPL SELL 10 --limit 250
```

A caller can also state the limit type:

```sh
huskly-cli equity preview AAPL SELL 10 \
  --order-type LIMIT \
  --limit 250
```

A stop order requires the explicit STOP type and stop price:

```sh
huskly-cli equity preview AAPL SELL 10 \
  --order-type STOP \
  --stop-price 240
```

The CLI accepts `LIMIT` and `STOP`. Internal broker and gateway contracts use `LMT` and `STP`.

Input rules are:

- Omitted `--order-type` means `LIMIT`.
- `LIMIT` requires one positive finite `--limit` value.
- `LIMIT` rejects `--stop-price`.
- `STOP` requires one positive finite `--stop-price` value.
- `STOP` rejects `--limit`.
- Invalid combinations fail before contract resolution or any gateway request.

The MCP `preview_equity_order` tool adds `orderType: "LIMIT" | "STOP"`, with `LIMIT` as the default, and optional `limit` and `stopPrice` fields. Runtime validation applies the same exclusive price rules as the CLI. `submit_equity_order` does not gain economic inputs. It continues to accept only the preview ID, operator, and confirmation.

## Domain model

Every layer uses a discriminated union instead of optional price fields on one broad object.

The public Huskly form is equivalent to:

```ts
type EquityOrderTerms =
  | { readonly orderType: "LMT"; readonly limit: number }
  | { readonly orderType: "STP"; readonly stopPrice: number };
```

The applicable price is required. The other price field is not allowed. Canonical intent, preview persistence, submission reservation, content hashing, and reconciliation all retain this distinction.

Safe output includes `orderType` and only the applicable price. It does not invent a limit price for a STOP order or a stop price for a LIMIT order.

## Low-level IBKR client

Change `EquityOrderPreviewRequest` and `EquityOrderRequest` from limit-only interfaces to discriminated request types. Preserve all shared account, contract, side, quantity, duration, session, and client-order identity fields.

Map the types to native IBKR fields as follows:

- `LMT`: send the existing limit-order type and limit price.
- `STP`: send the native stop-order type and auxiliary stop price.

Validate order terms before a broker call. Reject missing, non-finite, zero, negative, or conflicting price fields. Do not convert STOP into a monitored market order.

Add tests for exact preview and submission payloads for BUY and SELL STOP orders. Keep the existing limit tests. Add type-boundary coverage for both union members and runtime rejection coverage for invalid combinations.

## Gateway and generated client

Extend the equity member of `PreviewOrdersRequest` with an `STP` variant that requires `stopPrice`. Extend the equity member of `SingleOrderOperationRequest` in the same way, including the current operator fields.

Update together:

- Runtime mutation types.
- Fastify route schemas.
- OpenAPI schemas.
- Mutation adapter mappings.
- Durable operation schemas.
- Recovery and reconciliation comparisons.
- Package-boundary tests.
- Generated `@huskly/ibkr-gateway-client` types and fixtures.

The schemas must reject a mixed object that has both `limit` and `stopPrice`. They must also reject an `STP` object without `stopPrice` and an `LMT` object without `limit`.

Preview calls the low-level client once in What-If mode. Submission creates one durable operation with the same existing idempotency behavior. Warning continuation, recovery, status, reconciliation, and cancellation operate on STOP orders through the same generic lifecycle.

## CLI and MCP service

Extend `CanonicalEquityIntent` with `LMT` and `STP` variants. The equity service maps the public CLI and MCP names to this canonical form before it calls the gateway.

Preview persistence stores the exact variant. Its content hash therefore binds the order type and the applicable price. Existing unexpired limit previews remain readable because the expanded schema still accepts their current `LMT` shape. No migration adds or changes economic terms.

Submission loads all terms from the persisted preview. It does not accept an order type or price from the submit caller. A rejected What-If preview remains visible but cannot be submitted.

The CLI parser performs conditional validation after Commander parses the options. The MCP handler applies the same rules through one shared input-normalization function so the two interfaces cannot drift.

Human and JSON output must label a STOP order clearly and show `stopPrice`. Help and README examples must state that STOP means a native stop-market order.

## Errors and safety

Caller errors use stable messages for:

- Unknown order type.
- Missing applicable price.
- Conflicting price fields.
- Non-positive or non-finite prices.

These errors occur before gateway initialization where practical. Gateway and broker errors continue through the current bounded, redacted error path. Raw IBKR payloads, full account IDs, credentials, and caller-supplied account authority must not enter output or preview files.

No automated test submits an order to a live or paper broker. Optional manual verification can run What-If in a paper environment, but it must not invoke submit.

## Testing

### `ibkr-client`

- Exact native What-If mapping for BUY and SELL STOP orders.
- Exact native submission mapping and stable client order identity.
- LIMIT compatibility.
- Invalid discriminants and price combinations fail before fetch.
- Package exports expose both union members.

### `ibkr-gateway`

- Route and OpenAPI acceptance for valid equity STP preview and submission.
- Rejection of missing, mixed, non-positive, and non-finite prices.
- Adapter forwarding without changing the stop price.
- Durable lifecycle, recovery, warning, reconciliation, and cancellation coverage for an equity STOP operation.
- Generated-client request-boundary tests.

### `huskly-cli`

- Existing `--limit` command compatibility.
- Explicit LIMIT and STOP CLI forms.
- Conditional CLI and MCP validation before service initialization.
- Canonical intent, preview DTO, persistence, hashing, and submission for STOP.
- Submission uses only stored STOP terms.
- Gateway adapter forwards the exact generated request.
- Human and JSON rendering and documentation examples.

Run each repository's full lint, format, typecheck, build, and test commands.

## Release order

Release and consume changes in dependency order:

1. Release `@huskly/ibkr-client` with equity STP request support.
2. Update and release `@huskly/ibkr-gateway`.
3. Regenerate and release `@huskly/ibkr-gateway-client` from the gateway OpenAPI contract.
4. Update `huskly-cli` to the released gateway client and expose CLI and MCP STOP inputs.

Use local packed artifacts during development so each downstream repository tests the exact upstream change before publication.
