# Guarded IBKR Equity Orders Implementation Plan

> **Design:** `docs/superpowers/specs/2026-09-14-ibkr-equity-orders-design.md`
>
> Work in the `feat/equity-orders` worktrees for `ibkr-client`, `ibkr-gateway`, and `huskly-cli`. Complete tasks in dependency order. Use tests before production changes. Do not submit a live broker order during verification.

## Task 1: Add the low-level equity contract domain

**Repository:** `ibkr-client`

**Files:**

- Create `src/ibkr/equityContract.ts`.
- Update `src/types.ts` and `src/index.ts`.
- Create `test/equityContract.test.ts`.
- Update `test/packageBoundary.test.ts`.

**Steps:**

1. Add failing tests for a strict `EquityContract` with `assetClass: "STK"`, positive `conid`, normalized symbol, `SMART` routing exchange, explicit US primary exchange, and `USD` currency.
2. Test rejection of missing, malformed, non-finite, unsupported-currency, and derivative-shaped identities.
3. Implement the smallest immutable public contract type and runtime normalization helper.
4. Export the public types and helper.
5. Run the new tests, package-boundary tests, typecheck, and format check.
6. Commit as `feat: add exact equity contract identity`.

## Task 2: Add low-level equity resolution

**Repository:** `ibkr-client`

**Files:**

- Update `src/ibkr/ibkrApiTypes.ts` and `src/ibkr/ibkrClient.ts`.
- Add a focused equity resolver module if `ibkrClient.ts` would otherwise gain mixed responsibilities.
- Create `test/equityResolution.test.ts`.
- Update `src/index.ts`, `test/packageBoundary.test.ts`, and `README.md`.

**Steps:**

1. Add failing tests for exact-symbol candidate search followed by contract-detail validation.
2. Cover one valid US `STK`, no match, more than one valid match, non-`STK`, non-USD, non-US primary listing, conflicting identity, malformed provider data, and incomplete evidence.
3. Implement one read-only resolver that returns one exact `EquityContract` or fails closed.
4. Do not infer account identity or accept a caller-selected contract ID.
5. Run focused tests and package checks.
6. Commit as `feat: resolve exact US equity contracts`.

## Task 3: Add low-level equity What-If and submission operations

**Repository:** `ibkr-client`

**Files:**

- Create focused equity order modules under `src/ibkr/`.
- Update `src/ibkr/ibkrClient.ts`, `src/types.ts`, and `src/index.ts`.
- Create `test/equityOrderPreview.test.ts` and `test/equityOrderExecution.test.ts`.
- Update `test/packageBoundary.test.ts` and `README.md`.

**Steps:**

1. Add failing request-mapping tests for BUY and SELL limit orders with whole-share quantity, `DAY | GTC`, and `REGULAR | OVERNIGHT`.
2. Add What-If tests that prove `whatif: true`, one request, no submission, and strict commission and margin normalization.
3. Add submission tests for accepted, warning, refused, and ambiguous transport outcomes.
4. Add warning continuation, exact lookup/status evidence, and `STK` cancellation tests.
5. Prove that all broker writes make one attempt and preserve partial evidence on uncertainty.
6. Implement typed equity APIs by reusing transport and safe normalization helpers without widening derivative contracts.
7. Run all `ibkr-client` checks.
8. Commit as `feat: support guarded equity order operations`.

## Task 4: Publish the low-level package boundary locally

**Repository:** `ibkr-client`

**Steps:**

1. Build and pack the package from the feature worktree.
2. Inspect the tarball to confirm public types, JavaScript, declarations, and README are included.
3. Record the tarball path for the gateway dependency test.
4. Do not publish to npm without explicit release authorization.

## Task 5: Add the gateway equity read contract

**Repository:** `ibkr-gateway`

**Files:**

- Update the `@huskly/ibkr-client` dependency to the local packed feature artifact during development.
- Update `src/broker/client-port.ts`, `src/broker/huskly-client-adapter.ts`, and `src/reads/instruments.ts` or add `src/reads/equities.ts`.
- Update `src/app.ts` and `openapi/v1.yaml`.
- Add focused route, service, and OpenAPI tests.

**Steps:**

1. Add failing tests for a gateway endpoint that resolves one normalized symbol to one exact US `STK` identity.
2. Cover exact success, empty, ambiguous, partial, malformed, non-USD, and non-US evidence.
3. Implement the read port and route without account inference.
4. Return bounded observation metadata and no raw provider payload.
5. Run focused read, route, OpenAPI, type, and format checks.
6. Commit as `feat: resolve exact equity contracts`.

## Task 6: Generalize the gateway mutation contract

**Repository:** `ibkr-gateway`

**Files:**

- Update `src/mutations/types.ts`, `canonical-intent.ts`, `route-schemas.ts`, `operation-route-schemas.ts`, and persistence schemas.
- Update `openapi/v1.yaml` and `src/app.ts`.
- Update mutation, OpenAPI, journal, and migration tests.

**Steps:**

1. Add failing schema tests for the `STK` equity contract and single-order preview variant.
2. Prove that mixed derivative/equity fields, symbol-only contracts, fractional quantities, unsupported order types, and caller account IDs are rejected.
3. Implement a discriminated mutation contract union and canonical single equity intent.
4. Keep persisted operation decoding strict and versioned. Add a migration only if the stored representation changes incompatibly.
5. Keep existing `OPT` and `FOP` paths unchanged after narrowing.
6. Run focused schema, canonical intent, OpenAPI, journal, and migration tests.
7. Commit as `feat: accept equity mutation intents`.

## Task 7: Extend the gateway guarded lifecycle to equity

**Repository:** `ibkr-gateway`

**Files:**

- Update `src/broker/mutation-port.ts` and `src/broker/huskly-mutation-boundary.ts`.
- Update `src/mutations/order-mutation-service.ts`, `warning-acknowledgement.ts`, `reconciliation.ts`, `cancellation.ts`, and `operation-query.ts` where asset narrowing is required.
- Add or update focused unit, integration, and acceptance tests.

**Steps:**

1. Add failing lifecycle tests for equity preview and durable single submission.
2. Cover accepted, warning pending, refused, unknown outcome, and recovery-required states.
3. Cover two-process idempotency races, restart recovery, warning continuation, reconciliation, and cancellation.
4. Prove mutation lock, account verification, environment, allowlist, and redaction behavior for equity.
5. Implement equity dispatch through the low-level client while retaining the one-attempt write rule.
6. Remove derivative-only assumptions only where the discriminated union requires it.
7. Run the full gateway check.
8. Commit as `feat: guard equity order lifecycle`.

## Task 8: Regenerate and pack the gateway client

**Repository:** `ibkr-gateway`

**Files:**

- Regenerate `client/src/schema.ts` and `client/src/api-version.ts`.
- Update generated-client tests and client README if required.

**Steps:**

1. Run the OpenAPI generator and inspect the generated diff.
2. Add generated-client tests for equity resolution, preview, submission, recovery, status, warning, reconciliation, and cancellation request boundaries.
3. Build and test the generated client.
4. Pack it and record the tarball path for the CLI dependency test.
5. Run the full gateway check again.
6. Commit as `feat: generate equity order client contract`.

## Task 9: Add the CLI equity domain and preview store

**Repository:** `huskly-cli`

**Files:**

- Create focused modules under `src/equities/` for intent, preview, storage, and service behavior.
- Extend `src/gateway/gatewayMutationAdapter.ts` or add an equity adapter beside it.
- Add focused tests under `test/equities/` and `test/gateway/`.
- Update the generated gateway client dependency to the local packed artifact during development.

**Steps:**

1. Add failing tests for exact gateway resolution and canonical BUY/SELL limit intents.
2. Add preview tests for accepted and rejected What-If results.
3. Add private file-store tests for schema version, permissions, atomic creation, hash binding, expiry boundary, corruption, environment binding, and duplicate preview IDs.
4. Add submission tests that load all economic terms only from the preview and require `confirm: true` plus operator identity.
5. Reuse the durable execution lifecycle where possible. Generalize names only when needed to support both derivative and equity previews safely.
6. Prove one durable reservation and one network write across concurrent service instances.
7. Run focused CLI tests, typecheck, and format checks.
8. Commit as `feat: add guarded equity order service`.

## Task 10: Expose the MCP tools

**Repository:** `huskly-cli`

**Files:**

- Create `src/mcp/tools/equityOrders.ts`.
- Update `src/mcp/server.ts` and operation tool descriptions.
- Add `test/mcp/equityOrders.test.ts` and update existing MCP lifecycle tests.
- Update `README.md`.

**Steps:**

1. Add failing registration and input-schema tests for `preview_equity_order` and `submit_equity_order`.
2. Prove that preview never submits and submission rejects missing or false confirmation before service initialization.
3. Prove that MCP input cannot contain an account ID or contract ID.
4. Test safe success, rejection, warning, expiry, ambiguity, recovery-required, and redacted error results.
5. Register both tools and update generic lifecycle tool descriptions for equity support.
6. Document examples that always preview first and never imply that preview submits.
7. Run the full CLI check and build.
8. Commit as `feat: expose guarded IBKR equity orders through MCP`.

## Task 11: Verify package and process integration

**Repositories:** all three

**Steps:**

1. Install the packed low-level client into the gateway worktree and the packed generated gateway client into the CLI worktree without editing unrelated dependencies.
2. Run each repository’s full check from a clean install.
3. Start the gateway in an isolated paper configuration or use its integration harness. Do not disturb the live service.
4. Start the CLI MCP binary and call `tools/list`. Verify both new tool schemas.
5. Call `preview_equity_order` for a paper-safe symbol if valid paper credentials and gateway readiness are available.
6. Verify the result says `submitted: false`, binds the exact contract, and contains an expiring preview ID.
7. Do not invoke `submit_equity_order` against a live or paper broker during automated verification.
8. Confirm no secrets, full account IDs, raw provider payloads, or caller-supplied authority appear in output or persisted preview files.

## Task 12: Final review and delivery

**Repositories:** all three

**Steps:**

1. Review all diffs plus affected public exports and analogous derivative paths.
2. Search for derivative-only assumptions that now receive `STK`.
3. Search for accidental write retries, inferred account identity, mutable submission terms, and lost partial evidence.
4. Run `yarn check` in all three worktrees and record pass counts.
5. Document the release order: `ibkr-client`, gateway and generated gateway client, then `huskly-cli`.
6. State that npm publication and gateway deployment require separate operator credentials and release authorization.
7. Present branch and commit summaries. Do not merge or publish without explicit authorization.
