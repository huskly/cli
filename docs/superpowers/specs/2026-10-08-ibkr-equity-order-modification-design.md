# IBKR Equity Order Modification Design

## Purpose

Add an in-place modification for one working IBKR equity order. The operator can change the price, the quantity, and the time in force of the order. The order keeps its IBKR order ID and its place in the broker flow. The operator does not need to cancel the order and place a new one.

The implementation spans these repositories, in this order:

1. `@huskly/ibkr-client` (`~/prj/ibkr-client`)
2. `@huskly/ibkr-gateway` and `@huskly/ibkr-gateway-client` (`~/prj/ibkr-gateway`)
3. `@huskly/cli` (`~/prj/huskly-cli`)

The gateway remains the only component that talks to IBKR. The CLI and the MCP server do not call IBKR directly.

## Scope

The first version supports:

- One working or partially filled IBKR order for one US `STK` contract.
- Orders that the gateway placed, and orders that TWS, the mobile app, or the IBKR web portal placed. The operator identifies the order by its IBKR order ID.
- Order type `LMT` or `STP` (stop-market). The order type does not change.
- These changes, alone or together:
  - The limit price (only for `LMT` orders).
  - The stop price (only for `STP` orders).
  - The total quantity, in positive whole shares.
  - The time in force: `DAY` or `GTC`.
- Paper and live gateway environments.
- Warning continuation.

The first version does not support:

- Options, option spreads, futures options, or forex.
- Orders that have a parent order or child orders (bracket, OCA, or contingent graphs).
- Changes to the side, contract, order type, session, or account.
- Fractional shares.
- A preview (What-If) of the modification.
- Automatic retries of broker writes.

## Safety Rules

- The modification is one step. The caller must send `confirm: true` (CLI `--confirm`). There is no preview.
- The caller supplies an operator identity, the same as equity submission.
- The gateway owns the account identity. No request includes an account ID.
- The gateway reads the live order from IBKR before each modification. The caller does not supply the contract, the side, the order type, or the session. The gateway copies them from the live order evidence.
- The live order evidence gives only the conid and the symbol of the contract. The gateway gets the full `EquityContract` from the existing exact equity resolver with the live symbol. The resolved conid must be equal to the live conid. A missing symbol, an ambiguous resolution, or a different conid fails closed before any broker write.
- The request must change at least one field. A request that changes nothing fails before any broker write.
- The new total quantity must be more than the filled quantity in the live order evidence.
- Incomplete, ambiguous, or conflicting live order evidence fails closed before any broker write.
- Each broker write gets exactly one attempt. An ambiguous broker response becomes `unknown_outcome`. The gateway does not resend it.
- Each modification uses a durable idempotency key. A repeated request with the same key and the same body returns the stored modification. The same key with a different body is a conflict (HTTP 409).
- Each modification uses the existing account mutation gate, the safety checks (`assertRecoverySafe`), the live mutation lock, and the fatal durability handling, in the same way as cancellation.
- `--confirm` also acknowledges broker warnings for this modification, the same as `equity submit`.
- Errors returned through the CLI and MCP are bounded and redacted.

## Architecture

### Low-level IBKR client (`@huskly/ibkr-client`)

Add `modifyEquityOrder(request: EquityOrderModifyRequest): Promise<DerivativeOrderSubmissionResult>`.

`EquityOrderModifyRequest` contains:

- `accountId`
- `orderId` (the IBKR order ID, a non-empty string)
- `contract` (the existing `EquityContract`)
- `side: "BUY" | "SELL"`
- `quantity` (positive whole shares)
- `tif: "DAY" | "GTC"`
- `session: "REGULAR" | "OVERNIGHT"`
- Price terms, as a discriminated union: `{ orderType: "LMT"; limit: number }` or `{ orderType: "STP"; stopPrice: number }`.

The method:

- Validates the fields with the same rules as `submitEquityOrder` (reuse `validateEquityOrderFields` and `equityOrderTicket`).
- Sends `POST iserver/account/{accountId}/order/{orderId}` with the full order ticket that `equityOrderTicket` builds. IBKR requires the full ticket, not only the changed fields. Do not send `cOID`. IBKR does not let a modify change the client order ID.
- Uses `withTradingMutation` and `singleAttemptRequest`, the same as submission.
- Normalizes the response with the existing `normalizeOrderSubmission`. A warning response returns reply IDs. The existing `acknowledgeOrderWarning` continues the warning.

IBKR responses remain untrusted. Missing, malformed, non-finite, or ambiguous evidence must not become a successful result. Add unit tests for the request body, accepted, warning, refused, and malformed responses.

Also export a read that gives the gateway the exact live terms of one order. If `listActiveDerivativeOrders` or `getDerivativeOrderStatus` already return the conid, side, order type, limit price, stop price, total quantity, filled quantity, tif, session (outside RTH), parent order ID, and client order ID (`order_ref`) for `STK` orders, reuse it. If not, extend the existing read. Do not add a second parser for the same IBKR payload.

### Gateway (`@huskly/ibkr-gateway`)

#### New resource

A modification is a separate journaled resource. It is not an order operation. Order operations require a submission intent and gateway client order IDs (`hg-...`). An external order has neither, so a modification cannot be an order operation.

Add the next free migration (`020_order_modifications.sql` at the time of writing) with table `gateway_order_modifications` (exact columns are the implementer's choice, with CHECK constraints in the style of migration 005). It records:

- `modification_id` (uuid)
- Account identity, machine identity, idempotency key, and the canonical request hash. The tuple (account, machine, idempotency key) is unique.
- `order_id` (the IBKR order ID)
- `owner_operation_id` (nullable). It is set when the live order's client order ID matches a row in `gateway_mutation_correlations`.
- `before_terms` (the live terms that the gateway read), `requested_changes` (the caller's changes), and `submitted_terms` (the full terms sent to IBKR), as canonical JSON.
- `ext_operator`.
- State transitions, with an append-only transition table or sequence like the operation journal. States: `received`, `rejected_before_submission`, `broker_attempt_started`, `accepted`, `warning_pending`, `warning_declined` (reserved, not in v1), `broker_refused`, `unknown_outcome`.
- The pending warning (reply ID, message IDs, sequence) and the broker reason categories.
- Created and latest transition times.

#### HTTP API

Add these routes to `openapi/v1.yaml`. Use scope `ibkr:read-write`. Use the existing error responses, headers, and schema style:

1. `POST /v1/order-modifications` (operationId `createOrderModification`). Requires the `Idempotency-Key` header. Body:
   ```json
   {
     "orderId": "1234567890",
     "changes": { "limit": 251.25, "quantity": 20, "tif": "GTC" },
     "extOperator": "alice",
     "manualIndicator": true,
     "confirm": true
   }
   ```
   `changes` has at least one of `limit`, `stopPrice`, `quantity`, `tif`. `limit` and `stopPrice` cannot be together. Answers `201` (accepted), `202` (warning pending or unknown outcome), or `200` (idempotent replay). Each answer has the `OrderModification` body.
2. `GET /v1/order-modifications/{modificationId}` (operationId `getOrderModification`). The machine identity must own it. Otherwise answer `404`.
3. `POST /v1/order-modifications/{modificationId}/warning-acknowledgements` (operationId `acknowledgeOrderModificationWarning`). Requires `Idempotency-Key`. Body `{ "replyId": "..." }`. Same answer codes as creation.

The `OrderModification` body contains: `modificationId`, `orderId`, `ownerOperationId` (nullable), `state`, `before`, `requested`, `submitted` (nullable before submission), `pendingWarning` (nullable), `result` (nullable; `kind` and `reasonCategories`), `createdAt`, and `latestTransitionAt`. Each terms object contains `symbol`, `conid`, `side`, `orderType`, `limit` (nullable), `stopPrice` (nullable), `quantity`, `filledQuantity` (only in `before`), `tif`, and `session`.

Preflight failures use the existing `MutationPreflightError` mapping. Add bounded error codes for these cases:

- `order_not_found`: no working order with this ID.
- `order_not_modifiable`: the order is not a single `STK` LMT or STP order, has a parent or child orders, or is not working or partially filled.
- `owner_operation_not_accepted`: a gateway-owned order whose owner operation is not `accepted`.
- `no_change`: the request does not change a field.
- `invalid_change`: the price field does not match the order type, or the quantity is not more than the filled quantity.

#### Service

Add `src/mutations/order-modification.ts` with a `OrderModificationService`. Model it on `CancellationMutationService`:

1. Validate and snapshot the input.
2. Enter the account mutation gate.
3. `assertRecoverySafe`.
4. Reserve the idempotency key. Return a replay or a conflict when the key exists.
5. Read the live order evidence from IBKR through a new broker port method. Validate the preconditions above. Find the owner operation by client order ID.
6. Build the submitted terms (live terms plus changes). Persist `before_terms` and `submitted_terms`.
7. Mark `broker_attempt_started`, `assertRecoverySafe` again, then call `modifyEquityOrder` once.
8. Record the normalized outcome. A thrown broker error or invalid response becomes `unknown_outcome` with a reason category.

Warning acknowledgement for a modification reuses the broker `acknowledgeOrderWarning` call and the same journal rules as `warning-acknowledgement.ts`.

#### Effect on the owner operation

When the owner operation exists, the operation's expected terms are the submission intent with the latest `accepted` modification applied (price, quantity, tif). Add one function, for example `effectiveIntent(intent, acceptedModifications)`, and use it in:

- `reconciliation.ts`, where the candidate order terms are compared with the intent.
- `observation.ts` and `outcome-observer.ts`, where the intent quantity is used for fill completeness.

Do not change the stored submission intent or its hash.

#### Generated client

Regenerate `@huskly/ibkr-gateway-client` from the OpenAPI contract. Bump its minor version and the gateway API version. Do not publish. The parent agent will coordinate the release.

### Huskly CLI and MCP server (`@huskly/cli`)

#### Gateway adapter

Extend `GatewayMutationApi` in `src/gateway/gatewayMutationAdapter.ts` with `createOrderModification`, `getOrderModification`, and `acknowledgeOrderModificationWarning`. Each is one transport call with no retry.

#### Service

Add `src/equities/equityOrderModification.ts`. It:

- Validates the input: an IBKR order ID, at least one change, positive finite prices, positive whole-share quantity, `DAY` or `GTC`, an operator, and `confirm: true`.
- Creates a fresh idempotency key for each command run. It stores the key in the existing private state directory before the call, so a lost answer can be recovered with the same key.
- Calls `createOrderModification`. While the state is `warning_pending`, it calls `acknowledgeOrderModificationWarning` with the pending reply ID. Use the same bounded warning count as `equity submit`.
- Returns a normalized domain result.

#### CLI command

Add `equity modify` to `src/cli/equityOrders.ts`:

```text
huskly-cli equity modify <order-id>
  [--limit <price>] [--stop-price <price>] [--quantity <shares>] [--tif DAY|GTC]
  [--operator <name>] --confirm [--broker ibkr] [--json]
```

- `--operator` defaults to `HUSKLY_EXT_OPERATOR`, the same as `equity submit`.
- The text output shows the before and after terms, the state, the modification ID, and the owner operation ID when there is one.
- `--json` emits a stable DTO.
- The help text states that the command changes a real order, that `--confirm` acknowledges broker warnings, and that `huskly-cli orders` shows the order status.
- Schwab is not supported. Fail with a clear message when the broker is Schwab.

#### MCP tool

Add the MCP tool `modify_equity_order`. Input: `orderId`, the optional changes, `operator`, and `confirm`. It uses the same service as the CLI. The answer is the same DTO as `--json`.

#### Documentation

Update `README.md` (commands and MCP tools).

## Testing

- `ibkr-client`: unit tests for the request body and every response class.
- Gateway: unit tests for the service (every precondition, replay, conflict, each broker outcome, warning flow), route and OpenAPI tests, migration tests, and tests for `effectiveIntent` in reconciliation and observation. Run the existing integration suite.
- CLI: unit tests for the service, the command (parsing, output, `--json`), and the MCP tool, with a fake `GatewayMutationApi`.
- Each repository runs its own lint, type check, and test scripts.

## Release Order

1. Release `@huskly/ibkr-client` with `modifyEquityOrder`.
2. Update the gateway to that version. Release the gateway and `@huskly/ibkr-gateway-client`.
3. Update the CLI to the new gateway client. Release the CLI.

Each step must work end to end before the next step starts. Implementers do not publish packages or push to `main`. The parent agent coordinates releases with the user.

## Resolving Uncertain Modifications

This section was added after the gateway review. A modification in `unknown_outcome` or `warning_pending` blocks new orders on the same contract, in the same way as an uncertain order operation. Each blocking state must have a documented exit.

### Gateway

- `POST /v1/order-modifications/{modificationId}/reconciliations` (operationId `reconcileOrderModification`). It makes only safe reads. It compares the live order terms with `submitted` and with `before`:
  - The live terms are equal to `submitted`: the state becomes `accepted`.
  - The live terms are equal to `before`: the state becomes `not_applied`. This state is terminal and does not block.
  - In all other cases, the state stays `unknown_outcome`. The answer states why.
- `POST /v1/order-modifications/{modificationId}/warning-declines` (operationId `declineOrderModificationWarning`). It changes `warning_pending` to `warning_declined`. It does not write to the broker.
- An admin route records an audited operator attestation for a modification in `unknown_outcome` when its order is no longer working. It uses the existing attested-absence code for operations.
- The gateway refuses a new modification while an operation or a modification that blocks the same conid exists.
- The gateway refuses a modification of a gateway-owned order while the owner operation has a child action that is not terminal.

### CLI and MCP

- `huskly-cli equity modification show <modification-id> [--json]`
- `huskly-cli equity modification reconcile <modification-id> --confirm [--json]`
- `huskly-cli equity modification decline <modification-id> --confirm [--json]`
- MCP tools: `get_order_modification` and `reconcile_order_modification`.
- When `equity modify` ends in `unknown_outcome`, the text output tells the operator to run `equity modification reconcile`.
