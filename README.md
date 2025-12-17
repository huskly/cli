# Huskly CLI

A command line interface for interacting with the Schwab Trader API.

## Features

- **Market Data**: Real-time quotes, options chains, historical data, instrument search, and market movers
- **Instrument Search**: Search by symbol or description with fundamental data support
- **Account Management**: View positions, balances, and transaction history
- **Order Management**: View orders and place simple MARKET/LIMIT orders
- **Caching**: Redis-backed caching for improved performance

## Requirements

- Node.js >= 20.0.0
- Redis (for caching)
- Schwab API credentials (via [huskly.finance](https://huskly.finance))

## Installation

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
```

Options:

- `-s, --start <date>` - Start date (YYYY-MM-DD, defaults to start of year)
- `-e, --end <date>` - End date (YYYY-MM-DD, defaults to today)

### Order Commands

#### orders - List Orders

List account orders with optional filtering.

```bash
huskly-cli orders
huskly-cli orders --from 2024-01-01 --to 2024-12-31
huskly-cli orders --status FILLED
huskly-cli orders --max-results 10
```

Options:

- `-f, --from <date>` - From entered time (YYYY-MM-DD, defaults to 30 days ago)
- `-t, --to <date>` - To entered time (YYYY-MM-DD, defaults to today)
- `-s, --status <status>` - Filter by order status (FILLED, WORKING, CANCELED, etc.)
- `-m, --max-results <n>` - Maximum number of orders to retrieve

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
