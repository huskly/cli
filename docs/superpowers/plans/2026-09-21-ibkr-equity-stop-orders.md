# Guarded IBKR Equity STOP Orders Implementation Plan

> **Design:** `docs/superpowers/specs/2026-09-21-ibkr-equity-stop-orders-design.md`
>
> Use isolated `feat/equity-stop-orders` worktrees for `ibkr-client`, `ibkr-gateway`, and `huskly-cli`. Complete tasks in dependency order and write failing tests before production changes. Do not submit a live or paper broker order. Do not publish packages or deploy the gateway without separate authorization.

## Task 1: Extend the low-level equity order type

**Repository:** `ibkr-client`

**Files:**

- Update `src/types.ts`.
- Update `src/ibkr/ibkrClient.ts`.
- Update `test/equityOrderExecution.test.ts`.
- Update `test/packageBoundary.test.ts`.
- Update `README.md` if its equity request examples are limit-only.

**Steps:**

1. Create an isolated worktree from the current default branch and run the repository baseline checks.
2. Add failing compile-time package-boundary cases for both equity order variants:
   - `{ orderType: "LMT", limit }`
   - `{ orderType: "STP", stopPrice }`
3. Add failing runtime tests for BUY and SELL STOP What-If requests. Assert the exact native IBKR fields, including native stop type, auxiliary stop price, session, duration, account, contract, and `whatif: true`.
4. Add failing submission tests for the same STOP mapping with the stable client order ID and without `whatif: true`.
5. Add failing tests that reject missing, mixed, zero, negative, and non-finite prices before fetch. Keep existing LMT tests unchanged.
6. Replace the limit-only request interfaces with shared fields intersected with a discriminated `LMT | STP` union. Keep `clientOrderId` required only for submission.
7. Narrow `validateEquityOrderFields` and `equityOrderTicket` by `orderType`. Send a limit price only for LMT and a stop price only for STP.
8. Update public documentation with one STOP example and state that it is a native stop-market order.
9. Run the focused tests, `yarn test`, `yarn check`, and `yarn build`.
10. Commit as `feat: support equity stop orders`.

## Task 2: Pack the low-level client for gateway development

**Repository:** `ibkr-client`

**Steps:**

1. Run the package build from the feature worktree.
2. Pack the package to a stable local artifact path outside the worktree.
3. Inspect the tarball. Confirm that the generated declarations expose both equity variants and that no source credentials or local configuration are present.
4. Record the exact artifact path for the gateway worktree.
5. Do not publish the package.

## Task 3: Extend gateway equity mutation contracts

**Repository:** `ibkr-gateway`

**Files:**

- Update the development dependency on `@huskly/ibkr-client` to use the packed artifact.
- Update `src/mutations/types.ts`.
- Update `src/mutations/route-schemas.ts`.
- Update `src/app.ts` where duplicate route or API schemas are maintained.
- Update `openapi/v1.yaml`.
- Update route-schema, OpenAPI, and package-boundary tests.

**Steps:**

1. Create an isolated worktree from the current default branch and run the baseline checks before changing the dependency.
2. Install the packed low-level client through the repository package manager. Keep the dependency diff limited to the expected package reference and lockfile entries.
3. Add failing runtime-schema tests for a valid equity STP preview and a valid equity STP single-order submission with operator fields.
4. Add failing schema tests for an absent stop price, both price fields, non-positive values, non-finite values, and an LMT request without a limit.
5. Add matching failing OpenAPI and generated-boundary assertions so the documented union cannot differ from the runtime schema.
6. Change `EquityPreviewIntent` to a shared equity base intersected with the discriminated `LMT | STP` terms.
7. Add a second strict equity preview schema and a second strict equity single-order schema for STP. Use `oneOf` and `additionalProperties: false` so mixed price fields fail.
8. Apply the same variants to `openapi/v1.yaml` and any mirrored schemas in `src/app.ts`.
9. Run focused schema and OpenAPI tests plus `yarn typecheck` and `yarn format:check`.
10. Commit as `feat: accept equity stop order intents`.

## Task 4: Carry STOP terms through the guarded gateway lifecycle

**Repository:** `ibkr-gateway`

**Files:**

- Update `src/broker/huskly-mutation-boundary.ts`.
- Update `src/broker/huskly-client-adapter.ts`.
- Update `src/mutations/reconciliation.ts`.
- Update persistence or canonical-intent schemas only where they currently assume equity LMT.
- Update `test/huskly-mutation-adapter.test.ts`.
- Update lifecycle, persistence, recovery, reconciliation, and source-invariant tests that narrow equity terms.

**Steps:**

1. Add failing adapter tests that assert an equity STOP preview and submit reach `previewEquityOrder` and `submitEquityOrder` with the exact `STP` and `stopPrice` terms.
2. Add a failing durable-operation test that stores and reloads an equity STOP intent without a synthetic limit field.
3. Add failing reconciliation coverage that compares the expected order type and stop price and rejects mismatched broker evidence.
4. Exercise accepted, warning, rejected, and recovery-required results through existing generic lifecycle tests. Add equity-specific cases only where asset narrowing could lose STOP terms.
5. Update adapter mapping through discriminant narrowing. Do not cast a broad object to the upstream request type.
6. Extend strict persistence decoding only as needed. Keep existing stored LMT equity operations readable. Add a migration only if the durable shape changes incompatibly.
7. Confirm warning continuation, status, cancellation, idempotency keys, one-attempt writes, and redaction do not branch incorrectly on LMT.
8. Run the focused mutation and persistence tests, then the full `yarn check` and `yarn build`.
9. Commit as `feat: carry equity stops through order lifecycle`.

## Task 5: Regenerate and pack the gateway client

**Repository:** `ibkr-gateway`

**Files:**

- Regenerate `client/src/schema.ts` and `client/src/api-version.ts`.
- Update `test/generated-client.test.ts` and other generated-client boundary tests.
- Update the generated client README if it contains a limit-only equity example.

**Steps:**

1. Run `yarn generate:client`.
2. Inspect the generated diff. Confirm equity preview and single-order request types each contain separate LMT and STP variants with exclusive price fields.
3. Add generated-client request tests for both equity STOP preview and submission.
4. Run `yarn test:generated-client`, `yarn build:client`, and the full gateway checks again.
5. Pack the generated gateway client to a stable local artifact path outside the worktree and inspect its declarations and package contents.
6. Commit generated sources and tests as `feat: generate equity stop order contract`.
7. Do not publish or deploy.

## Task 6: Extend the CLI equity domain and service

**Repository:** `huskly-cli`

**Files:**

- Update `package.json` and `yarn.lock` to use the packed gateway client during development.
- Update `src/equities/equityOrder.ts`.
- Update `src/equities/equityOrderService.ts`.
- Update `src/equities/equityGatewayAdapter.ts` only if generated request inference requires narrowing.
- Update `test/equities/equityOrderService.test.ts`.
- Update `test/gateway/equityGatewayAdapter.test.ts`.

**Steps:**

1. Install the packed generated gateway client. Confirm unrelated dependencies do not change.
2. Add failing domain tests for canonical LMT and STP intents and for safe DTO output that contains only the applicable price.
3. Add failing preview tests that store, hash, and return an exact STOP intent without submitting.
4. Add failing submit tests that reload every STOP term from the preview and accept no economic overrides.
5. Add failing file-store tests that round-trip old LMT previews and new STP previews through the strict schema.
6. Add gateway-adapter tests that forward the exact generated STP preview and submit objects.
7. Refactor `CanonicalEquityIntent` to shared contract fields plus a discriminated term union. Apply the same union to Zod schemas and DTO types.
8. Extend `PreviewEquityOrderInput` with public `LIMIT | STOP` terms or a shared normalized input type. Centralize conversion to gateway `LMT | STP` so CLI and MCP do not implement separate mappings.
9. Preserve content hashing, preview expiry, environment binding, rejected-preview behavior, durable reservation, and generic operation indexing.
10. Run focused equity and gateway tests, `yarn typecheck`, and `yarn format:check`.
11. Commit as `feat: add guarded equity stop previews`.

## Task 7: Expose explicit STOP inputs through CLI and MCP

**Repository:** `huskly-cli`

**Files:**

- Update `src/cli/equityOrders.ts`.
- Update `src/mcp/tools/equityOrders.ts`.
- Update `test/cli/equityOrders.test.ts`.
- Update `test/mcp/equityOrders.test.ts`.
- Update `README.md`.

**Steps:**

1. Add failing CLI tests for:
   - Existing `--limit` syntax defaulting to LIMIT.
   - Explicit `--order-type LIMIT --limit <price>`.
   - Explicit `--order-type STOP --stop-price <price>`.
   - Unknown type, missing applicable price, both prices, zero, negative, non-finite, and mismatched price options.
2. Prove every invalid combination fails before service initialization.
3. Add failing MCP registration and handler tests for `orderType: "LIMIT" | "STOP"`, default LIMIT behavior, and the same exclusive price rules.
4. Add one shared normalization function for the CLI and MCP call paths. Return a discriminated service input rather than objects with two optional prices.
5. Add Commander options `--order-type <type>` and `--stop-price <price>`. Make `--limit` conditionally required instead of unconditionally required.
6. Keep submit inputs unchanged. Update titles and descriptions so tools no longer claim they are limit-only.
7. Update human and JSON rendering to identify STOP and show `stopPrice` only.
8. Add README examples and state that STOP is a native stop-market order, not stop-limit.
9. Run focused CLI and MCP tests, then `yarn check` and `yarn build`.
10. Commit as `feat: expose equity stop orders`.

## Task 8: Cross-repository verification and handoff

**Repositories:** all three

**Steps:**

1. Verify each downstream worktree uses the packed artifact built from the upstream feature worktree.
2. Run clean installs and the full test, lint, format, typecheck, and build commands in all three worktrees.
3. Search all changed code and generated declarations for an equity LMT-only assumption.
4. Search for unsafe broad casts, mixed optional `limit` and `stopPrice` objects, write retries, mutable submit terms, full account IDs, and raw provider payloads.
5. Run the CLI help and MCP `tools/list` tests. Verify the documented default and STOP input fields.
6. If isolated paper credentials are available, run one STOP What-If preview and confirm `submitted: false`, exact contract binding, `orderType: "STP"`, the reviewed stop price, and an expiring preview ID.
7. Do not invoke submit during automated or manual verification.
8. Restore downstream dependency declarations from local artifacts to the intended released version only after upstream versions exist. Do not invent unpublished version numbers.
9. Record branch names, commits, test counts, artifact paths, and the required release order.
10. Request separate authorization before npm publication, gateway deployment, merge, or a real broker submission.
