# Huskly CLI

A simple command line interface for interacting with the Schwab Trader API.

## Features

- **Market Data**: Real-time quotes, options chains, and historical data
- **Caching**: Redis-backed caching for improved performance

## Requirements

- Node.js >= 20.0.0
- Redis (for caching)
- Schwab API credentials (via [huskly.finance](https://huskly.finance))

## Installation

```bash
git clone https://github.com/huskly/cli.git
cd cli
yarn install
```

## Usage

### Authentication

```bash
# Login via huskly.finance auth
bun src/index.ts auth login
```

### Market Data

```bash
# Get a stock quote
bun src/index.ts market quote SPY

# Get options chain
bun src/index.ts market chain SPX

# View all commands
bun src/index.ts market --help
Usage: huskly-cli-market [options] [command]

Explore market data from Schwab API

Options:
  -V, --version                      output the version number
  -h, --help                         display help for command

Commands:
  quote <symbols...>                 Get current price quotes for one or more symbols
  history [options] <symbol>         Get price history for a symbol
  chart [options] <symbol>           Display ASCII price chart for a symbol
  vix                                Get current VIX level with sentiment indicator
  expiries [options] <symbol>        List available option expiration dates
  chain [options] <symbol> [expiry]  Get option chain for a symbol and expiry
  account                            Show account equity/net liquidation value
  positions [symbol]                 Show all account positions, optionally filtered by symbol
  transactions [options]             List account transaction history (defaults to current year)
  repl                               Start an interactive REPL to run multiple commands
  help [command]                     display help for command
```

## Project Structure

```
src/
├── auth/           # Authentication (huskly.finance device auth)
├── cli/            # CLI commands (market, strategy, backtest)
├── schwab/         # Schwab API integration
├── cache.ts        # Redis caching layer
├── helpers.ts      # Utility functions
├── logger.ts       # Logging configuration
└── marketDataSource.ts  # Market data abstraction
```

## License

MIT © Huskly Finance
