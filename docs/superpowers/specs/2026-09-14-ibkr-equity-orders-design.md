# Guarded IBKR Equity Orders Design

## Purpose

Add guarded IBKR limit orders for US-listed stocks and ETFs to the Huskly MCP server. The first version supports BUY and SELL orders for positive whole-share quantities. It uses separate preview and submission tools.

The implementation spans these repositories:

1. `@huskly/ibkr-client`
2. `@huskly/ibkr-gateway`
3. `@huskly/cli`

The existing gateway remains the only component that talks to IBKR. The CLI and MCP server do not call IBKR directly.

## Scope

The first version supports:

- One exact US-listed `STK` contract.
- BUY and SELL sides.
- Limit orders only.
- Positive whole-share quantities.
- `DAY` and `GTC` time in force.
- `REGULAR` and `OVERNIGHT` sessions.
- Paper and live gateway environments.
- Preview, submission, warning continuation, recovery, status, reconciliation, and cancellation.

The first version does not support:

- Fractional shares.
- Market, stop, trailing, bracket, or conditional equity orders.
- Non-US equities.
- Caller-supplied account IDs.
- Caller-supplied IBKR contract IDs.
- Automatic selection when symbol resolution is ambiguous.
- Automatic retries of broker writes.

## Safety Rules

The equity flow uses the existing guarded mutation rules:

- Preview never submits an order.
- Submission requires an unexpired preview ID and `confirm: true`.
- The caller supplies an operator identity for submission.
- The gateway owns the account identity. MCP input never includes an account ID.
- Symbol resolution must return one exact US `STK` contract. No match or more than one valid match fails closed.
- The preview stores the exact IBKR contract identity and all economic terms.
- Submission uses the stored preview. It does not accept changed economic terms.
- Live submission remains subject to the gateway mutation lock and process allowlist.
- Each broker write gets one attempt. An ambiguous response becomes `recovery_required`.
- Recovery uses the durable idempotency key and observed broker evidence. It does not blindly resubmit.
- Warning acknowledgement, reconciliation, and cancellation use the stored operation identity.
- Errors returned through MCP are bounded and redacted.

## Architecture

### Low-level IBKR client

Add a public equity order domain beside the derivative order domain. Do not weaken the existing derivative types.

Add an `EquityContract` discriminated by `assetClass: "STK"`. Its identity contains:

- `conid`
- `symbol`
- `exchange`
- `currency`

Add typed requests for equity What-If, limit submission, warning acknowledgement, exact recovery evidence, status, and cancellation. Reuse transport and response-normalization helpers where their contracts apply. Keep public derivative APIs compatible.

IBKR responses remain untrusted. Missing, malformed, non-finite, or ambiguous evidence must not become a successful result.

### Gateway

Change the gateway mutation contract to a discriminated union:

- Existing derivative contract for `OPT` and `FOP`.
- New equity contract for `STK`.

Extend preview input with a single-order variant that contains:

- Exact equity contract.
- `side: BUY | SELL`.
- Whole-share quantity.
- `tif: DAY | GTC`.
- `session: REGULAR | OVERNIGHT`.
- `orderType: LMT`.
- Positive limit price.

The existing durable `single` operation kind will carry equity orders. The mutation journal, idempotency reservation, state transitions, warning sequence, lookup, reconciliation, and cancellation remain shared. Code that needs asset-specific behavior must narrow on `contract.assetClass`.

Add a dedicated exact equity resolver to the gateway read API. It accepts a normalized symbol, obtains candidate and contract-detail evidence from IBKR, and returns only when one candidate has all of these properties:

- Exact symbol match.
- `STK` security type.
- `USD` currency.
- A US primary listing venue reported by IBKR.
- A positive contract ID.

The resolved identity contains `conid`, `symbol`, `exchange`, `primaryExchange`, and `currency`. No match, multiple matches, incomplete evidence, or conflicting evidence fails closed. The gateway does not infer an account during resolution.

The mutation endpoint accepts this exact internal contract object, but it does not accept a symbol-only mutation or infer an account. The API schema validates every field and rejects derivative-only fields on `STK` contracts.

Update `openapi/v1.yaml`, route schemas, runtime types, read and mutation broker adapters, persisted schemas, and package-boundary tests. Regenerate and build `@huskly/ibkr-gateway-client` from the OpenAPI contract.

### Huskly CLI and MCP server

Add an equity order service with two responsibilities:

1. Resolve and preview one exact equity intent.
2. Bind submission to the stored preview and existing durable execution controls.

Symbol resolution accepts a normalized ticker and calls the gateway exact equity resolver. The CLI does not choose among candidates and does not construct a contract identity from search output. It fails when the gateway reports empty, incomplete, or ambiguous evidence.

Persist short-lived previews in the existing private state directory. A preview record contains:

- Schema version.
- Preview ID.
- Creation and expiry times.
- Gateway environment and masked account display.
- Exact equity contract identity.
- Side, quantity, limit, time in force, and session.
- Safe What-If result.
- `submitted: false`.

The preview ID is a hash that binds the canonical economic intent and environment. Submission reloads and validates this record, checks its expiry, checks gateway readiness and environment, and creates one durable gateway operation.

Add these MCP tools:

### `preview_equity_order`

Input:

- `symbol: string`
- `side: "BUY" | "SELL"`
- `quantity: positive integer`
- `limit: positive number`
- `tif?: "DAY" | "GTC"` with `DAY` as the default
- `session?: "REGULAR" | "OVERNIGHT"` with `REGULAR` as the default

Output contains safe contract identity, exact economic terms, environment, masked account display, commission and margin evidence when available, warnings, rejection reasons, expiry, and preview ID. It always states `submitted: false`.

### `submit_equity_order`

Input:

- `previewId: 64-character lowercase hexadecimal string`
- `operator: non-empty string`
- `confirm: true`

Output uses the existing safe operation lifecycle view. It includes operation ID and available broker order evidence. It does not expose account authority or raw provider payloads.

The existing generic operation controls will support equity operations after their internal derivative-only assumptions are removed. Public descriptions must no longer claim that status, warning, reconciliation, or cancellation tools are derivative-only. Add an equity-specific recovery entry point if the current preview-indexed recovery tool cannot safely load both preview types without ambiguity.

## Data Flow

1. The caller invokes `preview_equity_order`.
2. The CLI validates the requested symbol and terms.
3. The CLI asks the gateway to resolve one exact US equity contract.
4. The gateway validates candidate and contract-detail evidence and returns one exact `STK` identity.
5. The CLI sends one equity What-If request with that exact contract.
6. The gateway validates readiness and calls IBKR once without submission.
7. The CLI stores a private, expiring preview and returns its safe view.
8. The caller reviews the preview and invokes `submit_equity_order` with the preview ID, operator, and `confirm: true`.
9. The CLI reloads and revalidates the preview and gateway environment.
10. The gateway reserves a durable idempotency key before one broker submission attempt.
11. The gateway returns an accepted, warning, refused, or recovery-required lifecycle state.
12. Later status, warning, recovery, reconciliation, and cancellation actions use only stored operation identity.

## Error Handling

Fail before broker submission when:

- Input is invalid.
- Symbol evidence is unavailable, incomplete, absent, or ambiguous.
- The selected instrument is not a US `STK` contract.
- The preview is rejected, expired, missing, corrupt, already submitted, or from another environment.
- Gateway authentication, account verification, connection, mutation lock, or allowlist checks fail.
- `confirm` is not exactly `true`.

After a broker write starts, never convert transport loss or incomplete broker evidence into a safe retry. Persist the uncertain state and require explicit recovery.

## Testing

### `ibkr-client`

- Public equity contract and request type tests.
- Exact IBKR request mapping tests for preview, submit, warning, status, recovery, and cancellation.
- Runtime validation for malformed and ambiguous responses.
- One-attempt and uncertain-response tests.
- Package-boundary and README updates.

### `ibkr-gateway`

- OpenAPI validation for valid equity requests and rejection of mixed equity/derivative fields.
- Generated client request and response tests.
- Equity single-operation lifecycle tests for accepted, warning, refused, and uncertain outcomes.
- Journal restart, idempotency race, recovery, reconciliation, and cancellation tests.
- Account authority, mutation lock, allowlist, and redaction tests.
- Existing derivative regression tests.

### `huskly-cli`

- Exact US `STK` resolution tests, including empty, incomplete, and ambiguous evidence.
- Preview persistence, expiry, hashing, environment binding, and safe output tests.
- Submission confirmation, one-attempt reservation, warning, and recovery tests.
- MCP schema and handler tests for both new tools.
- Tests that account IDs and contract IDs are not accepted from MCP callers.
- Full build, lint, format, typecheck, and test suites.

## Delivery Order

1. Implement and release the equity order API in `@huskly/ibkr-client`.
2. Update `@huskly/ibkr-gateway`, regenerate its client, and release the gateway and generated client.
3. Update `@huskly/cli` to consume the released generated client and expose the MCP tools.
4. Build the CLI, restart the registered MCP server, and verify the new tool schemas.
5. Run a paper-environment preview. Do not submit a live validation order as part of automated verification.
