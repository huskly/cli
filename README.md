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
- Guarded derivative preview and order lifecycle commands for IBKR
- MCP server for read tools and derivative tools
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

| Command | Schwab | IBKR |
| --- | --- | --- |
| `quote` | ✓ | ✓ |
| `search` | ✓ | ✓ |
| `movers` | ✓ | ✗ |
| `history` | ✓ | ✗ |
| `chart` | ✓ | ✗ |
| `vix` | ✓ | ✗ |
| `expiries` | ✓ | ✗ |
| `chain` | ✓ | ✗ |
| `option resolve` | ✗ | ✓ |
| `option chain` | ✗ | ✓ |
| `spread quote` | ✗ | ✓ |
| `spread preview` | ✗ | ✓ |
| `spread submit` | ✗ | ✓ |
| `spread recover` | ✗ | ✓ |
| `order show/watch/acknowledge/reconcile/cancel` | ✗ | ✓ |
| `broker doctor` | ✗ | ✓ |
| `account` | ✓ | ✓ |
| `user-preference` | ✓ | ✗ |
| `positions` | ✓ | ✓ |
| `transactions` | ✓ | ✓ |
| `orders` | ✓ | ✓ |
| `place-order` | ✓ | ✗ |
| `repl` | ✓ | ✓ |

IBKR `search` supports `symbol-search` and `search`.
Schwab-only search projections return a clear error under `--broker ibkr`.
Schwab-only commands also return a clear error under `--broker ibkr`.

## IBKR gateway setup

Create one private directory for the gateway credential files.

```bash
mkdir -p ~/.config/huskly
chmod 700 ~/.config/huskly
chmod 600 ~/.config/huskly/ibkr-gateway-cli.json
chmod 600 ~/.config/huskly/ibkr-gateway-mcp.json
```

Use separate files for the CLI and MCP server:

- `~/.config/huskly/ibkr-gateway-cli.json`
- `~/.config/huskly/ibkr-gateway-mcp.json`

Each file must contain this exact JSON shape:

```json
{
  "gatewayUrl": "https://ibkr-gateway.example",
  "tokenUrl": "https://huskly.finance/api/v1/machine/token",
  "clientId": "machine-client-id",
  "clientSecret": "machine-client-secret"
}
```

Use only these path override environment variables:

- `HUSKLY_IBKR_GATEWAY_CLI_CONFIG`
- `HUSKLY_IBKR_GATEWAY_MCP_CONFIG`

Do not put gateway credentials in environment variables.
Gateway authorization comes from the credential scope that the server issues.
A read-only credential can read, but it cannot submit mutations.
There is no direct broker fallback.

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
huskly-cli search AAPL
huskly-cli history AAPL --days 30
huskly-cli chart SPY --days 60
huskly-cli movers '$SPX' --sort PERCENT_CHANGE_UP
huskly-cli vix
```

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

export HUSKLY_EXT_OPERATOR=felipecsl
huskly-cli spread submit <preview-id> --broker ibkr --confirm --json
huskly-cli spread recover <preview-id> --broker ibkr --json
huskly-cli order show <operation-id> --broker ibkr --json
huskly-cli order watch <operation-id> --broker ibkr --json
huskly-cli order acknowledge <operation-id> --reply <reply-id> --broker ibkr --confirm --json
huskly-cli order reconcile <operation-id> --broker ibkr --confirm --json
huskly-cli order cancel <operation-id> --broker ibkr --operator felipecsl --confirm --json
huskly-cli broker doctor --broker ibkr --json
```

Preview and execution state store masked account data only.
Live execution stays fail-closed behind the existing live-execution controls.

## MCP server

`huskly-cli-mcp` exposes read tools and derivative tools over stdio.
`place_option_order` stays Schwab-only.
The IBKR tools use the same gateway transport and safety rules as the CLI.
There is no direct broker fallback.

Build first, then register the server:

```bash
claude mcp add huskly-cli-mcp -- node /path/to/huskly-cli/dist/mcp/server.js
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
- `HUSKLY_PREVIEW_DIR` - Private preview state directory override
- `HUSKLY_EXECUTION_DIR` - Private execution state directory override
- `HUSKLY_IBKR_GATEWAY_CLI_CONFIG` - CLI gateway config path override
- `HUSKLY_IBKR_GATEWAY_MCP_CONFIG` - MCP gateway config path override

## License

MIT © Huskly Finance
