# SoftOne MCP Worker (Cloudflare)

A minimal remote MCP server that runs on Cloudflare Workers and connects OpenAI/Codex to SoftOne ERP through **SoftOne Web Services** only.

## Architecture

`OpenAI/Codex -> Cloudflare Worker MCP endpoint -> SoftOne Web Services`

This project intentionally avoids direct SQL/database access and keeps all ERP communication inside documented SoftOne WS patterns.

## Why SoftOne Web Services (not direct SQL)

- Keeps integration aligned with SoftOne supported interfaces.
- Avoids coupling to internal database schema.
- Enables clearer security boundaries and credential handling.
- Fits remote MCP tool patterns over HTTP.

## Current tool scope

Implemented tools:

1. `searchCustomers`
2. `getCustomer`

### `getCustomer` status

Implemented with documented `selectorFields` pattern for object/table `CUSTOMER`, key `TRDR`, and fields:

- `CODE`
- `NAME`
- `ADDRESS`
- `CITY`
- `COUNTRY`
- `AFM`

### `searchCustomers` status

Implemented as a **safe stub**.

- Assumption: customer search via `getBrowserInfo/getBrowserData` requires tenant specific browser/list setup.
- TODO: provide one working SoftOne example payload from your environment for CUSTOMER browsing/search to finalize this tool without inventing request shapes.

## Prerequisites

- Node.js 18+
- Cloudflare account
- Wrangler CLI (installed via dev dependency)
- Access to SoftOne Web Services endpoint and credentials

## Cloudflare setup

### 1) Install dependencies

```bash
npm install
```

### 2) Create KV namespace

```bash
npx wrangler kv namespace create SOFTONECACHE
```

Copy the returned namespace id and update `wrangler.toml`:

```jsonc
{
  "kv_namespaces": [
    {
      "binding": "SOFTONECACHE",
      "id": "YOUR_REAL_NAMESPACE_ID"
    }
  ]
}
```

### 3) Set required secrets / vars

Set sensitive values as secrets:

```bash
npx wrangler secret put MCP_SHARED_SECRET
npx wrangler secret put SOFTONE_PASSWORD
```

Set the rest as environment variables in Cloudflare dashboard or Wrangler config:

- `SOFTONE_URL`: SoftOne WS URL (JSON POST endpoint)
- `SOFTONE_USER`: SoftOne username
- `SOFTONE_APP_ID`: SoftOne application id
- `SOFTONE_COMPANY`: SoftOne company code/value
- `SOFTONE_BRANCH`: SoftOne branch code/value
- `SOFTONE_MODULE`: SoftOne module code/value
- `SOFTONE_REFID`: SoftOne ref id
- `MCP_SHARED_SECRET`: shared secret expected in `x-mcp-secret`

Optional:

- `SOFTONE_AUTHENTICATE_AFTER_LOGIN=true` to run an additional documented `authenticate` call after login for installations that require it.

## Local development

Create a local env file from the example:

```bash
cp .dev.vars.example .dev.vars
```

Then run:

```bash
npm run dev
```

## Deploy

```bash
npm run deploy
```


## CI / Cloudflare dashboard deployment notes


If you configure a Cloudflare build/deploy command manually, use:

```bash
npx wrangler deploy --config wrangler.toml
```

This forces Wrangler to load the Worker config and prevents framework auto-detection from treating the project like static assets.

If you deploy from a Cloudflare-hosted CI job (or any non-interactive runner), make sure deployment is token-based and not interactive login based.

### Recommended deploy command

```bash
npm ci && npm run deploy:ci
```

If your environment does not run `npm ci` first, `npx wrangler deploy --config wrangler.toml` may download Wrangler ad hoc and show warnings like "No lock file has been detected".

### Required CI environment variables

- `CLOUDFLARE_API_TOKEN`: API token with Workers Scripts edit permissions
- `CLOUDFLARE_ACCOUNT_ID`: target Cloudflare account id

Without these, Wrangler may wait for interactive auth/login behavior and deployment can appear stuck after startup logs.

### Optional noise reduction for CI logs

- `WRANGLER_SEND_METRICS=false`

This disables telemetry sending in CI and keeps logs quieter.

## Endpoints

- `GET /health`
- `POST /mcp`

## Security

`POST /mcp` requires header:

- `x-mcp-secret: <MCP_SHARED_SECRET>`

If missing or invalid, server returns `401`.

## MCP JSON-RPC examples

### initialize

```bash
curl -i -X POST 'http://127.0.0.1:8787/mcp' \
  -H 'content-type: application/json' \
  -H 'x-mcp-secret: YOUR_SECRET' \
  --data '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {}
  }'
```

### tools/list

```bash
curl -i -X POST 'http://127.0.0.1:8787/mcp' \
  -H 'content-type: application/json' \
  -H 'x-mcp-secret: YOUR_SECRET' \
  --data '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {}
  }'
```

### tools/call getCustomer

```bash
curl -i -X POST 'http://127.0.0.1:8787/mcp' \
  -H 'content-type: application/json' \
  -H 'x-mcp-secret: YOUR_SECRET' \
  --data '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "getCustomer",
      "arguments": { "trdr": 1000 }
    }
  }'
```

## SoftOne request notes

- `getCustomer` uses `selectorFields` with:
  - `TABLENAME: CUSTOMER`
  - `KEYNAME: TRDR`
  - `KEYVALUE: <trdr>`
  - `RESULTFIELDS: CODE,NAME,ADDRESS,CITY,COUNTRY,AFM`
- Session handling uses `login`, optional `authenticate`, and one retry on session-like failure.
- Search intentionally does **not** guess undocumented browser payload details.

## Project files

- `src/worker.js`: Worker runtime, MCP routing, tool handlers, SoftOne helpers.
- `wrangler.toml`: Cloudflare worker config and KV binding.
- `package.json`: minimal scripts/dependencies.
- `.dev.vars.example`: local environment template.
