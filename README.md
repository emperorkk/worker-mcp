# SoftOne MCP Worker (Cloudflare)

Cloudflare Worker that exposes a remote MCP server for OpenAI/ChatGPT and connects to SoftOne ERP only through documented SoftOne Web Services.

## Architecture

`ChatGPT/Codex -> Cloudflare Worker MCP -> SoftOne WS`

## Endpoints

- `GET /health`
- `POST /mcp`

## Tools

- `getCustomer` (implemented with `selectorFields`)
- `searchCustomers` (safe stub until tenant browser payload is provided)

## Authentication

This worker does **not** require authentication for MCP calls. `POST /mcp` is open by design.

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

If bound, it stores SoftOne sessions across requests. If not bound, Worker uses in-memory cache.

## Cloudflare setup

1. Deploy Worker.
2. In **Workers & Pages -> worker-mcp -> Settings -> Variables and Secrets**, set env vars.
3. (Optional) Create KV namespace and bind it as `SOFTONECACHE`.

KV create command:

```bash
npx wrangler kv namespace create SOFTONECACHE
```

## ChatGPT App Builder setup

In your custom app MCP server config:

- MCP Server URL: `https://worker-mcp.kkourentzes.workers.dev/mcp`
- Auth type: `None`

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

## MCP examples (no auth)

### initialize

```bash
curl -i -X POST 'http://127.0.0.1:8787/mcp' \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
```

### tools/list

```bash
curl -i -X POST 'http://127.0.0.1:8787/mcp' \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

### tools/call getCustomer

```bash
curl -i -X POST 'http://127.0.0.1:8787/mcp' \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"getCustomer","arguments":{"trdr":1000}}}'
```

## PowerShell smoke test

```powershell
pwsh -File .\scripts\check-worker.ps1 `
  -BaseUrl "https://worker-mcp.kkourentzes.workers.dev" `
  -Trdr 1000
```

## Important assumptions and TODO

- Assumption: SoftOne WS accepts JSON POST payloads as used here.
- Assumption: `selectorFields` request with `CUSTOMER/TRDR/RESULTFIELDS` is valid in your tenant.
- TODO: `searchCustomers` must be finished using a real tenant example for `getBrowserInfo/getBrowserData`.
