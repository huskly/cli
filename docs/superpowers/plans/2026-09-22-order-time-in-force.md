# Order Time in Force Implementation Plan

> **Design:** `docs/superpowers/specs/2026-09-22-order-time-in-force-design.md`
>
> Use isolated `feat/order-time-in-force` worktrees for `ibkr-client`, `ibkr-gateway`, and `huskly-cli`. Complete tasks in dependency order. Write failing tests before production changes. Do not publish packages or deploy services without separate authorization.

## Task 1: Normalize order timing fields in the IBKR client

**Repository:** `ibkr-client`

**Files:**

- Update `src/types.ts`.
- Update `src/ibkr/ibkrClient.ts`.
- Update `test/ibkrClient.brokerFeatures.test.ts`.

**Steps:**

1. Create an isolated worktree from the current default branch and run the baseline checks.
2. Add failing order-history tests for `tif`, `timeInForce`, `outsideRTH`, `outside_rth`, and missing session evidence.
3. Extend `BrokerOrder` with optional `tif` and `session` fields.
4. Reuse the active derivative order rules to normalize TIF and session values.
5. Keep unknown TIF strings. Return `UNKNOWN` when neither session field is present.
6. Run the focused test, typecheck, format check, full tests, and build.
7. Commit as `feat: expose order time in force`.

## Task 2: Pack the IBKR client

**Repository:** `ibkr-client`

**Steps:**

1. Build the package from the feature worktree.
2. Pack it to a stable artifact path outside the worktree.
3. Inspect its declarations and contents. Confirm the two new fields are public and no private files are present.
4. Record the artifact path for gateway development.
5. Do not publish the package.

## Task 3: Extend the gateway order-history contract

**Repository:** `ibkr-gateway`

**Files:**

- Update the `@huskly/ibkr-client` dependency to the packed artifact for local validation.
- Update `src/reads/orders.ts`.
- Update `src/broker/huskly-client-adapter.ts`.
- Update `src/app.ts`.
- Update `openapi/v1.yaml`.
- Update `test/huskly-client-adapter.test.ts`.
- Update `test/order-read-service.test.ts` and route contract tests as needed.

**Steps:**

1. Create an isolated worktree and run baseline checks before changing the dependency.
2. Install the packed IBKR client. Keep lockfile changes limited to the expected dependency.
3. Add failing parser and service tests for `DAY + REGULAR`, `GTC + OVERNIGHT`, unknown TIF, and missing evidence.
4. Extend `HistoricalOrder` with nullable `tif` and `session` fields.
5. Map absent upstream fields to `null`. Accept only `REGULAR`, `OVERNIGHT`, or `UNKNOWN` for a present session.
6. Extend the runtime response schema and OpenAPI schema with required nullable fields.
7. Run focused tests, typecheck, and format checks.
8. Commit as `feat: expose order timing in history`.

## Task 4: Regenerate and pack the gateway client

**Repository:** `ibkr-gateway`

**Files:**

- Regenerate `client/src/schema.ts` and `client/src/api-version.ts`.
- Update `test/generated-client.test.ts`.

**Steps:**

1. Run `yarn generate:client`.
2. Add or update generated-client tests for both fields.
3. Inspect the generated diff and confirm the response requires nullable `tif` and `session` fields.
4. Run generated-client tests, the client build, the full gateway checks, and the gateway build.
5. Pack the generated client to a stable artifact path outside the worktree and inspect it.
6. Commit generated output as `feat: generate order timing contract`.
7. Do not publish or deploy.

## Task 5: Extend broker-neutral order mapping in the CLI

**Repository:** `huskly-cli`

**Files:**

- Update the `@huskly/ibkr-gateway-client` dependency to the packed artifact for local validation.
- Update `src/brokers/brokerClient.ts`.
- Update `src/brokers/ibkrBrokerAdapter.ts`.
- Update `src/brokers/schwabBrokerAdapter.ts` if direct mapping is necessary.
- Update `test/brokers/ibkrBrokerAdapter.test.ts`.
- Update `test/brokers/schwabBrokerAdapter.test.ts`.

**Steps:**

1. Create an isolated worktree and run baseline checks.
2. Install the packed gateway client. Keep unrelated dependencies unchanged.
3. Add failing IBKR adapter tests that preserve TIF and session values.
4. Add failing Schwab adapter tests that preserve `duration` and `session` as the shared fields.
5. Extend `BrokerOrder` with optional nullable `tif` and session fields.
6. Map both broker response shapes without inventing missing evidence.
7. Confirm JSON output includes the mapped values.
8. Run focused adapter tests and typecheck.

## Task 6: Render TIF and Session columns

**Repository:** `huskly-cli`

**Files:**

- Update `src/cli/orders.ts`.
- Update `test/cli/orders.test.ts`.

**Steps:**

1. Add failing renderer tests for the new headings and for `DAY + REGULAR` and `GTC + OVERNIGHT` rows.
2. Add failing tests that render missing or `UNKNOWN` evidence as `-`.
3. Add fixed widths for **TIF** and **Session** after **Type** and include them in separator length calculation.
4. Render TIF unchanged. Render `UNKNOWN`, `null`, and absent session values as `-`.
5. Run focused CLI tests, then `yarn check` and `yarn build`.
6. Commit as `feat: show order time in force`.

## Task 7: Cross-repository verification and handoff

**Repositories:** all three

**Steps:**

1. Confirm each downstream worktree uses the upstream packed feature artifact.
2. Run the full check and build commands in all three worktrees.
3. Inspect package declarations and JSON output for field-name or nullability drift.
4. Run `yarn dev --broker ibkr orders` only as a read-only manual check when the configured gateway contains representative orders.
5. Confirm the table shows separate **TIF** and **Session** values and remains aligned.
6. Restore local artifact dependencies to published package versions only after those versions exist. Do not invent version numbers.
7. Record branch names, commits, test results, artifact paths, and release order.
8. Request separate authorization before publication, deployment, merge, or any broker mutation.
