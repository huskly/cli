# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Huskly CLI is a TypeScript command-line interface for trading tools that integrates with the Charles Schwab API via huskly.finance. It provides market data, account management, and order placement capabilities.

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

# Full check (run before commits)
npm run check          # lint + format:check + typecheck
```

## Architecture

### Entry Points
- `src/index.ts` → delegates to `src/cli/index.ts` (main CLI)
- `src/auth/cli.ts` → auth subcommand (login/logout/status)
- Binaries: `huskly-cli` and `huskly-cli-auth`

### Core Modules
- **`src/cli/`** - Command handlers using Commander.js. Each command is an async `handleX` function.
- **`src/auth/`** - OAuth 2.0 Device Authorization flow via huskly.finance, credentials stored in OS keychain via `keytar`
- **`src/cache.ts`** - Redis caching layer with per-operation TTLs
- **`src/cachedSchwabClient.ts`** - Decorator wrapping `SchwabClient` with Redis caching

### API Client Pattern
```typescript
// In CLI handlers, always use the shared factory:
import { apiClient } from "#src/cli/shared.js";
const api = await apiClient();
```

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

## Code Style (from AGENTS.md)

- **TypeScript**: Full strict mode enabled. Avoid `any`; use `unknown` with narrowing.
- **Modules**: Pure ES modules only. No CommonJS.
- **Naming**: PascalCase for types/classes, camelCase for everything else. No `I` prefix on interfaces.
- **Files**: camelCase filenames (e.g., `userSession.ts`)
- **Imports**: Use `type` keyword for type-only imports
- **Formatting**: Run `npm run format` before commits. Uses Prettier with double quotes, semicolons, 2-space indent, 100 char width.
