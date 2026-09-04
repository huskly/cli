# CLAUDE.md

This file gives guidance for agents that work in this repository.

## Project overview

Huskly CLI is a TypeScript command line tool for trading work.
It supports two broker paths:

- **Schwab** (`--broker schwab`) uses huskly.finance device auth.
- **IBKR** (`--broker ibkr`) uses the IBKR gateway. The CLI and MCP server do not talk to IBKR directly.

## Build and development commands

```bash
npm run build
npm run dev
npm run lint
npm run lint:fix
npm run format
npm run format:check
npm run typecheck
npm run test
npm run check
```

## Architecture

### Entry points

- `src/index.ts` → main CLI
- `src/auth/cli.ts` → Schwab auth commands
- `src/mcp/server.ts` → MCP server over stdio

### Main modules

- `src/cli/` - Command handlers
- `src/brokers/` - Broker-neutral read interfaces and adapters
- `src/gateway/` - IBKR gateway config, token, transport, and mutation adapters
- `src/derivatives/` - Exact derivative research, preview, and order workflow
- `src/auth/` - Schwab device auth stored in the OS keychain
- `src/cache.ts` and `src/cachedSchwabClient.ts` - Schwab-only Redis caching
- `src/mcp/` - MCP tools that call the same services as the CLI
- `test/` - Tests that mirror `src/`

### Client pattern

```typescript
import { brokerClient } from "#src/cli/shared.js";
const readApi = await brokerClient("ibkr");

import { apiClient } from "#src/cli/shared.js";
const schwabApi = await apiClient();
```

Use `brokerClient()` for shared read commands.
Use `apiClient()` only for Schwab-only commands.
There is no direct IBKR client and no local fallback.

## IBKR gateway credentials

The CLI default file is `~/.config/huskly/ibkr-gateway-cli.json`.
The MCP default file is `~/.config/huskly/ibkr-gateway-mcp.json`.
Keep the directory mode at `0700`.
Keep each file mode at `0600`.

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
If the scope is read-only, mutations fail with authorization errors.
There is no direct broker fallback.

## Environment variables

- `LOG_LEVEL` - Pino log level
- `REDIS_URL` - Redis connection URL
- `HUSKLY_MCP_DEFAULT_BROKER` - Default broker for broker-neutral MCP read tools
- `HUSKLY_EXT_OPERATOR` - CME operator identity for derivative submit and cancel
- `HUSKLY_ENABLE_LIVE_EXECUTION` - Must be `true` to allow live derivative execution
- `HUSKLY_LIVE_ACCOUNT_ALLOWLIST` - Comma-separated live accounts allowed for derivative execution
- `HUSKLY_PREVIEW_DIR` - Private preview state directory override
- `HUSKLY_EXECUTION_DIR` - Private execution state directory override
- `HUSKLY_IBKR_GATEWAY_CLI_CONFIG` - CLI gateway config path override
- `HUSKLY_IBKR_GATEWAY_MCP_CONFIG` - MCP gateway config path override

## Notes

- `place_option_order` stays Schwab-only.
- Use `#src/` imports instead of relative imports when an alias exists.
- Keep TypeScript strict. Avoid `any`. Use `unknown` and narrow it.
