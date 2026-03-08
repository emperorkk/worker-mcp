# SoftOne MCP Worker (Cloudflare)

Cloudflare Worker that exposes a remote MCP server for OpenAI/ChatGPT and connects to SoftOne ERP only through documented SoftOne Web Services.

## Architecture

`ChatGPT/Codex -> Cloudflare Worker MCP -> SoftOne WS`

## Endpoints

- `GET /health`
- `POST /mcp`
- `GET /.well-known/oauth-authorization-server`
- `GET /oauth/authorize`
- `POST /oauth/token`
- `POST /oauth/revoke`

## Tools

- `getCustomer` (implemented with `selectorFields`)
- `searchCustomers` (safe stub until tenant browser payload is provided)

## OAuth support (required)

This Worker now supports OAuth authorization code + PKCE for ChatGPT App Builder.

### OAuth metadata URL

```text
https://worker-mcp.kkourentzes.workers.dev/.well-known/oauth-authorization-server
```

### OAuth endpoints

- Authorization URL: `https://worker-mcp.kkourentzes.workers.dev/oauth/authorize`
- Token URL: `https://worker-mcp.kkourentzes.workers.dev/oauth/token`

### Required auth env vars

- `MCP_AUTH_MODE=oauth` (recommended)
- `OAUTH_CLIENT_ID`
- `OAUTH_CLIENT_SECRET` (recommended)
- `OAUTH_ISSUER_URL` (public origin)

Supported auth modes:

- `oauth` (required result for ChatGPT app builder)
- `bearer` (static bearer token)
- `header` (legacy `x-mcp-secret`)
- `either` (accepts header + bearer + oauth)
- `none` (testing only)

## SoftOne env vars

- `SOFTONE_URL`
- `SOFTONE_USER`
- `SOFTONE_PASSWORD`
- `SOFTONE_APP_ID`
- `SOFTONE_COMPANY`
- `SOFTONE_BRANCH`
- `SOFTONE_MODULE`
- `SOFTONE_REFID`
- Optional: `SOFTONE_AUTHENTICATE_AFTER_LOGIN=true`

## Optional KV binding

Binding name: `SOFTONECACHE`

If bound, it stores SoftOne sessions and OAuth artifacts across requests. If not bound, Worker uses in-memory cache.

## Cloudflare setup

1. Deploy Worker.
2. In **Workers & Pages -> worker-mcp -> Settings -> Variables and Secrets**, set env vars.
3. (Optional) Create KV namespace and bind it as `SOFTONECACHE`.

KV create command:

```bash
npx wrangler kv namespace create SOFTONECACHE
```

## ChatGPT App Builder setup (OAuth)

In your custom app MCP server config:

- MCP Server URL: `https://worker-mcp.kkourentzes.workers.dev/mcp`
- Auth type: `OAuth`
- Authorization URL: `https://worker-mcp.kkourentzes.workers.dev/oauth/authorize`
- Token URL: `https://worker-mcp.kkourentzes.workers.dev/oauth/token`
- Client ID: value of `OAUTH_CLIENT_ID`
- Client Secret: value of `OAUTH_CLIENT_SECRET`
- Scopes: `mcp`

Notes:

- This is the mode your screenshot requires.
- The previous custom header-only approach is kept for backward compatibility but is not required for ChatGPT OAuth flow.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars
npm run dev
```

## Deploy

```bash
npm run deploy
```

## MCP examples (bearer)

### initialize

```bash
curl -i -X POST 'http://127.0.0.1:8787/mcp' \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer YOUR_ACCESS_TOKEN' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
```

### tools/list

```bash
curl -i -X POST 'http://127.0.0.1:8787/mcp' \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer YOUR_ACCESS_TOKEN' \
  --data '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

### tools/call getCustomer

```bash
curl -i -X POST 'http://127.0.0.1:8787/mcp' \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer YOUR_ACCESS_TOKEN' \
  --data '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"getCustomer","arguments":{"trdr":1000}}}'
```

## PowerShell smoke test

```powershell
pwsh -File .\scripts\check-worker.ps1 `
  -BaseUrl "https://worker-mcp.kkourentzes.workers.dev" `
  -McpSecret "YOUR_ACCESS_TOKEN" `
  -AuthMethod bearer `
  -Trdr 1000
```

## Important assumptions and TODO

- Assumption: SoftOne WS accepts JSON POST payloads as used here.
- Assumption: `selectorFields` request with `CUSTOMER/TRDR/RESULTFIELDS` is valid in your tenant.
- TODO: `searchCustomers` must be finished using a real tenant example for `getBrowserInfo/getBrowserData`.
