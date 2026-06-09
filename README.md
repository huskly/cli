# Huskly CLI

A command line interface for trading APIs. Supports **Schwab** (via
[huskly.finance](https://huskly.finance) auth) and **Interactive Brokers**
(via native OAuth 1.0a).

## Features

- **Market Data**: Real-time quotes, options chains, historical data, instrument search, and market movers
- **Instrument Search**: Search by symbol or description with fundamental data support
- **Account Management**: View positions, balances, and transaction history
- **Order Management**: View orders and place simple MARKET/LIMIT orders
- **Caching**: Redis-backed caching for improved performance
- **Multi-broker**: Schwab (default) and IBKR via the global `--broker` flag

## Brokers

Select the broker per invocation with the global `--broker` flag (default `schwab`):

```bash
huskly-cli account                 # Schwab (default)
huskly-cli --broker ibkr account   # Interactive Brokers
huskly-cli --broker ibkr positions
huskly-cli --broker ibkr transactions
huskly-cli --broker ibkr orders
```

### Broker command support

Use this matrix to track broker parity as IBKR support expands. A checkmark
means the command supports that broker today; a cross means it is not yet
implemented for that broker.

| Command | Schwab | IBKR |
| --- | --- | --- |
| `quote` | ✓ | ✗ |
| `search` | ✓ | ✗ |
| `movers` | ✓ | ✗ |
| `history` | ✓ | ✗ |
| `chart` | ✓ | ✗ |
| `vix` | ✓ | ✗ |
| `expiries` | ✓ | ✗ |
| `chain` | ✓ | ✗ |
| `account` | ✓ | ✓ |
| `user-preference` | ✓ | ✗ |
| `positions` | ✓ | ✓ |
| `transactions` | ✓ | ✓ |
| `orders` | ✓ | ✓ |
| `place-order` | ✓ | ✗ |
| `repl` | ✓ | ✗ |

IBKR currently supports the shared **`account`**, **`positions`**,
**`transactions`**, and **`orders`** commands. All other broker commands
(`quote`, `chain`, `movers`, `place-order`, etc.) are Schwab-only and will
report a clear error under `--broker ibkr`.

### IBKR setup

IBKR uses OAuth 1.0a. Copy `.env.example` to `.env` and fill in the consumer
key / access token / secret from the IBKR self-service portal, and place the
PEM key files (`private_signature.pem`, `private_encryption.pem`, `dhparam.pem`)
in the working directory (or set `IBKR_KEYS_DIR`). See `.env.example` for the
full list of variables.

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
```

## Project Structure

```
src/
├── auth/           # Authentication (huskly.finance device auth)
├── cli/            # CLI commands
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

## License

MIT © Huskly Finance
