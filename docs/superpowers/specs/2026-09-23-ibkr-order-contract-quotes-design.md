# IBKR order contract identity and current quotes

## Purpose

The IBKR `orders` table now requests equity quotes by the symbol in an order-history leg. That symbol can name an option underlying. For example, an IBIT option order can show the IBIT share price. A SPX spread can show the SPX index price beside its net option limit price. These prices are not comparable.

The gateway must report the exact contract of each order leg. The CLI must use that identity to show option contracts and to get contract quotes. Schwab is not in scope.

## Broker evidence and limits

The broker-client `fetchOrders` path reads raw `iserver/account/orders` records. Raw records can contain a single `conid`, a combo `conidex`, `secType` or `assetClass`, and an order side. The current normalization discards these fields and emits one history leg with a display symbol. The gateway `queryOrderHistory` response then has no contract identity. The derivative active-order path already parses signed combo legs, but it cannot identify all historical rows. The gateway can resolve option contract IDs to canonical option terms. Some broker rows have no valid contract ID. Missing evidence must remain visible; the CLI must not infer an option or equity from a plain symbol.

## Gateway history contract

Extend each `HistoricalOrderLeg` with nullable fields. Keep `symbol` and `instruction` unchanged:

- `brokerId`: the exact positive broker contract ID of this leg, or null.
- `assetClass`: `STK`, `OPT`, `FOP`, or null. A combo parent is not a stock leg. Do not report `STK` without broker evidence.
- `ratio`: the signed number of contracts per order unit, or null. Positive means buy; negative means sell. For a single leg, use the order side when it is known.
- `option`: a nullable object with the canonical display symbol, underlying, expiration, strike, right, trading class, exchange, and multiplier. Fill it only after an exact broker-ID match. Keep the raw symbol when the option cannot be resolved.
- `uncertainty`: a bounded list of known identity or ratio issues. Reuse the gateway uncertainty vocabulary where it fits. Do not return raw broker text.

Parse `conidex` using the same signed-ratio rules as active derivative orders. Deduplicate contract resolution by broker ID and limit concurrent broker reads. For a combo, return one leg per identified member in broker order; do not pass a combo parent ID as an option leg. Reject malformed or duplicate members as uncertain rather than turning a combo into one underlying quote. Verify each resolved option contract has the requested broker ID. Preserve partial rows when one leg cannot be resolved. Report snapshot `partial` when identity enrichment has omitted or uncertain data. The gateway must still return usable orders when contract enrichment fails.

Do not rely on the displayed symbol to classify an order. A source field that identifies `STK` and an exact stock contract ID can establish stock identity. If the broker gives no such evidence, keep `assetClass` null and do not fetch a stock quote.

## Gateway contract quote read

Add a read-only `queryOrderContractQuotes` operation. Its request contains a bounded, unique list of positive broker IDs from the order-history legs. The response has an observation time, a completeness status, and a result for each requested ID. Each result reports the same broker ID, asset class, nullable bid, ask, mark, availability, and quote timestamp. Missing or unsupported contracts have an explicit unavailable result. No account identity or raw broker payload leaves the gateway.

Implement the broker read at the IBKR-client boundary with direct contract-ID market-data snapshots. Deduplicate IDs, use bounded batches, and validate that each snapshot ID matches the request. Resolve contract class from exact broker evidence; never reinterpret an option ID as an equity symbol. Market data can be delayed, frozen, partial, or absent. Do not synthesize a live quote from a missing snapshot. A mark can use a broker mark or the midpoint of a valid bid and ask; do not use a stale last trade as a spread mark. Reuse existing gateway retry, timeout, and cancellation handling. A partial batch must not hide valid results from another batch.

## CLI behavior

The IBKR adapter maps the new history fields into optional normalized leg fields. Preserve the existing leg fields. `orders --json` adds the optional identity fields for IBKR and leaves existing fields unchanged. Schwab serialization remains unchanged.

For the human table, show the canonical option symbol for each resolved option leg. Show every leg of a spread on continuation lines if the symbols do not fit in one cell; do not truncate away a leg. For an unresolved leg, show the raw symbol followed by `(unresolved)`. Keep order prices as reported by the broker, including signed net prices and stop prices. This change does not alter the meaning of the order price.

Only resting limit or stop orders get current prices. For an exact stock leg, use its ID-linked stock quote. For an exact single option leg, use its option mark. For a multi-leg option order, calculate an indicative net mark as the sum of each leg mark times its signed ratio. Do this only if every leg has a verified ID, a nonzero ratio, a matching quote, a usable mark, and compatible price units or multipliers. Label the result `Indicative`. Show `-` if any evidence is missing, if units conflict, or if data is unavailable. Label delayed or frozen data; never call it live. Filled and canceled orders show contract names but no current price. An order-history or quote warning must not hide the order list.

Remove the CLI rule that treats an equity-shaped history symbol as proof of stock identity. Do not request a quote for an unresolved contract. Keep quote requests deduplicated and bounded.

## Release sequence

1. Add broker-client contract-ID extraction and market-data reads with tests.
2. Add gateway history fields and the contract quote operation. Generate and publish matching gateway-client types. Keep existing response fields so older clients can keep reading them. Align the existing `tif` and `session` type mismatch with the actual gateway response before full validation.
3. Update the CLI to use the new identity and quote contract. Do not enable the CLI feature against a gateway that lacks the required operation. Add gateway version or operation-capability checks and a clear failure message for an older gateway.
4. Test a single option, a signed two-leg spread, a stock order, a filled option, an unresolved contract, a partial quote batch, and delayed or frozen data. Run each repository's build, lint, typecheck, and test scripts.

## Acceptance checks

- IBIT and SPX option rows show exact option contracts, not the underlying as their instrument.
- No option row displays an underlying equity or index quote as its current contract price.
- A complete spread shows a signed indicative net mark. An incomplete spread shows `-`.
- Historical filled and canceled option rows show a contract when the broker supplies its identity; they never show a current quote.
- An unresolved row remains visible with `(unresolved)` and `-` for Current.
- Existing JSON fields and all Schwab behavior remain unchanged.
