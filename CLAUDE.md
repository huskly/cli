# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Huskly CLI is a TypeScript command-line interface for trading tools. It supports two brokers, selected via the global `--broker` flag (default `schwab`):

- **Schwab** (`--broker schwab`) — the Charles Schwab API via huskly.finance auth. Full command set (market data, account, orders).
- **IBKR** (`--broker ibkr`) — Interactive Brokers Web API via native OAuth 1.0a. Currently the shared `account`, `positions`, `transactions`, and `orders` commands; other commands are Schwab-only and guarded.

## Build & Development Commands

```bash
# Build
npm run build          # Compile TypeScript to dist/

# Development
npm run dev            # Run with tsx (live TypeScript execution)

# Code Quality
npm run lint           # ESLint
npm run lint:fix       # ESLint with auto-fix
npm run format         # Prettier format
npm run format:check   # Check formatting
npm run typecheck      # TypeScript type checking only
npm run test           # Run tests (node:test, test/**/*.test.ts mirroring src/)

# Full check (run before commits)
npm run check          # lint + format:check + typecheck + test
```

## Architecture

### Entry Points
- `src/index.ts` → delegates to `src/cli/index.ts` (main CLI)
- `src/auth/cli.ts` → auth subcommand (login/logout/status)
- `src/mcp/server.ts` → MCP server exposing market data, account positions, and guarded option-order placement as tools (stdio transport)
- Binaries: `huskly-cli`, `huskly-cli-auth`, `huskly-cli-mcp`

### Core Modules
- **`src/cli/`** - Command handlers using Commander.js. Each command is an async `handleX` function.
- **`src/brokers/`** - Broker-neutral `BrokerClient` interface (`brokerClient.ts`) used by the shared `account`/`positions`/`transactions`/`orders` handlers, plus thin Schwab and IBKR presentation adapters. IBKR transport, OAuth, raw API types, search, transactions, and orders belong to `@huskly/ibkr-client`.
- **`src/auth/`** - OAuth 2.0 Device Authorization flow via huskly.finance, credentials stored in OS keychain via `keytar`
- **`src/cache.ts`** - Redis caching layer with per-operation TTLs (Schwab only)
- **`src/cachedSchwabClient.ts`** - Decorator wrapping `SchwabClient` with Redis caching
- **`src/orders/`** - Shared order-construction/validation helpers (`orderValidation.ts`, `buildOptionOrderRequest.ts`) used by both `src/cli/placeOrder.ts`/`placeOptionOrder.ts` and the `place_option_order` MCP tool, to avoid duplicating validation logic across entry points
- **`src/mcp/`** - MCP server (`@modelcontextprotocol/sdk`, stdio transport) wrapping `src/cli/shared.ts` directly (no CLI subprocess) as market-data and account tools: `get_quote`, `search_symbol`, `get_positions` (broker-agnostic, default `schwab`), and `get_price_history`/`get_movers`/`get_vix_level`/`get_option_chain`/`get_option_expiries` (Schwab-only, no broker param). See `src/mcp/defaultBroker.ts` for the `HUSKLY_MCP_DEFAULT_BROKER` resolution and `src/mcp/toolResult.ts` for the shared error-to-`isError`-result wrapping.
  - `place_option_order` is the one **write** tool (Schwab-only, single-leg orders only): it requires `confirm: true` to actually submit — omitted/`false` returns a preview (contract, instruction, estimated credit/debit) without calling the broker. Shares its OCC-symbol building (`buildOccOptionSymbol` in `src/helpers.ts`) and order-request/validation logic (`src/orders/`) with the CLI's `place-option-order` command.
- **`test/`** - Tests mirror the `src/` directory tree and import production modules through `#src/`.

### API Client Pattern
```typescript
// Shared commands (account, positions, transactions, orders) — broker-aware, pass the resolved broker:
import { brokerClient } from "#src/cli/shared.js";
const api = await brokerClient(broker); // BrokerClient (Schwab or IBKR adapter)

// Schwab-only commands — the cached Schwab client directly:
import { apiClient } from "#src/cli/shared.js";
const api = await apiClient(); // CachedSchwabClient
```

Schwab-only commands are guarded in `src/cli/index.ts` via `guardSchwab(name)`, which throws a clear error under `--broker ibkr`. IBKR runs uncached.

### Caching TTLs
- Quotes: 1 min
- Price history: 1 hour
- Option chains: 5 min
- Positions/balances: 2 min
- User preferences: 1 day
- Write operations: not cached

### Module Aliases
Use `#src/` imports instead of relative paths:
```typescript
import { apiClient } from "#src/cli/shared.js";
import { cache } from "#src/cache.js";
```

## Environment Variables

- `LOG_LEVEL` - Pino log level (trace, debug, info, warn, error). Default: info
- `REDIS_URL` - Redis connection URL. Default: redis://localhost:6379
- `HUSKLY_MCP_DEFAULT_BROKER` - Default broker (`schwab`/`ibkr`) for the MCP server's broker-agnostic tools when a call omits `broker`. Default: schwab

### IBKR (`--broker ibkr`) only
- `IBIND_OAUTH1A_CONSUMER_KEY`, `IBIND_OAUTH1A_ACCESS_TOKEN`, `IBIND_OAUTH1A_ACCESS_TOKEN_SECRET` - required OAuth 1.0a credentials
- `IBIND_OAUTH1A_REALM` - optional, default `limited_poa`
- `IBKR_KEYS_DIR` - directory holding `private_signature.pem`, `private_encryption.pem`, `dhparam.pem`. Default: cwd
- `IBKR_ACCOUNT_ID` - optional account override (otherwise first account)
- `IBKR_TRANSACTION_CURRENCY` - optional currency for `/pa/transactions`. Default: USD

## Code Style (from AGENTS.md)

- **TypeScript**: Full strict mode enabled. Avoid `any`; use `unknown` with narrowing.
- **Modules**: Pure ES modules only. No CommonJS.
- **Naming**: PascalCase for types/classes, camelCase for everything else. No `I` prefix on interfaces.
- **Files**: camelCase filenames (e.g., `userSession.ts`)
- **Imports**: Use `type` keyword for type-only imports
- **Formatting**: Run `npm run format` before commits. Uses Prettier with double quotes, semicolons, 2-space indent, 100 char width.
