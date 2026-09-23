# IBKR order contract quote implementation plan

Design: `docs/superpowers/specs/2026-09-23-ibkr-order-contract-quotes-design.md`.

Work in isolated gateway and broker-client worktrees. Keep the uncommitted CLI changes in the main checkout untouched until the gateway contract is ready. Run commands in each project environment.

## 1. Confirm package boundaries and baseline

- Confirm the gateway dependency version and API schema match its source. The broker-client main checkout is v2.7.1, but the gateway pins 3.0.1. Create the broker-client feature worktree from the local `v3.0.1` tag, not from main.
- Install project dependencies by each repository's Yarn 4 workflow if needed. Run targeted baseline tests and type checks. Record any existing failure.
- Make worktrees under `.worktrees` where each repository requires one. Do not change the main checkout while doing gateway work.

## 2. Preserve exact order identities in broker client

- Add tests for raw stock, one option, two-leg signed combo, missing ID, and malformed combo orders in the broker-client order history path.
- Add leg ID, asset class evidence, and signed ratio to the normalized broker history output. Keep the old symbol and instruction fields. Reuse tested active-order combo parsing where possible.
- Add a bounded quote read keyed by exact broker contract IDs with verified responses, nullable prices, availability, and timestamps. Test mixed equity and option IDs, missing market data, and mismatched IDs.
- Update exported types and README. Run targeted tests, typecheck, lint, and formatting.

## 3. Extend gateway contract and generated client

- In the gateway worktree, add tests for stock, single option, spread, malformed ID, and partial contract resolution in `queryOrderHistory`. Extend the history response with exact leg facts and canonical option identity. Preserve orders if enrichment fails.
- Add contract-ID quote request and response types, route, broker port, input limits, and response validation. Test deduplication, partial batches, unavailable data, and cancellation.
- Update OpenAPI, generate the gateway client, and test schema against the route and types. Align `tif` and `session` fields to the actual gateway response so full typecheck can pass.
- Run gateway targeted tests, `yarn check`, and client-generation checks. Keep new fields and endpoint behind a version or capability boundary that the CLI can check.

## 4. Switch CLI after gateway contract works

- Bring the current uncommitted IBKR `orders` quote changes into an isolated CLI worktree without losing user work. Add tests that reproduce the reported IBIT and SPX misquotes before replacing the symbol-based quote lookup.
- Map new per-leg identity fields. Render canonical option symbols for every historical row and continuation lines for multi-leg orders. Add optional JSON fields while keeping existing fields.
- Use contract-ID quotes only for resting orders. Calculate an indicative signed net mark only from all verified, compatible leg marks and ratios. Label delayed or frozen data. Keep an unresolved row visible with no current price. Require verified stock identity for equity quotes.
- Fail clearly when the required gateway capability is absent. Confirm Schwab behavior and JSON compatibility with tests.
- Run targeted tests, `yarn check`, and manual CLI output checks where a configured gateway is available. Do not submit trades.

## 5. Review and deliver

- Inspect each repository diff and any deployment order. Report any package publication or running-gateway upgrade needed to make the CLI feature usable.
- Do not call the feature complete if the CLI can still display an underlying quote as an option quote.
