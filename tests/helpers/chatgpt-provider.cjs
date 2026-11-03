// Local OAuth/OIDC server: real HTTP, PKCE and RSA-signed ID tokens; no OpenAI requests.
const http = require("node:http");
const crypto = require("node:crypto");
const { ISSUER, RESOURCE, SCOPES } = require("../../desktop/chatgpt-auth.cjs");

async function createChatGPTProvider() {
  const { generateKeyPair, exportJWK, SignJWT } = await import("jose");
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "local-key", alg: "RS256", use: "sig" };
  const codes = new Map(),
    refreshes = new Map(),
    calls = [];
  let registrations = 0;
  const settings = {
    subject: "local-user",
    identity: {},
    scopes: SCOPES,
    refreshStatus: 200,
    revokeStatus: 200,
    expiresIn: 3600,
  };
  async function authorize(value, { state, clientId, error } = {}) {
    const url = new URL(value),
      params = url.searchParams;
    const issued =
      params.get("client_id") === "dynamic_agent_client"
        ? `oaiapp_local_${++registrations}`
        : params.get("client_id");
    const code = crypto.randomUUID();
    codes.set(code, {
      clientId: issued,
      redirect: params.get("redirect_uri"),
      challenge: params.get("code_challenge"),
      nonce: params.get("nonce"),
    });
    const callback = new URL(params.get("redirect_uri"));
    callback.search = new URLSearchParams({
      code,
      state: state ?? params.get("state"),
      client_id: clientId ?? issued,
      ...(error ? { error } : {}),
    }).toString();
    return fetch(callback);
  }
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://fixture");
      let body = "";
      for await (const chunk of req) body += chunk;
      const params = new URLSearchParams(body);
      calls.push({ path: url.pathname, params });
      const json = (code, value) =>
        res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(value));
      if (url.pathname === "/test/authorize") {
        const response = await authorize(body);
        return json(response.status, {});
      }
      if (url.pathname === "/.well-known/openid-configuration")
        return json(200, {
          issuer: ISSUER,
          authorization_endpoint: ISSUER + "/api/accounts/authorize",
          token_endpoint: ISSUER + "/api/accounts/oauth/token",
          jwks_uri: ISSUER + "/.well-known/jwks.json",
          revocation_endpoint: ISSUER + "/api/accounts/oauth/revoke",
        });
      if (url.pathname === "/.well-known/jwks.json") return json(200, { keys: [jwk] });
      if (url.pathname === "/api/accounts/oauth/revoke") {
        if (settings.revokeStatus === 200) refreshes.delete(params.get("token"));
        return res.writeHead(settings.revokeStatus).end();
      }
      if (url.pathname !== "/api/accounts/oauth/token") return json(404, {});
      if (params.get("resource") !== RESOURCE) return json(400, { error: "invalid_target" });
      let registration;
      const refresh = params.get("grant_type") === "refresh_token";
      if (refresh) {
        if (settings.refreshStatus !== 200)
          return json(settings.refreshStatus, { error: "invalid_grant" });
        registration = refreshes.get(params.get("refresh_token"));
        if (!registration || registration.clientId !== params.get("client_id"))
          return json(400, { error: "invalid_grant" });
        refreshes.delete(params.get("refresh_token"));
      } else {
        registration = codes.get(params.get("code"));
        codes.delete(params.get("code"));
        const challenge = crypto
          .createHash("sha256")
          .update(params.get("code_verifier") || "")
          .digest("base64url");
        if (
          !registration ||
          registration.clientId !== params.get("client_id") ||
          registration.redirect !== params.get("redirect_uri") ||
          registration.challenge !== challenge
        )
          return json(400, { error: "invalid_grant" });
      }
      const refreshToken = crypto.randomUUID();
      refreshes.set(refreshToken, registration);
      const identity = {
        sub: settings.subject,
        email: "local@example.com",
        nonce: registration.nonce,
        ...settings.identity,
      };
      let idToken = await new SignJWT(identity)
        .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
        .setIssuer(settings.issuer || ISSUER)
        .setAudience(settings.audience || registration.clientId)
        .setIssuedAt()
        .setExpirationTime(settings.expired ? Math.floor(Date.now() / 1000) - 3600 : "1h")
        .sign(privateKey);
      if (settings.corrupt) {
        const parts = idToken.split(".");
        parts[2] = (parts[2][0] === "a" ? "b" : "a") + parts[2].slice(1);
        idToken = parts.join(".");
      }
      return json(200, {
        access_token: "local-access-" + crypto.randomUUID(),
        refresh_token: refreshToken,
        id_token: idToken,
        token_type: "Bearer",
        scope: settings.scopes,
        expires_in: settings.expiresIn,
      });
    } catch {
      res.writeHead(500).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    calls,
    settings,
    fetch: (url, options) => {
      const remote = new URL(url);
      if (remote.origin !== ISSUER) throw Error("Unexpected provider origin");
      return fetch(base + remote.pathname + remote.search, options);
    },
    authorize,
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  };
}
// Existing UI transcript tests use the Codex process fixture and a preauthorized
// local SIWC account, rather than inheriting the developer's terminal login.
async function seedChatGPTAccount(userData) {
  const fs = require("node:fs/promises");
  const path = require("node:path");
  const dir = path.join(userData, "chatgpt");
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.writeFile(
    path.join(dir, "account.json"),
    JSON.stringify({
      issuer: ISSUER,
      subject: "fixture-user",
      client_id: "oaiapp_fixture",
      email: "fixture@example.com",
      access_token: "fixture-access-token",
      refresh_token: "fixture-refresh-token",
      expires_at: Date.now() + 3600000,
      scopes: SCOPES.split(" "),
      welcomed: true,
    }),
    { mode: 0o600 },
  );
}

// Install the local provider's HTTP transport in the Electron main process.
// Sign-in still uses the real loopback callback, PKCE, JWT verification and store.
async function connectElectronProvider(app, provider) {
  await app.evaluate(({ shell, dialog }, base) => {
    const require = process
      .getBuiltinModule("module")
      .createRequire(process.cwd() + "/package.json");
    const { ChatGPTAuth, ISSUER } = require(process.cwd() + "/desktop/chatgpt-auth.cjs");
    ChatGPTAuth.prototype.request = async function (url, options = {}) {
      const remote = new URL(url);
      if (remote.origin !== ISSUER) throw Error("Unexpected sign-in origin");
      return fetch(base + remote.pathname + remote.search, options);
    };
    dialog.showMessageBox = async () => ({ response: 0 });
    shell.openExternal = async (value) => {
      if (new URL(value).origin !== ISSUER) throw Error("Unexpected browser origin");
      await fetch(base + "/test/authorize", { method: "POST", body: value });
    };
  }, provider.base);
}

module.exports = { createChatGPTProvider, seedChatGPTAccount, connectElectronProvider };
