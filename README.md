# Huskly CLI

A command line interface for trading APIs. Supports **Schwab** (via
[huskly.finance](https://huskly.finance) auth) and **Interactive Brokers**
(via [`@huskly/ibkr-client`](https://github.com/huskly/ibkr-client), which owns
the native OAuth 1.0a and Interactive Brokers API integration).

## Features

- **Market Data**: Real-time quotes, options chains, historical data, instrument search, and market movers
- **Instrument Search**: Search by symbol or description with fundamental data support
- **Account Management**: View positions, balances, and transaction history
- **Order Management**: View orders and place simple MARKET/LIMIT orders
- **Caching**: Redis-backed caching for improved performance
- **Multi-broker**: Schwab (default) and IBKR via the global `--broker` flag
- **MCP server**: `huskly-cli-mcp` exposes market data as MCP tools for Claude

## Brokers

Select the broker per invocation with the global `--broker` flag (default `schwab`):

```bash
huskly-cli account                 # Schwab (default)
huskly-cli --broker ibkr account   # Interactive Brokers
huskly-cli --broker ibkr positions
huskly-cli --broker ibkr transactions
huskly-cli --broker ibkr orders
huskly-cli --broker ibkr repl
```

### Broker command support

Use this matrix to track broker parity as IBKR support expands. A checkmark
means the command supports that broker today; a cross means it is not yet
implemented for that broker.

| Command           | Schwab | IBKR |
| ----------------- | ------ | ---- |
| `quote`           | ✓      | ✓    |
| `search`          | ✓      | ✓    |
| `movers`          | ✓      | ✗    |
| `history`         | ✓      | ✗    |
| `chart`           | ✓      | ✗    |
| `vix`             | ✓      | ✗    |
| `expiries`        | ✓      | ✗    |
| `chain`           | ✓      | ✗    |
| `option resolve`  | ✗      | ✓    |
| `option chain`    | ✗      | ✓    |
| `spread quote`    | ✗      | ✓    |
| `spread preview`  | ✗      | ✓    |
| `spread submit`   | ✗      | ✓    |
| `order show/watch/cancel` | ✗ | ✓ |
| `broker doctor`   | ✗      | ✓    |
| `account`         | ✓      | ✓    |
| `user-preference` | ✓      | ✗    |
| `positions`       | ✓      | ✓    |
| `transactions`    | ✓      | ✓    |
| `orders`          | ✓      | ✓    |
| `place-order`     | ✓      | ✗    |
| `repl`            | ✓      | ✓    |

IBKR currently supports the shared **`account`**, **`quote`**, **`search`**,
**`positions`**, **`transactions`**, **`orders`**, and **`repl`** commands plus
exact-series **`option resolve`**, **`option chain`**, **`spread quote`**, guarded
**`spread preview`/`spread submit`**, and derivative **`order`** lifecycle commands. IBKR
`search` supports symbol lookup via `symbol-search` / `search`; Schwab-specific
regex, description, and fundamental projections report a clear error under
`--broker ibkr`. All other broker commands (`chain`, `movers`, `place-order`,
etc.) are Schwab-only and will report a clear error under `--broker ibkr`.

### IBKR setup

IBKR uses OAuth 1.0a. Copy `.env.example` to `.env` and fill in the consumer
key / access token / secret from the IBKR self-service portal, and place the
PEM key files (`private_signature.pem`, `private_encryption.pem`, `dhparam.pem`)
in the working directory (or set `IBKR_KEYS_DIR`). See `.env.example` for the
full list of variables.

All IBKR transport, OAuth, endpoint response normalization, instrument search,
transactions, and order behavior lives in `@huskly/ibkr-client`. This project
keeps only the shared CLI presentation adapter and Redis read cache.

### Derivative identity boundary

The read-only derivative foundation uses a separate `DerivativeDiscoveryClient`
capability instead of widening the account-oriented `BrokerClient`. Its normalized
identity includes asset class (`OPT` or `FOP`), underlying, expiration, strike,
right, trading class, exchange, multiplier, and optional settlement/exercise
metadata. That identity distinguishes contracts such as NDX and NDXP even when
their underlying, expiration, and strike match.

IBKR conids are converted by `IbkrDerivativeAdapter` into an opaque
`brokerReference`. This reference is useful for an immediate broker request but
is not durable identity and must not be persisted in place of the semantic fields.
Market-data availability remains explicit (`live`, `delayed`, `frozen`,
`frozen-delayed`, or `unavailable`), and missing prices, activity, or Greeks stay
nullable. Discovery cannot reach preview or order-write endpoints.

The broker-neutral research service powers the user-facing `option` and `spread`
commands. Its current production adapter is IBKR; Schwab remains unsupported until
it can supply the exact trading-class/exchange identity without guessing. The
existing top-level `expiries` and `chain` commands remain unchanged and Schwab-only.

## Requirements

- Node.js >= 20.0.0
- Redis (for Schwab caching)
- Schwab API credentials (via [huskly.finance](https://huskly.finance)), and/or
  IBKR OAuth 1.0a credentials for `--broker ibkr`

## Installation

`npm install -g @huskly/cli`

## Building from source

```bash
git clone https://github.com/huskly/cli.git
cd cli
npm install
npm run build
```

## Usage

### Authentication

```bash
# Login via huskly.finance auth
huskly-cli auth login

# Check authentication status
huskly-cli auth status

# Logout
huskly-cli auth logout
```

### Data Commands

#### quote - Get Stock Quotes

Get current price quotes for one or more symbols.

```bash
huskly-cli quote AAPL
huskly-cli quote AAPL MSFT GOOGL
```

#### search - Search Instruments

Search for instruments by symbol or description. Supports multiple search modes including fundamental data retrieval.

```bash
# Search by symbol prefix (default)
huskly-cli search AAPL

# Search by symbol using regex
huskly-cli search "^AA" --projection symbol-regex

# Search by description
huskly-cli search "Apple" --projection desc-search

# Search description with regex
huskly-cli search "tech.*inc" --projection desc-regex

# Get fundamental data for a symbol
huskly-cli search AAPL --projection fundamental
```

Options:

- `-p, --projection <type>` - Search type (default: symbol-search)
  - `symbol-search` - Search by symbol prefix
  - `symbol-regex` - Search by symbol using regex pattern
  - `desc-search` - Search by description text
  - `desc-regex` - Search description using regex pattern
  - `search` - General search
  - `fundamental` - Get detailed fundamental data (P/E, EPS, market cap, dividends, margins, etc.)

#### movers - Top Market Movers

Get the top 10 movers for a specific index or market segment.

```bash
# Get top movers for Dow Jones Industrial Average
huskly-cli movers '$DJI'

# Get top movers for S&P 500 sorted by percent change up
huskly-cli movers '$SPX' --sort PERCENT_CHANGE_UP

# Get NASDAQ movers sorted by volume
huskly-cli movers NASDAQ --sort VOLUME

# Get all equity movers with 5-minute frequency
huskly-cli movers EQUITY_ALL --frequency 5
```

Arguments:

- `<index>` - Index symbol: `$DJI`, `$COMPX`, `$SPX`, `NYSE`, `NASDAQ`, `OTCBB`, `INDEX_ALL`, `EQUITY_ALL`, `OPTION_ALL`, `OPTION_PUT`, `OPTION_CALL`

Options:

- `-s, --sort <type>` - Sort by: `VOLUME`, `TRADES`, `PERCENT_CHANGE_UP`, `PERCENT_CHANGE_DOWN`
- `-f, --frequency <minutes>` - Frequency in minutes: 0, 1, 5, 10, 30, 60 (default: 0)

#### history - Price History

Get historical price data for a symbol.

```bash
huskly-cli history AAPL
huskly-cli history AAPL --days 30
```

Options:

- `-d, --days <n>` - Number of days of history (default: 10)

#### chart - ASCII Price Chart

Display an ASCII chart of price history.

```bash
huskly-cli chart SPY
huskly-cli chart SPY --days 60 --height 20
huskly-cli chart SPY --image  # Open image chart in browser
```

Options:

- `-d, --days <n>` - Number of days of history (default: 30)
- `-h, --height <n>` - Chart height in rows (default: 15)
- `-i, --image` - Generate image chart and open in browser

#### vix - VIX Level

Get the current VIX level with sentiment indicator.

```bash
huskly-cli vix
```

#### expiries - Option Expiration Dates

List available option expiration dates for a symbol.

```bash
huskly-cli expiries SPX
huskly-cli expiries SPY --type CALL
huskly-cli expiries AAPL --from 2024-01-01 --to 2024-06-30
```

Options:

- `-t, --type <type>` - Contract type: PUT or CALL (default: PUT)
- `-f, --from <date>` - Start date (YYYY-MM-DD)
- `-e, --to <date>` - End date (YYYY-MM-DD)

#### chain - Options Chain

Get the options chain for a symbol and expiration date.

```bash
huskly-cli chain SPX
huskly-cli chain SPX 2024-12-20
huskly-cli chain AAPL --around 180 --strikes 5
```

Options:

- `-a, --around <strike>` - Filter strikes around this price (defaults to last price)
- `-s, --strikes <count>` - Number of strikes to show above/below center (default: 10)

#### option - Exact Derivative Research

Resolve one exact contract or quote a series without collapsing trading class,
exchange, asset class, or multiplier. Every exploratory command supports `--json`.

```bash
huskly-cli option resolve NQ --broker ibkr \
  --asset FOP --expiry 2026-08-21 --class QN3 --exchange CME --json

huskly-cli option chain NDX --broker ibkr \
  --asset OPT --expiry 2026-08-20 --class NDXP --exchange SMART --right PUT \
  --around 26600 --strikes 4
```

For futures options, the reference quote is the actual underlying futures contract
reported by IBKR, not a guessed spot/index proxy. For example, the NQ `QN3` option
series can reference the September NQ future.

#### spread quote - Vertical Spread Research

Analyze call/put debit or credit verticals from exact individual-leg markets.
Amounts include contract multiplier and quantity.

```bash
huskly-cli spread quote put-credit NQ --broker ibkr \
  --asset FOP --expiry 2026-08-21 --class QN3 --exchange CME \
  --long 26400 --short 26600 --quantity 1 --limit 39 --json

huskly-cli spread quote put-credit NDX --broker ibkr \
  --asset OPT --expiry 2026-08-20 --class NDXP --exchange SMART \
  --long 26400 --short 26600
```

The natural and midpoint scenarios are synthetic values computed from individual
leg quotes. They are not a broker combo NBBO, executable preview, or order quote.
The result includes maximum profit/loss, breakeven, return on risk, net delta, an
expiration payoff table, and an explicit settlement/residual-exposure warning.
Derivative research calls bypass the Redis read cache; each DTO retains the broker
quote timestamp and live/delayed/frozen/unavailable availability state.

#### spread preview - Explicit IBKR What-If

Preview one atomic vertical without submitting it. An exact account is mandatory,
either through `--account` or `IBKR_ACCOUNT_ID`. User-facing credits and debits are
always positive; IBKR's signed combo-price encoding stays inside the broker adapter.

```bash
huskly-cli spread preview put-credit NQ --broker ibkr \
  --account U1234567 --asset FOP --expiry 2026-08-21 --class QN3 \
  --exchange CME --short 26600 --long 26400 --quantity 1 --credit 39 --json
```

The output masks the account, identifies live versus paper, includes exact legs,
margin, commissions/fees, warnings and rejections, and states `submitted: false`.
Its preview ID binds the account/environment, exact contracts, quantity, limit,
TIF, session, timestamp, and normalized What-If result and expires after five minutes.
The owner-readable preview file stores only a one-way account digest and masked DTO so a
separate CLI invocation can submit it without persisting the full account ID. Unknown or
incomplete What-If results fail closed.

#### spread submit and order - Guarded IBKR Execution

Submit only the exact unexpired preview that was reviewed. Futures and futures-option writes
also require the operator identity used for CME audit metadata.

```bash
export HUSKLY_EXT_OPERATOR=felipecsl
huskly-cli spread submit <preview-id> --broker ibkr --account U1234567 --confirm --json

# A known broker warning must be acknowledged explicitly; unknown warnings stop the flow.
huskly-cli spread acknowledge <preview-id> <reply-id> \
  --broker ibkr --account U1234567 --confirm --json

huskly-cli order show <order-id> --broker ibkr --account U1234567 --json
huskly-cli order watch <order-id> --broker ibkr --account U1234567 --json
huskly-cli order cancel <order-id> --broker ibkr --account U1234567 \
  --operator felipecsl --confirm --json
```

Before placement the workflow verifies the exact account/session and environment, rejects
expired previews or contract drift, and submits one atomic combo with a unique client order ID.
After placement and cancellation it reads fresh broker state and verifies the legs, signed
ratios, quantity, signed limit, and client order identity against the reviewed preview. Partial
fills remain visible; cancellation succeeds only after the broker reaches `CANCELED`.

Paper accounts are allowed by default. Live execution fails closed unless both
`HUSKLY_ENABLE_LIVE_EXECUTION=true` and an exact comma-separated
`HUSKLY_LIVE_ACCOUNT_ALLOWLIST` include the requested account. Execution state persists only an
account digest and masked preview DTO, never the full account identifier.

#### broker doctor - Trading Diagnostics

```bash
huskly-cli broker doctor --broker ibkr --account U1234567 --trading --json
```

This command is read-only. It reports masked account/environment identity,
authentication and competing-session state, market-data access, and advisory asset
permissions. Permission metadata is diagnostic only; an explicit What-If response is
the authoritative pre-submission gate.

### Account Commands

#### account - Account Summary

Show account equity and net liquidation value.

```bash
huskly-cli account
```

#### positions - Account Positions

Show all account positions, optionally filtered by symbol.

```bash
huskly-cli positions
huskly-cli positions AAPL
```

#### transactions - Transaction History

List account transaction history.

```bash
huskly-cli transactions
huskly-cli transactions --start 2024-01-01 --end 2024-12-31
huskly-cli --broker ibkr transactions
```

Options:

- `-s, --start <date>` - Start date (YYYY-MM-DD, defaults to start of year)
- `-e, --end <date>` - End date (YYYY-MM-DD, defaults to today)
- `-t, --type <type>` - Filter by transaction type (e.g., TRADE, DIVIDEND, BUY, SELL)
- `--csv` - Output in CSV format instead of table

IBKR transaction history is sourced from the Web API PortfolioAnalyst
`/pa/transactions` endpoint, which requires one contract id per request. The CLI
queries the contract ids present in current IBKR positions, then filters the
results to the requested date range.

### Order Commands

#### orders - List Orders

List account orders with optional filtering.

```bash
huskly-cli orders
huskly-cli --broker ibkr orders
huskly-cli orders --from 2024-01-01 --to 2024-12-31
huskly-cli orders --status FILLED
huskly-cli orders --max-results 10
```

Options:

- `-f, --from <date>` - From entered time (YYYY-MM-DD, defaults to 30 days ago)
- `-t, --to <date>` - To entered time (YYYY-MM-DD, defaults to today)
- `-s, --status <status>` - Filter by order status (FILLED, WORKING, CANCELED, etc.)
- `-m, --max-results <n>` - Maximum number of orders to retrieve

IBKR orders are sourced from the live `/iserver/account/orders` endpoint, then
filtered locally by date and maximum result count.

#### place-order - Place an Order

Place an order for equities.

```bash
# Market order to buy 10 shares of AAPL
huskly-cli place-order AAPL 10 BUY

# Limit order to buy 5 shares of MSFT at $400
huskly-cli place-order MSFT 5 BUY --type LIMIT --price 400

# Market order to sell 20 shares
huskly-cli place-order GOOGL 20 SELL

# Sell short with Good Till Cancel duration
huskly-cli place-order SPY 100 SELL_SHORT --duration GOOD_TILL_CANCEL
```

Arguments:

- `<symbol>` - Stock symbol to trade
- `<quantity>` - Number of shares
- `<instruction>` - Order instruction: BUY, SELL, BUY_TO_COVER, SELL_SHORT

Options:

- `-t, --type <type>` - Order type: MARKET or LIMIT (default: MARKET)
- `-p, --price <price>` - Limit price (required for LIMIT orders)
- `-s, --session <session>` - Trading session: NORMAL, AM, PM, SEAMLESS (default: NORMAL)
- `-d, --duration <duration>` - Order duration: DAY, GOOD_TILL_CANCEL, FILL_OR_KILL, IMMEDIATE_OR_CANCEL (default: DAY)

### Interactive Mode

#### repl - Interactive REPL

Start an interactive REPL to run multiple commands without re-authenticating.

```bash
huskly-cli repl
huskly-cli --broker ibkr repl
```

## Using with Claude Code or Codex (MCP server)

`huskly-cli-mcp` exposes market-data, account, and guarded derivative operations as MCP
tools — `get_quote`, `search_symbol`, `get_positions`, `get_price_history`,
`get_movers`, `get_vix_level`, `get_option_chain`, `get_option_expiries`, and
`place_option_order`, plus `get_derivative_chain`, `quote_option_spread`,
`preview_option_spread_order`, `submit_option_spread_order`,
`acknowledge_order_warning`, `get_order_status`, and `cancel_order`
— so Claude can answer questions like "what's the MSFT price now", "what's
the AAPL last 12 months price history", or "what are my current positions"
with live data.

`place_option_order` is Schwab-only and
requires `confirm: true` to submit a real live order; when `confirm` is omitted
or `false`, it returns a preview without calling the broker. The IBKR derivative tools reuse the
same exact-preview and lifecycle services as the CLI. Submission, warning acknowledgment, and
cancellation require `confirm: true`; unknown warning IDs and unguarded order IDs fail closed.

It communicates over stdio and reuses the same Schwab/IBKR auth as the CLI, so
authenticate first (`huskly-cli auth login` for Schwab, and/or set the IBKR
env vars — see [IBKR setup](#ibkr-setup)) before registering it.

`get_quote`, `search_symbol`, and `get_positions` work with either broker
(`schwab` by default, overridable per-call or via `HUSKLY_MCP_DEFAULT_BROKER`);
the rest (`get_price_history`, `get_movers`, `get_vix_level`,
`get_option_chain`, `get_option_expiries`) always use Schwab, since IBKR
doesn't expose that data today.

Register it with Claude Code:

```bash
# After `npm run build`, from this repo:
claude mcp add huskly-cli-mcp -- node /path/to/huskly-cli/dist/mcp/server.js

# Or, once published/linked so `huskly-cli-mcp` is on PATH:
claude mcp add huskly-cli-mcp -- huskly-cli-mcp

# To default to IBKR instead of Schwab:
claude mcp add huskly-cli-mcp -e HUSKLY_MCP_DEFAULT_BROKER=ibkr -- huskly-cli-mcp
```

Register it with Codex:

```bash
codex mcp add huskly-cli-mcp -- node /path/to/huskly-cli/dist/mcp/server.js
```

If Codex will launch the server outside this repository, set the MCP server
`cwd` to the repository path so local `.env` and IBKR PEM files resolve the same
way they do for the CLI.

The server is long-lived (same as `huskly-cli repl`), so a broker client — and
the access token/session it holds — is created once and reused across tool
calls. If a Schwab or IBKR session expires or is revoked mid-session, restart
the MCP server (e.g. via `claude mcp` reconnect) to force re-authentication.

## Project Structure

```
src/
├── auth/           # Authentication (huskly.finance device auth)
├── cli/            # CLI commands
├── mcp/            # MCP server (huskly-cli-mcp) exposing market data and account positions as tools
├── schwab/         # Schwab API integration
├── types.ts        # TypeScript type definitions
├── cache.ts        # Redis caching layer
├── helpers.ts      # Utility functions
├── logger.ts       # Logging configuration
└── marketDataSource.ts  # Market data abstraction
```

## Environment Variables

- `LOG_LEVEL` - Set logging level (trace, debug, info, warn, error)
- `REDIS_URL` - Redis connection URL (defaults to localhost:6379)
- `HUSKLY_MCP_DEFAULT_BROKER` - Default broker (`schwab` or `ibkr`) for the MCP server's broker-agnostic tools when a call omits `broker` (defaults to `schwab`; an invalid value logs a warning to stderr and falls back to `schwab` rather than failing startup)
- `HUSKLY_EXT_OPERATOR` - CME operator identity used by derivative submit/cancel CLI commands when `--operator` is omitted
- `HUSKLY_ENABLE_LIVE_EXECUTION` - Must be exactly `true` to permit live derivative execution
- `HUSKLY_LIVE_ACCOUNT_ALLOWLIST` - Comma-separated exact account IDs permitted for live derivative execution
- `HUSKLY_PREVIEW_DIR` / `HUSKLY_EXECUTION_DIR` - Optional owner-readable workflow-state directories

## License

MIT © Huskly Finance
