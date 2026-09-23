# Huskly CLI

Huskly CLI is a command line tool for trading work.
It supports Schwab and IBKR.
Schwab uses huskly.finance auth.
IBKR uses the IBKR gateway.
The CLI and MCP server do not talk to IBKR directly.

## Features

- Market data for quotes, search, price history, movers, charts, and VIX
- Shared account reads for balances, positions, transactions, and orders
- Exact derivative research for IBKR
- Guarded derivative and equity preview and order lifecycle tools for IBKR
- MCP server for read, derivative, and equity tools
- Schwab-only Redis caching

## Broker support

Use `--broker` to choose the broker.
The default is `schwab`.

```bash
huskly-cli account
huskly-cli --broker ibkr account
huskly-cli --broker ibkr positions
huskly-cli --broker ibkr transactions
huskly-cli --broker ibkr orders
huskly-cli --broker ibkr repl
```

| Command                                         | Schwab | IBKR |
| ----------------------------------------------- | ------ | ---- |
| `quote`                                         | ✓      | ✓    |
| `search`                                        | ✓      | ✓    |
| `movers`                                        | ✓      | ✗    |
| `history`                                       | ✓      | ✗    |
| `chart`                                         | ✓      | ✗    |
| `vix`                                           | ✓      | ✗    |
| `expiries`                                      | ✓      | ✓    |
| `chain`                                         | ✓      | ✓    |
| `option resolve`                                | ✗      | ✓    |
| `option chain`                                  | ✗      | ✓    |
| `spread quote`                                  | ✗      | ✓    |
| `spread preview`                                | ✗      | ✓    |
| `spread submit`                                 | ✗      | ✓    |
| `spread recover`                                | ✗      | ✓    |
| `order show/watch/acknowledge/reconcile/cancel` | ✗      | ✓    |
| `equity preview`                                | ✗      | ✓    |
| `equity submit`                                 | ✗      | ✓    |
| `broker doctor`                                 | ✓      | ✓    |
| `account`                                       | ✓      | ✓    |
| `user-preference`                               | ✓      | ✗    |
| `positions`                                     | ✓      | ✓    |
| `transactions`                                  | ✓      | ✓    |
| `orders`                                        | ✓      | ✓    |
| `place-order`                                   | ✓      | ✗    |
| `place-option-order`                            | ✓      | ✓    |
| `cancel-order`                                  | ✓      | ✗    |
| `repl`                                          | ✓      | ✓    |

Gateway commands (`option`, `spread`, `order`, `equity`) default to IBKR.
A `--broker` flag on the command wins, then the global `--broker`, then that
default.

### Option chains

`expiries` and `chain` work with both brokers and render the same table.

```bash
huskly-cli expiries AAPL
huskly-cli chain AAPL 2026-12-18 --strikes 5

huskly-cli --broker ibkr expiries IBIT
huskly-cli --broker ibkr chain IBIT 2026-10-02
huskly-cli --broker ibkr chain NDX 2026-08-20 --class NDXP --exchange SMART
```

Omit the expiry to use the nearest listed expiry. Under IBKR, give `--class`
or `--exchange` only when the default series for the underlying is ambiguous.
If the broker cannot price the underlying, the chain still prints and the
missing price is reported above the table.

In-the-money contracts are shaded: green on the call side, red on the put
side. A marker row shows where the underlying sits between two strikes.
When the broker cannot price the underlying, the price is derived from
put-call parity and shown with `≈`.

### Trading and diagnostics

```bash
huskly-cli broker doctor --broker schwab
huskly-cli broker doctor --broker ibkr

huskly-cli orders --status WORKING
huskly-cli cancel-order 1003456789 --confirm

huskly-cli equity preview AAPL BUY 10 --limit 250.00
huskly-cli equity preview AAPL BUY 10 --order-type LIMIT --limit 250.00
huskly-cli equity preview AAPL SELL 10 --order-type STOP --stop-price 240.00
huskly-cli equity submit <preview-id> --operator alice --confirm
```

`equity preview` and `equity submit` drive the same guarded service as the
`preview_equity_order` and `submit_equity_order` MCP tools.
STOP is a native stop-market order, not stop-limit.

### Single-leg option orders

`place-option-order` takes the same arguments for both brokers.

```bash
huskly-cli place-option-order AAPL 2026-01-16 250 CALL 1 BUY_TO_OPEN -p 5.10

huskly-cli --broker ibkr place-option-order IBIT 2026-10-02 42 PUT 1 SELL_TO_OPEN \
  -p 0.99 --confirm
```

Schwab places the order directly from the OCC symbol and accepts `MARKET` or
`LIMIT`. IBKR routes through the guarded gateway, which resolves the exact
contract first and accepts `LIMIT` orders only. An IBKR order needs
`--confirm` and an operator identity from `--operator` or
`HUSKLY_EXT_OPERATOR`. Give `--class` or `--exchange` only when the series is
ambiguous.

The gateway has no What-If for one option leg, so this command has no
preview step. It writes a durable order reference before it calls the broker
and prints that reference with the result. If the response is lost, run the
same command with `--recover <order-ref>`. Recovery reads the outcome back
through the same reservation. It never submits the order twice. Use
`order show`, `order watch`, and `order cancel` with the operation ID for the
rest of the lifecycle.

### Working without Redis

Redis caches Schwab reads. Use `--no-cache` to skip it and read the broker
directly, which also works while Redis is down.

```bash
huskly-cli --no-cache quote AAPL
huskly-cli --no-cache repl
```

### REPL

`huskly-cli repl` runs every CLI command with the same options and help.

```
schwab> quote "AAPL  261218C00330000"
schwab> vix --json
schwab> help quote
schwab> exit
```

The session keeps the broker and the `--no-cache` setting it started with.

IBKR `search` supports `symbol-search` and `search`.
Schwab-only search projections return a clear error under `--broker ibkr`.
Schwab-only commands also return a clear error under `--broker ibkr`.

## IBKR gateway setup

Use huskly.finance auth as the primary setup flow.
Your huskly.finance account must have server permission to provision IBKR credentials.
The server restricts provisioning.
It uses your logged-in auth session to decide if the request is allowed.

```bash
huskly-cli auth login
huskly-cli auth ibkr
huskly-cli broker doctor --broker ibkr --json
```

The auth command writes two local runtime credential files:

- `~/.config/huskly/ibkr-gateway-cli.json`
- `~/.config/huskly/ibkr-gateway-mcp.json`

The two credentials are separate.
Both credentials are read-write.
The server returns each secret one time.
The CLI stores the files in a private directory and writes them with private file permissions.
Do not put gateway credentials in environment variables.
Do not put credentials in command arguments, URLs, or logs.

Credential rotation is immediate.
When you rotate, the prior remote credentials stop working.
If either local credential file already exists, non-interactive use must include `--replace`.
The command does not show an interactive prompt in non-interactive mode.

```bash
huskly-cli auth ibkr --replace
```

Use only these path override environment variables:

- `HUSKLY_IBKR_GATEWAY_CLI_CONFIG`
- `HUSKLY_IBKR_GATEWAY_MCP_CONFIG`

Gateway authorization comes from the credential scope that the server issues.
There is no direct broker fallback.

### Operator recovery: create credential files manually

Use this only when the auth provisioning command is unavailable and an operator gives you replacement credentials through a private channel.
Create one private directory for the gateway credential files.

```bash
mkdir -p ~/.config/huskly
chmod 700 ~/.config/huskly
```

Write separate files for the CLI and MCP server.
Each file must contain this exact four-field JSON shape:

```json
{
  "gatewayUrl": "https://gateway.example",
  "tokenUrl": "https://huskly.finance/api/v1/machine/token",
  "clientId": "mc_example_client_id",
  "clientSecret": "mc_example_client_secret"
}
```

After you write each file, set private file permissions:

```bash
chmod 600 ~/.config/huskly/ibkr-gateway-cli.json
chmod 600 ~/.config/huskly/ibkr-gateway-mcp.json
```

Schwab keychain auth stays the same:

```bash
huskly-cli auth login
huskly-cli auth status
huskly-cli auth logout
```

## Requirements

- Node.js >= 20.0.0
- Redis for Schwab caching
- Schwab auth and/or IBKR gateway credential files

## Install and build

```bash
npm install -g @huskly/cli
```

```bash
git clone https://github.com/huskly/cli.git
cd cli
npm install
npm run build
```

## Common commands

### Market data

```bash
huskly-cli quote AAPL
huskly-cli quote SPY QQQ NVDA
huskly-cli search AAPL
huskly-cli history AAPL --days 30
huskly-cli chart SPY --days 60
huskly-cli movers '$SPX' --sort PERCENT_CHANGE_UP
huskly-cli vix
```

Under Schwab, `quote` also accepts 21-character OSI option symbols.
Quote the symbol so the shell keeps the space padding as one argument.

```bash
huskly-cli quote "AAPL  271217C00250000"   # AAPL 2027-12-17 250 call
huskly-cli quote "SPY   271217P00600000"   # SPY 2027-12-17 600 put
```

An expired or unlisted contract returns "No quote data available".
Use `expiries` and `chain --json` to find a live contract symbol.

Under `--broker ibkr`, `quote` accepts equity symbols only.
Use `option chain` to quote IBKR option series.

Every market-data and account read command accepts `--json` for a stable DTO.

```bash
huskly-cli quote --json AAPL
huskly-cli history AAPL --days 30 --json
huskly-cli chain AAPL 2026-12-18 --strikes 5 --json
huskly-cli expiries AAPL --json
huskly-cli movers '$SPX' --json
huskly-cli vix --json
```

The `chain --json` DTO also gives volume, open interest, and the `delayed` flag,
which the table view does not show.
`chart --image` and `chart --json` are exclusive.

### Shared account reads

```bash
huskly-cli account
huskly-cli positions
huskly-cli transactions
huskly-cli orders

huskly-cli --broker ibkr account
huskly-cli --broker ibkr positions
huskly-cli --broker ibkr transactions
huskly-cli --broker ibkr orders
```

IBKR `orders` shows exact option contract symbols for historical orders when the
gateway confirms each contract ID. A multi-leg order shows each contract on a
separate detail line. The Current column shows a contract mark for resting
single-leg orders. For a complete spread, it shows an indicative signed net
mark. Delayed or frozen quotes have a label. An unresolved contract stays in
the table with `(unresolved)` and `-` for Current. Filled and canceled orders
have no current quote. The Avg Fill column shows the average execution price
for IBKR orders with fills. It can differ from the requested Price. A missing
execution price shows `-`. `orders --json` includes `averageFillPrice` and
optional contract details for IBKR orders. Schwab does not change. Contract
quotes need gateway API 0.17.0 or newer.

### Exact derivative research

```bash
huskly-cli option resolve NQ --broker ibkr \
  --asset FOP --expiry 2026-08-21 --class QN3 --exchange CME --json

huskly-cli option chain NDX --broker ibkr \
  --asset OPT --expiry 2026-08-20 --class NDXP --exchange SMART --right PUT \
  --around 26600 --strikes 4

huskly-cli spread quote put-credit NQ --broker ibkr \
  --asset FOP --expiry 2026-08-21 --class QN3 --exchange CME \
  --long 26400 --short 26600 --quantity 1 --limit 39 --json
```

These commands keep exact asset class, trading class, exchange, multiplier, and evidence data.
They do not use the Schwab Redis cache.

### Guarded derivative workflow

Preview does not submit an order.
Submit uses the exact unexpired preview that you reviewed.
Order commands use gateway operation IDs.

```bash
huskly-cli spread preview put-credit NQ --broker ibkr \
  --asset FOP --expiry 2026-08-21 --class QN3 --exchange CME \
  --short 26600 --long 26400 --quantity 1 --credit 39 --json

export HUSKLY_EXT_OPERATOR=operator-example
huskly-cli spread submit <preview-id> --broker ibkr --confirm --json
huskly-cli spread recover <preview-id> --broker ibkr --json
huskly-cli order show <operation-id> --broker ibkr --json
huskly-cli order watch <operation-id> --broker ibkr --json
huskly-cli order acknowledge <operation-id> --reply <reply-id> --broker ibkr --confirm --json
huskly-cli order reconcile <operation-id> --broker ibkr --confirm --json
huskly-cli order cancel <operation-id> --broker ibkr --operator operator-example --confirm --json
huskly-cli broker doctor --broker ibkr --json
```

Preview and execution state store masked account data only.
Live execution stays fail-closed behind the existing live-execution controls.

### Guarded equity MCP workflow

Equity preview resolves exactly one USD US-listed stock or ETF contract.
It accepts positive whole-share quantities and LIMIT or STOP BUY/SELL orders.
STOP is a native stop-market order, not stop-limit.
It uses `DAY`, `REGULAR`, and `LIMIT` by default.
Preview never submits an order.

Call `preview_equity_order` first. A limit order:

```json
{
  "symbol": "IBIT",
  "side": "BUY",
  "quantity": 2,
  "limit": 52.25
}
```

A stop-market order:

```json
{
  "symbol": "AAPL",
  "side": "SELL",
  "quantity": 10,
  "orderType": "STOP",
  "stopPrice": 240.00
}
```

Review the returned contract, What-If result, environment, and expiry time.
Then call `submit_equity_order` with only the preview ID, operator, and exact confirmation:

```json
{
  "previewId": "<preview-id>",
  "operator": "operator-example",
  "confirm": true
}
```

Submission uses only the immutable terms in the unexpired preview.
Use `get_order_status`, `acknowledge_order_warning`, `reconcile_order_operation`, and `cancel_order` for the returned operation ID.

## MCP server

`huskly-cli-mcp` exposes read, derivative, and guarded equity tools over stdio.
`place_option_order` stays Schwab-only.
The IBKR tools use the same gateway transport and safety rules as the CLI.
There is no direct broker fallback.

Build first, then register the server:

```bash
claude mcp add huskly-cli-mcp -- node /path/to/huskly-cli/dist/mcp/bin.js
claude mcp add huskly-cli-mcp -- huskly-cli-mcp
```

Use `HUSKLY_MCP_DEFAULT_BROKER` to change the default broker for broker-neutral MCP read tools.
The default is `schwab`.

## Project structure

```text
src/
├── auth/
├── brokers/
├── cli/
├── derivatives/
├── gateway/
├── mcp/
├── cache.ts
├── cachedSchwabClient.ts
├── helpers.ts
├── logger.ts
└── types.ts

test/
├── brokers/
├── cli/
├── derivatives/
├── gateway/
├── mcp/
└── orders/
```

## Environment variables

- `LOG_LEVEL` - Pino log level
- `REDIS_URL` - Redis connection URL
- `HUSKLY_MCP_DEFAULT_BROKER` - Default broker for broker-neutral MCP read tools
- `HUSKLY_EXT_OPERATOR` - CME operator identity for submit and cancel when `--operator` is omitted
- `HUSKLY_ENABLE_LIVE_EXECUTION` - Must be `true` to allow live derivative execution
- `HUSKLY_LIVE_ACCOUNT_ALLOWLIST` - Comma-separated live accounts allowed for derivative execution
- `HUSKLY_PREVIEW_DIR` - Private derivative preview state directory override
- `HUSKLY_EQUITY_PREVIEW_DIR` - Private equity preview state directory override
- `HUSKLY_EXECUTION_DIR` - Private execution state directory override
- `HUSKLY_IBKR_GATEWAY_CLI_CONFIG` - CLI gateway config path override
- `HUSKLY_IBKR_GATEWAY_MCP_CONFIG` - MCP gateway config path override

## License

MIT © Huskly Finance
