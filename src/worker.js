const softoneSessionKey = "softone-session";
const memoryCache = new Map();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse(200, { status: "ok", service: "worker-mcp" });
    }

    if (request.method === "GET" && url.pathname === "/.well-known/oauth-authorization-server") {
      return handleOauthMetadata(request, env);
    }

    if (request.method === "GET" && url.pathname === "/oauth/authorize") {
      return handleOauthAuthorize(request, env);
    }

    if (request.method === "POST" && url.pathname === "/oauth/token") {
      return handleOauthToken(request, env);
    }

    if (request.method === "POST" && url.pathname === "/oauth/revoke") {
      return handleOauthRevoke(request, env);
    }

    if (request.method === "POST" && url.pathname === "/mcp") {
      if (!(await isAuthorized(request, env))) {
        return jsonRpcErrorResponse(null, -32001, "Unauthorized", 401);
      }
      return handleMcpRequest(request, env);
    }

    return jsonResponse(404, { error: "Not found" });
  }
};

async function isAuthorized(request, env) {
  const authMode = (env.MCP_AUTH_MODE || "oauth").toLowerCase();
  if (authMode === "none") {
    return true;
  }

  const headerToken = request.headers.get("x-mcp-secret");
  const bearerToken = readBearerToken(request.headers.get("authorization"));
  const legacySecret = env.MCP_SHARED_SECRET;
  const staticBearerToken = env.MCP_BEARER_TOKEN || env.MCP_SHARED_SECRET;

  const headerIsValid = Boolean(legacySecret) && headerToken === legacySecret;
  const staticBearerIsValid = Boolean(staticBearerToken) && bearerToken === staticBearerToken;
  const oauthBearerIsValid = bearerToken ? await isValidOauthToken(env, bearerToken) : false;

  if (authMode === "header") {
    return headerIsValid;
  }
  if (authMode === "bearer") {
    return staticBearerIsValid;
  }
  if (authMode === "oauth") {
    return oauthBearerIsValid;
  }

  return headerIsValid || staticBearerIsValid || oauthBearerIsValid;
}

function readBearerToken(authorizationHeader) {
  if (!authorizationHeader || typeof authorizationHeader !== "string") {
    return null;
  }
  if (!authorizationHeader.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  return authorizationHeader.slice(7).trim();
}

async function handleMcpRequest(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonRpcErrorResponse(null, -32700, "Parse error", 400);
  }

  if (!body || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return jsonRpcErrorResponse(body?.id ?? null, -32600, "Invalid Request", 400);
  }

  const requestId = body.id ?? null;

  if (body.method === "initialize") {
    return jsonRpcResultResponse(requestId, {
      protocolVersion: "2024-11-05",
      serverInfo: { name: "worker-mcp", version: "0.2.0" },
      capabilities: { tools: {} }
    });
  }

  if (body.method === "tools/list") {
    return jsonRpcResultResponse(requestId, { tools: getToolDefinitions() });
  }

  if (body.method === "tools/call") {
    return handleToolsCall(requestId, body.params, env);
  }

  return jsonRpcErrorResponse(requestId, -32601, "Method not found", 404);
}

function getToolDefinitions() {
  return [
    {
      name: "searchCustomers",
      description: "Search customers by code, name, or AFM using SoftOne browser/list APIs.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", minLength: 1, description: "Search text for CODE, NAME, or AFM" }
        },
        required: ["query"],
        additionalProperties: false
      }
    },
    {
      name: "getCustomer",
      description: "Fetch one customer by TRDR id and return core fields",
      inputSchema: {
        type: "object",
        properties: { trdr: { type: "number", description: "SoftOne TRDR id" } },
        required: ["trdr"],
        additionalProperties: false
      }
    }
  ];
}

async function handleToolsCall(requestId, params, env) {
  const toolName = params?.name;
  const toolArguments = params?.arguments || {};

  if (!toolName) {
    return jsonRpcErrorResponse(requestId, -32602, "Missing tool name", 400);
  }

  try {
    if (toolName === "searchCustomers") {
      return jsonRpcResultResponse(requestId, {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "needs_softone_browser_config",
                message: "Provide a working getBrowserInfo/getBrowserData example for CUSTOMER to complete this tool.",
                assumption: "Customer search needs tenant-specific browser/list configuration that is not safely inferable from generic docs.",
                todo: "Implement this tool using documented getBrowserInfo + getBrowserData payloads from your SoftOne environment."
              },
              null,
              2
            )
          }
        ],
        isError: false
      });
    }

    if (toolName === "getCustomer") {
      const trdr = Number(toolArguments.trdr);
      if (!Number.isFinite(trdr) || trdr <= 0) {
        return jsonRpcErrorResponse(requestId, -32602, "Invalid trdr argument", 400);
      }

      const customer = await fetchCustomerByTrdr(env, trdr);
      if (!customer) {
        return jsonRpcResultResponse(requestId, {
          content: [{ type: "text", text: JSON.stringify({ status: "not_found", trdr }, null, 2) }],
          isError: false
        });
      }

      return jsonRpcResultResponse(requestId, {
        content: [{ type: "text", text: JSON.stringify(customer, null, 2) }],
        isError: false
      });
    }

    return jsonRpcErrorResponse(requestId, -32601, `Unknown tool: ${toolName}`, 404);
  } catch (error) {
    return jsonRpcResultResponse(requestId, {
      content: [
        {
          type: "text",
          text: JSON.stringify({ status: "error", message: "Tool execution failed", details: safeErrorMessage(error) }, null, 2)
        }
      ],
      isError: true
    });
  }
}

async function fetchCustomerByTrdr(env, trdr) {
  const payload = {
    service: "selectorFields",
    clientID: await getValidClientId(env),
    appId: env.SOFTONE_APP_ID,
    COMPANY: env.SOFTONE_COMPANY,
    BRANCH: env.SOFTONE_BRANCH,
    MODULE: env.SOFTONE_MODULE,
    REFID: env.SOFTONE_REFID,
    OBJECT: "CUSTOMER",
    FORM: "CUSTOMER",
    TABLENAME: "CUSTOMER",
    KEYNAME: "TRDR",
    KEYVALUE: trdr,
    RESULTFIELDS: "CODE,NAME,ADDRESS,CITY,COUNTRY,AFM"
  };

  let response = await softonePost(env, payload);
  if (looksLikeSessionError(response)) {
    payload.clientID = await loginAndCacheClientId(env, true);
    response = await softonePost(env, payload);
  }

  const row = pickFirstCustomerRow(response);
  if (!row) {
    return null;
  }

  return {
    CODE: row.CODE ?? "",
    NAME: row.NAME ?? "",
    ADDRESS: row.ADDRESS ?? "",
    CITY: row.CITY ?? "",
    COUNTRY: row.COUNTRY ?? "",
    AFM: row.AFM ?? ""
  };
}

function pickFirstCustomerRow(response) {
  if (!response || typeof response !== "object") {
    return null;
  }

  const candidates = [response.result, response.rows, response.data, response.Result, response.Rows, response.Data];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      return candidate[0];
    }
    if (candidate && typeof candidate === "object") {
      if (Array.isArray(candidate.rows) && candidate.rows.length > 0) {
        return candidate.rows[0];
      }
      if (Array.isArray(candidate.data) && candidate.data.length > 0) {
        return candidate.data[0];
      }
      if (Array.isArray(candidate.result) && candidate.result.length > 0) {
        return candidate.result[0];
      }
    }
  }

  return null;
}

async function getValidClientId(env) {
  const cache = getCacheStore(env);
  const clientId = await cache.getText(softoneSessionKey);
  if (clientId) {
    return clientId;
  }
  return loginAndCacheClientId(env, false);
}

async function loginAndCacheClientId(env, forceRefresh) {
  const cache = getCacheStore(env);
  if (forceRefresh) {
    await cache.delete(softoneSessionKey);
  }

  const loginResponse = await softonePost(env, {
    service: "login",
    username: env.SOFTONE_USER,
    password: env.SOFTONE_PASSWORD,
    appId: env.SOFTONE_APP_ID,
    COMPANY: env.SOFTONE_COMPANY,
    BRANCH: env.SOFTONE_BRANCH,
    MODULE: env.SOFTONE_MODULE,
    REFID: env.SOFTONE_REFID
  });

  const clientId = extractClientId(loginResponse);
  if (!clientId) {
    throw new Error("Unable to establish SoftOne session");
  }

  await cache.putText(softoneSessionKey, clientId, 60 * 30);

  if ((env.SOFTONE_AUTHENTICATE_AFTER_LOGIN || "false").toLowerCase() === "true") {
    // Assumption: Some installations require authenticate after login.
    await softonePost(env, {
      service: "authenticate",
      clientID: clientId,
      appId: env.SOFTONE_APP_ID
    });
  }

  return clientId;
}

function extractClientId(response) {
  if (!response || typeof response !== "object") {
    return null;
  }

  const directCandidates = [response.clientID, response.clientId, response.CLIENTID, response.sid, response.SID, response.session, response.SESSION];
  for (const value of directCandidates) {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  if (response.result && typeof response.result === "object") {
    const nestedCandidates = [response.result.clientID, response.result.clientId, response.result.CLIENTID, response.result.sid, response.result.SID];
    for (const value of nestedCandidates) {
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    }
  }

  return null;
}

function looksLikeSessionError(response) {
  if (!response || typeof response !== "object") {
    return false;
  }
  const errorText = [response.error, response.message, response.Error, response.Message].filter(Boolean).join(" ").toLowerCase();
  return ["session", "client", "authenticate", "login", "expired"].some((word) => errorText.includes(word));
}

async function softonePost(env, payload) {
  validateSoftoneConfig(env);

  const response = await fetch(env.SOFTONE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  const bodyText = await response.text();
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    throw new Error(`SoftOne returned non-JSON response with status ${response.status}`);
  }

  if (!response.ok) {
    throw new Error(`SoftOne HTTP error ${response.status}`);
  }

  return body;
}

function validateSoftoneConfig(env) {
  const requiredKeys = ["SOFTONE_URL", "SOFTONE_USER", "SOFTONE_PASSWORD", "SOFTONE_APP_ID", "SOFTONE_COMPANY", "SOFTONE_BRANCH", "SOFTONE_MODULE", "SOFTONE_REFID"];
  for (const key of requiredKeys) {
    if (!env[key]) {
      throw new Error(`Missing environment variable: ${key}`);
    }
  }
}

async function handleOauthMetadata(request, env) {
  const url = new URL(request.url);
  const baseUrl = getOauthIssuer(env, url);

  return jsonResponse(200, {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    code_challenge_methods_supported: ["S256", "plain"],
    scopes_supported: ["mcp"],
    revocation_endpoint: `${baseUrl}/oauth/revoke`
  });
}

async function handleOauthAuthorize(request, env) {
  const url = new URL(request.url);
  const responseType = url.searchParams.get("response_type");
  const clientId = url.searchParams.get("client_id");
  const redirectUri = url.searchParams.get("redirect_uri");
  const state = url.searchParams.get("state") || "";
  const scope = url.searchParams.get("scope") || "mcp";
  const codeChallenge = url.searchParams.get("code_challenge");
  const codeChallengeMethod = (url.searchParams.get("code_challenge_method") || "plain").toUpperCase();

  if (responseType !== "code" || !clientId || !redirectUri || !codeChallenge) {
    return jsonResponse(400, { error: "invalid_request", error_description: "Missing or invalid OAuth authorize parameters" });
  }

  if (env.OAUTH_CLIENT_ID && clientId !== env.OAUTH_CLIENT_ID) {
    return jsonResponse(401, { error: "unauthorized_client" });
  }

  const code = randomToken(32);
  const cache = getCacheStore(env);
  const record = {
    clientId,
    redirectUri,
    scope,
    codeChallenge,
    codeChallengeMethod,
    expiresAt: Date.now() + 5 * 60 * 1000
  };
  await cache.putJson(`oauth-code:${code}`, record, 5 * 60);

  const redirect = new URL(redirectUri);
  redirect.searchParams.set("code", code);
  if (state) {
    redirect.searchParams.set("state", state);
  }

  return Response.redirect(redirect.toString(), 302);
}

function getOauthClientSecret(env) {
  return env.OAUTH_CLIENT_SECRET || "softone";
}

async function handleOauthToken(request, env) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/x-www-form-urlencoded")) {
    return jsonResponse(400, { error: "invalid_request", error_description: "Token endpoint expects application/x-www-form-urlencoded" });
  }

  const form = await request.formData();
  const grantType = String(form.get("grant_type") || "");
  const code = String(form.get("code") || "");
  const redirectUri = String(form.get("redirect_uri") || "");
  const codeVerifier = String(form.get("code_verifier") || "");
  const refreshToken = String(form.get("refresh_token") || "");

  const { clientId, clientSecret } = readClientCredentials(request, form);
  if (env.OAUTH_CLIENT_ID && clientId && clientId !== env.OAUTH_CLIENT_ID) {
    return jsonResponse(401, { error: "invalid_client" });
  }
  const configuredClientSecret = getOauthClientSecret(env);
  if (clientSecret !== configuredClientSecret) {
    return jsonResponse(401, { error: "invalid_client" });
  }

  const cache = getCacheStore(env);

  if (grantType === "authorization_code") {
    if (!code || !redirectUri || !codeVerifier) {
      return jsonResponse(400, { error: "invalid_request" });
    }

    const codeRecord = await cache.getJson(`oauth-code:${code}`);
    if (!codeRecord || codeRecord.expiresAt < Date.now()) {
      return jsonResponse(400, { error: "invalid_grant" });
    }

    if (codeRecord.redirectUri !== redirectUri) {
      return jsonResponse(400, { error: "invalid_grant" });
    }

    if (!(await verifyCodeChallenge(codeVerifier, codeRecord.codeChallenge, codeRecord.codeChallengeMethod))) {
      return jsonResponse(400, { error: "invalid_grant" });
    }

    await cache.delete(`oauth-code:${code}`);

    const issuedAccessToken = randomToken(48);
    const issuedRefreshToken = randomToken(48);
    const expiresIn = 3600;
    await cache.putJson(`oauth-token:${issuedAccessToken}`, { scope: codeRecord.scope, expiresAt: Date.now() + expiresIn * 1000 }, expiresIn);
    await cache.putJson(`oauth-refresh:${issuedRefreshToken}`, { scope: codeRecord.scope }, 60 * 60 * 24 * 30);

    return jsonResponse(200, {
      token_type: "Bearer",
      access_token: issuedAccessToken,
      expires_in: expiresIn,
      refresh_token: issuedRefreshToken,
      scope: codeRecord.scope
    });
  }

  if (grantType === "refresh_token") {
    if (!refreshToken) {
      return jsonResponse(400, { error: "invalid_request" });
    }

    const refreshRecord = await cache.getJson(`oauth-refresh:${refreshToken}`);
    if (!refreshRecord) {
      return jsonResponse(400, { error: "invalid_grant" });
    }

    const newAccessToken = randomToken(48);
    const expiresIn = 3600;
    await cache.putJson(`oauth-token:${newAccessToken}`, { scope: refreshRecord.scope, expiresAt: Date.now() + expiresIn * 1000 }, expiresIn);

    return jsonResponse(200, {
      token_type: "Bearer",
      access_token: newAccessToken,
      expires_in: expiresIn,
      refresh_token: refreshToken,
      scope: refreshRecord.scope
    });
  }

  return jsonResponse(400, { error: "unsupported_grant_type" });
}


async function handleOauthRevoke(request, env) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/x-www-form-urlencoded")) {
    return new Response("", { status: 200 });
  }

  const form = await request.formData();
  const token = String(form.get("token") || "");
  if (token) {
    const cache = getCacheStore(env);
    await cache.delete(`oauth-token:${token}`);
    await cache.delete(`oauth-refresh:${token}`);
  }

  return new Response("", { status: 200 });
}

async function isValidOauthToken(env, token) {
  const record = await getCacheStore(env).getJson(`oauth-token:${token}`);
  if (!record || !record.expiresAt) {
    return false;
  }
  return record.expiresAt > Date.now();
}

function readClientCredentials(request, form) {
  const basic = request.headers.get("authorization");
  if (basic && basic.toLowerCase().startsWith("basic ")) {
    try {
      const decoded = atob(basic.slice(6));
      const parts = decoded.split(":");
      return { clientId: parts[0] || "", clientSecret: parts.slice(1).join(":") || "" };
    } catch {
      return { clientId: "", clientSecret: "" };
    }
  }

  return {
    clientId: String(form.get("client_id") || ""),
    clientSecret: String(form.get("client_secret") || "")
  };
}

async function verifyCodeChallenge(codeVerifier, expectedChallenge, method) {
  if (method === "PLAIN") {
    return codeVerifier === expectedChallenge;
  }

  if (method !== "S256") {
    return false;
  }

  return (await sha256Base64Url(codeVerifier)) === expectedChallenge;
}

async function sha256Base64Url(input) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomToken(byteCount) {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

function getOauthIssuer(env, url) {
  return (env.OAUTH_ISSUER_URL || `${url.protocol}//${url.host}`).replace(/\/$/, "");
}

function getCacheStore(env) {
  const kv = env.SOFTONECACHE;
  if (kv && typeof kv.get === "function" && typeof kv.put === "function" && typeof kv.delete === "function") {
    return {
      async getText(key) {
        return kv.get(key);
      },
      async putText(key, value, ttlSeconds) {
        await kv.put(key, value, ttlSeconds ? { expirationTtl: ttlSeconds } : undefined);
      },
      async getJson(key) {
        const text = await kv.get(key);
        if (!text) {
          return null;
        }
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      },
      async putJson(key, value, ttlSeconds) {
        await kv.put(key, JSON.stringify(value), ttlSeconds ? { expirationTtl: ttlSeconds } : undefined);
      },
      async delete(key) {
        await kv.delete(key);
      }
    };
  }

  return {
    async getText(key) {
      const entry = memoryCache.get(key);
      if (!entry || isExpired(entry.expiresAt)) {
        memoryCache.delete(key);
        return null;
      }
      return typeof entry.value === "string" ? entry.value : null;
    },
    async putText(key, value, ttlSeconds) {
      memoryCache.set(key, { value, expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null });
    },
    async getJson(key) {
      const entry = memoryCache.get(key);
      if (!entry || isExpired(entry.expiresAt)) {
        memoryCache.delete(key);
        return null;
      }
      return typeof entry.value === "object" ? entry.value : null;
    },
    async putJson(key, value, ttlSeconds) {
      memoryCache.set(key, { value, expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null });
    },
    async delete(key) {
      memoryCache.delete(key);
    }
  };
}

function isExpired(expiresAt) {
  return typeof expiresAt === "number" && expiresAt < Date.now();
}

function jsonRpcResultResponse(id, result) {
  return jsonResponse(200, { jsonrpc: "2.0", id, result });
}

function jsonRpcErrorResponse(id, code, message, httpStatus) {
  return jsonResponse(httpStatus || 500, {
    jsonrpc: "2.0",
    id,
    error: { code, message }
  });
}

function jsonResponse(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function safeErrorMessage(error) {
  if (!error) {
    return "Unknown error";
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
