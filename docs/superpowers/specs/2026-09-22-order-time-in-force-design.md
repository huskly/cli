# Order Time in Force Design

## Goal

Show an order's time in force and eligible trading session in the shared orders table.

The table has two columns:

- **TIF** shows values such as `DAY` or `GTC`.
- **Session** shows `REGULAR` or `OVERNIGHT`.

The implementation must preserve these facts from the IBKR API through all public contracts. It must also display equivalent Schwab order fields.

## Scope

This change covers three repositories in dependency order:

1. `ibkr-client` normalizes the raw IBKR order fields.
2. `ibkr-gateway` publishes the normalized fields in order-history responses.
3. `huskly-cli` maps and displays the fields.

Order submission behavior does not change.

## Data Contracts

### IBKR client

Extend the shared historical `BrokerOrder` with:

- `tif?: string`
- `session?: "REGULAR" | "OVERNIGHT" | "UNKNOWN"`

Read `tif` from the raw `tif` or `timeInForce` field. Read the session from `outsideRTH` or `outside_rth`:

- `true` becomes `OVERNIGHT`.
- `false` becomes `REGULAR`.
- A missing value becomes `UNKNOWN`.

This follows the existing active derivative order normalization. TIF remains a string because IBKR can add values beyond `DAY` and `GTC`.

### IBKR gateway

Extend `HistoricalOrder` and the order-history API schema with required nullable fields:

- `tif: string | null`
- `session: "REGULAR" | "OVERNIGHT" | "UNKNOWN" | null`

The gateway parser maps absent client fields to `null`. The OpenAPI document and generated TypeScript client expose both fields.

### Huskly CLI

Extend the broker-neutral `BrokerOrder` with optional nullable `tif` and `session` fields. The IBKR adapter maps the gateway fields directly. The Schwab adapter maps Schwab `duration` to `tif` and maps Schwab `session` to the shared session field.

## Table Output

Add **TIF** and **Session** after **Type**. Each value uses its own fixed-width column. A missing value or `UNKNOWN` displays as `-` so the table does not present uncertainty as a known trading session.

JSON output includes the fields supplied by each broker without presentation changes.

## Validation and Errors

The gateway keeps strict response validation. Invalid field types fail at the contract boundary. New TIF strings pass through without a fixed allowlist. The session field accepts only the normalized session values.

The CLI remains compatible with observations that omit the new fields. This allows clear behavior during deployment and for incomplete broker evidence.

## Testing

Use test-first changes in each repository:

- `ibkr-client`: verify aliases, regular and overnight sessions, and missing evidence.
- `ibkr-gateway`: verify parsing, service output, OpenAPI schema, and generated client types.
- `huskly-cli`: verify IBKR and Schwab adapter mapping, JSON output, table headings, table values, and missing-value rendering.

Run the targeted tests first. Then run each repository's full check command.

## Delivery

Implement and release in dependency order:

1. Release `ibkr-client`.
2. Update `ibkr-gateway`, regenerate and release its client package.
3. Update `huskly-cli` to the new gateway client and render the fields.

Local workspace dependencies can validate the complete flow before package publication.
