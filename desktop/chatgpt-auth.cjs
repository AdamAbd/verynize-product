// SIWC public-client flow. Credentials never cross IPC or enter Codex's auth.json.
// https://developers.openai.com/siwc/token-sharing-open-source/sign-in
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");

const ISSUER = "https://auth.openai.com";
const RESOURCE = "https://api.openai.com/v1";
const SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const APP_NAME = "Verynize";
const AUTH_REQUIRED = "Continue with ChatGPT in Verynize to use your ChatGPT plan.";
const random = () => crypto.randomBytes(32).toString("base64url");
const authRequired = () => Object.assign(Error(AUTH_REQUIRED), { code: "SIWC_AUTH_REQUIRED" });

async function atomicWrite(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(value) + "\n", { mode: 0o600, flag: "wx" });
    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, { force: true });
  }
}
async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw Error("Unable to read the local ChatGPT account.");
  }
}
function providerArgs() {
  return Object.entries({
    model_provider: "openai_chatgpt_plan",
    "model_providers.openai_chatgpt_plan.name": "ChatGPT plan",
    "model_providers.openai_chatgpt_plan.base_url": RESOURCE,
    "model_providers.openai_chatgpt_plan.env_key": "VERYNIZE_CHATGPT_ACCESS_TOKEN",
    "model_providers.openai_chatgpt_plan.wire_api": "responses",
    "model_providers.openai_chatgpt_plan.requires_openai_auth": false,
    "model_providers.openai_chatgpt_plan.supports_websockets": false,
    // Hosted tool_search/computer-use are not supported by the SIWC route.
    "features.tool_search": false,
    "features.code_mode_tool_search": false,
    "features.image_generation": false,
    "features.apps": false,
    "features.computer_use": false,
  }).flatMap(([key, value]) => ["-c", `${key}=${JSON.stringify(value)}`]);
}

class ChatGPTAuth {
  constructor({
    userData,
    profiles,
    openExternal,
    notice = async () => true,
    welcome = async () => {},
    fetchImpl = fetch,
    now = Date.now,
  } = {}) {
    if (!userData || !profiles) throw Error("ChatGPT account storage is required");
    Object.assign(this, { userData, profiles, openExternal, notice, welcome, fetchImpl, now });
    this.root = path.join(userData, "chatgpt");
    this.pending = new Map();
    this.queues = new Map();
    this.loggingOut = new Set();
    this.registrations = new Map();
    this.hostPromise = null;
  }
  async file(slot = "system") {
    if (slot === "system") return path.join(this.root, "account.json");
    const profile = await this.profiles.find(slot);
    if (profile.agent !== "codex") throw Error("That account belongs to another agent");
    return path.join(this.profiles.dirOf(profile), "chatgpt.json");
  }
  // Also serialize rotating refresh tokens between separate desktop processes.
  serial(slot, fn) {
    const next = (this.queues.get(slot) || Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const file = await this.file(slot);
        await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
        const lock = file + ".lock";
        const deadline = Date.now() + 20000;
        for (;;) {
          try {
            await fs.mkdir(lock, { mode: 0o700 });
            break;
          } catch (error) {
            if (error.code !== "EEXIST") throw error;
            // A crashed process may leave its lock behind; network calls time out in 15 s.
            const stat = await fs.stat(lock).catch(() => null);
            if (stat && Date.now() - stat.mtimeMs > 120000) {
              await fs.rm(lock, { recursive: true, force: true });
              continue;
            }
            if (Date.now() > deadline)
              throw Error("Another ChatGPT account operation is running. Try again.");
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        }
        try {
          return await fn(file);
        } finally {
          await fs.rm(lock, { recursive: true, force: true });
        }
      });
    this.queues.set(slot, next);
    return next;
  }
  host() {
    if (!this.hostPromise)
      this.hostPromise = this.serial("system", async () => {
        const file = path.join(this.root, "host.json");
        let host = await readJson(file);
        if (!host) {
          host = { id: `urn:uuid:${crypto.randomUUID()}` };
          await atomicWrite(file, host);
        }
        return host.id;
      }).catch((error) => {
        this.hostPromise = null;
        throw error;
      });
    return this.hostPromise;
  }
  async request(url, options = {}) {
    try {
      return await this.fetchImpl(url, {
        ...options,
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw Error("Unable to reach OpenAI. Check your connection and try again.");
    }
  }
  async discovery() {
    if (!this.discoveryPromise)
      this.discoveryPromise = (async () => {
        const response = await this.request(`${ISSUER}/.well-known/openid-configuration`);
        if (!response.ok) throw Error("OpenAI sign-in configuration is unavailable.");
        let data;
        try {
          data = await response.json();
        } catch {
          throw Error("OpenAI returned an invalid sign-in response.");
        }
        if (data.issuer !== ISSUER) throw Error("Invalid OpenAI sign-in issuer.");
        for (const field of [
          "authorization_endpoint",
          "token_endpoint",
          "jwks_uri",
          "revocation_endpoint",
        ]) {
          const url = new URL(data[field]);
          if (url.origin !== ISSUER || url.username || url.password)
            throw Error("Invalid OpenAI sign-in endpoint.");
        }
        return data;
      })().catch((error) => {
        this.discoveryPromise = null;
        throw error;
      });
    return this.discoveryPromise;
  }
  async token(fields) {
    const config = await this.discovery();
    const response = await this.request(config.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...fields, resource: RESOURCE }),
    });
    if (!response.ok) {
      if (response.status === 400 || response.status === 401) throw authRequired();
      throw Error("OpenAI could not renew sign-in. Try again.");
    }
    let data;
    try {
      data = await response.json();
    } catch {
      throw Error("OpenAI returned an invalid sign-in response.");
    }
    if (
      typeof data.access_token !== "string" ||
      !data.access_token ||
      typeof data.refresh_token !== "string" ||
      !data.refresh_token ||
      data.token_type?.toLowerCase() !== "bearer" ||
      !Number.isFinite(data.expires_in) ||
      data.expires_in <= 0
    )
      throw Error("OpenAI returned an incomplete sign-in response.");
    return data;
  }
  async identity(token, clientId, nonce) {
    try {
      const jose = await import("jose");
      if (!this.jwks)
        this.jwks = jose.createRemoteJWKSet(new URL((await this.discovery()).jwks_uri), {
          [jose.customFetch]: (...args) => this.request(...args),
        });
      const { payload } = await jose.jwtVerify(token, this.jwks, {
        issuer: ISSUER,
        audience: clientId,
        algorithms: ["RS256"],
        requiredClaims: ["sub", "exp", "iat", "nonce"],
        clockTolerance: 5,
        currentDate: new Date(this.now()),
      });
      if (
        payload.nonce !== nonce ||
        typeof payload.sub !== "string" ||
        !payload.sub ||
        (payload.azp !== undefined && payload.azp !== clientId) ||
        (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId)
      )
        throw Error();
      return payload;
    } catch {
      throw Error("ChatGPT identity could not be verified. Please sign in again.");
    }
  }
  record(data, previous) {
    const scopes =
      typeof data.scope === "string" ? data.scope.split(/\s+/).filter(Boolean) : previous.scopes;
    if (!scopes?.includes("chatgpt.tokens.use.direct") || !scopes.includes("resource.invoke"))
      throw authRequired();
    return {
      ...previous,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      id_token: data.id_token || previous.id_token,
      scopes,
      expires_at: this.now() + data.expires_in * 1000,
      earliest_refresh_at: data.earliest_refresh_at,
      saved_at: new Date(this.now()).toISOString(),
    };
  }
  async status(slot = "system") {
    const record = await readJson(await this.file(slot));
    return {
      loggedIn: !this.loggingOut.has(slot) && !!(record?.access_token && record?.refresh_token),
      method: record?.access_token ? "Sign in with ChatGPT" : "signed out",
      email: record?.email || "",
      plan: record?.access_token ? "ChatGPT plan" : "",
      ...(record?.client_id ? { registration: record.client_id } : {}),
    };
  }
  async credentials(slot = "system") {
    return this.serial(slot, async (file) => {
      if (this.loggingOut.has(slot)) throw authRequired();
      const previous = await readJson(file);
      if (!previous?.access_token || !previous.refresh_token) throw authRequired();
      if (previous.expires_at > this.now() + 120000) return previous;
      try {
        const data = await this.token({
          grant_type: "refresh_token",
          client_id: previous.client_id,
          refresh_token: previous.refresh_token,
        });
        const record = this.record(data, previous);
        await atomicWrite(file, record);
        return record;
      } catch (error) {
        if (error.code === "SIWC_AUTH_REQUIRED") {
          const {
            access_token: _accessToken,
            refresh_token: _refreshToken,
            id_token: _idToken,
            ...mapping
          } = previous;
          await atomicWrite(file, mapping);
        }
        throw error;
      }
    });
  }
  async runtime(slot = "system") {
    const record = await this.credentials(slot);
    return {
      args: providerArgs(),
      env: { VERYNIZE_CHATGPT_ACCESS_TOKEN: record.access_token },
      expiresAt: record.expires_at,
    };
  }
  async login(slot = "system", emit = () => {}) {
    if (this.loggingOut.has(slot))
      throw Error("Another ChatGPT account operation is running. Try again.");
    if (this.pending.has(slot))
      throw Error("A ChatGPT sign-in is already running for this account.");
    const id = crypto.randomUUID();
    const abort = new AbortController();
    const attempt = { id, cancel: () => abort.abort() };
    this.pending.set(slot, attempt);
    const event = (type, message) =>
      emit({ id, agent: "codex", ...(slot !== "system" ? { profile: slot } : {}), type, message });
    // Start asynchronously so the renderer can retain the attempt ID for cancellation.
    setImmediate(async () => {
      let server, timer;
      try {
        event("started", "Starting Sign in with ChatGPT.");
        const file = await this.file(slot);
        const previous = (await readJson(file)) || this.registrations.get(slot) || {};
        if (!(await this.notice())) {
          abort.abort();
          throw Error();
        }
        if (abort.signal.aborted) throw Error();
        const hostId = await this.host();
        const config = await this.discovery();
        const state = random(),
          nonce = random(),
          verifier = random();
        let redirectUri,
          consumed = false;
        const callback = new Promise((resolve, reject) => {
          server = http.createServer((req, res) => {
            const reply = (code, message) =>
              res
                .writeHead(code, {
                  "content-type": "text/plain; charset=utf-8",
                  "cache-control": "no-store",
                  connection: "close",
                  "x-content-type-options": "nosniff",
                })
                .end(message);
            let url;
            try {
              url = new URL(req.url, redirectUri);
            } catch {
              reply(400, "Invalid sign-in request.");
              return;
            }
            if (req.method !== "GET" || url.pathname !== "/auth/callback") {
              reply(404, "Not found");
              return;
            }
            if (
              url.searchParams.getAll("state").length !== 1 ||
              url.searchParams.get("state") !== state ||
              consumed
            ) {
              reply(400, "Invalid sign-in request.");
              return;
            }
            consumed = true;
            if (url.searchParams.has("error")) {
              reply(400, "ChatGPT sign-in was not authorized. Return to Verynize.");
              reject(Error("ChatGPT sign-in was not authorized."));
              return;
            }
            const clientId = url.searchParams.get("client_id") || previous.client_id;
            if (
              !clientId ||
              clientId === "dynamic_agent_client" ||
              clientId.length > 300 ||
              (previous.client_id && clientId !== previous.client_id) ||
              url.searchParams.getAll("code").length !== 1 ||
              !url.searchParams.get("code") ||
              url.searchParams.getAll("client_id").length > 1
            ) {
              reply(400, "Incomplete ChatGPT registration. Return to Verynize.");
              reject(Error("ChatGPT registration did not match this account."));
              return;
            }
            reply(200, "Completing ChatGPT sign-in. You can return to Verynize.");
            resolve({ code: url.searchParams.get("code"), clientId });
          });
          server.on("error", () => reject(Error("Unable to open the local sign-in callback.")));
          abort.signal.addEventListener("abort", () => reject(Error("Sign-in canceled.")), {
            once: true,
          });
          timer = setTimeout(() => reject(Error("ChatGPT sign-in timed out. Try again.")), 300000);
        });
        // Install a rejection handler before discovery/browser operations can fail.
        callback.catch(() => {});
        await new Promise((resolve, reject) => {
          server.once("error", reject);
          server.listen(0, "127.0.0.1", resolve);
        });
        redirectUri = `http://127.0.0.1:${server.address().port}/auth/callback`;
        const url = new URL(config.authorization_endpoint);
        const params = {
          client_id: previous.client_id || "dynamic_agent_client",
          ext_agent_host_id: hostId,
          response_type: "code",
          redirect_uri: redirectUri,
          scope: SCOPES,
          resource: RESOURCE,
          state,
          nonce,
          code_challenge_method: "S256",
          code_challenge: crypto.createHash("sha256").update(verifier).digest("base64url"),
        };
        if (!previous.client_id) params.agent_name_hint = APP_NAME;
        if (previous.id_token) params.id_token_hint = previous.id_token;
        if (previous.email) params.login_hint = previous.email;
        url.search = new URLSearchParams(params).toString();
        if (abort.signal.aborted) throw Error();
        await this.openExternal(url.toString());
        event("waiting", "Complete Continue with ChatGPT in your browser.");
        const result = await callback;
        if (!previous.subject) this.registrations.set(slot, { client_id: result.clientId });
        server.close();
        clearTimeout(timer);
        const data = await this.token({
          grant_type: "authorization_code",
          client_id: result.clientId,
          code: result.code,
          code_verifier: verifier,
          redirect_uri: redirectUri,
        });
        const identity = await this.identity(data.id_token, result.clientId, nonce);
        if (
          previous.subject &&
          (identity.sub !== previous.subject || identity.iss !== previous.issuer)
        )
          throw Error(
            "Choose the ChatGPT account originally connected to this registration. Add a separate account to switch.",
          );
        if (abort.signal.aborted) throw Error();
        await this.serial(slot, async (target) => {
          // A profile removed during sign-in must not be recreated.
          if (abort.signal.aborted) throw Error();
          await atomicWrite(
            target,
            this.record(data, {
              ...previous,
              client_id: result.clientId,
              subject: identity.sub,
              issuer: identity.iss,
              email: typeof identity.email === "string" ? identity.email : "",
              ext_agent_host_id: hostId,
            }),
          );
        });
        this.registrations.delete(slot);
        if (!previous.welcomed) {
          await this.welcome();
          await this.serial(slot, async (target) => {
            const saved = await readJson(target);
            if (saved?.access_token) await atomicWrite(target, { ...saved, welcomed: true });
          });
        }
        if (abort.signal.aborted) throw Error();
        event("complete", "Connected to ChatGPT. Eligible requests use your ChatGPT plan.");
      } catch (error) {
        event(
          abort.signal.aborted ? "canceled" : "error",
          abort.signal.aborted
            ? "ChatGPT sign-in canceled."
            : error.code === "SIWC_AUTH_REQUIRED"
              ? AUTH_REQUIRED
              : this.safeError(error),
        );
      } finally {
        clearTimeout(timer);
        server?.close();
        server?.closeAllConnections();
        this.pending.delete(slot);
      }
    });
    return { id, agent: "codex", ...(slot !== "system" ? { profile: slot } : {}) };
  }
  safeError(error) {
    // All network/JOSE errors are replaced above; don't expose arbitrary library diagnostics.
    const message = error?.message || "";
    return /^(ChatGPT |Choose the ChatGPT |OpenAI |Unable to |Another ChatGPT |Invalid OpenAI )/.test(
      message,
    ) && message.length < 240
      ? message
      : "ChatGPT sign-in failed. Please try again.";
  }
  cancel(id) {
    for (const attempt of this.pending.values())
      if (attempt.id === id) {
        attempt.cancel();
        return { canceled: true };
      }
    return { canceled: false };
  }
  async logout(slot = "system") {
    this.pending.get(slot)?.cancel();
    this.registrations.delete(slot);
    this.loggingOut.add(slot);
    return this.serial(slot, async (file) => {
      const record = await readJson(file);
      let revoked = !record?.refresh_token;
      try {
        if (record?.refresh_token) {
          const config = await this.discovery();
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const response = await this.request(config.revocation_endpoint, {
                method: "POST",
                headers: { "content-type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                  token: record.refresh_token,
                  token_type_hint: "refresh_token",
                  client_id: record.client_id,
                }),
              });
              revoked = response.status === 200;
              if (revoked || response.status < 500) break;
            } catch {}
            if (!attempt) await new Promise((resolve) => setTimeout(resolve, 250));
          }
        }
      } catch {
      } finally {
        if (record) {
          const {
            access_token: _accessToken,
            refresh_token: _refreshToken,
            id_token: _idToken,
            ...mapping
          } = record;
          await atomicWrite(file, mapping);
        }
      }
      return {
        loggedOut: true,
        revoked,
        message: revoked
          ? "Signed out of ChatGPT."
          : "Signed out locally. Remote revocation was not confirmed; disconnect Verynize in ChatGPT Settings → Usage.",
      };
    }).finally(() => this.loggingOut.delete(slot));
  }
}

module.exports = { ChatGPTAuth, providerArgs, ISSUER, RESOURCE, SCOPES, APP_NAME, AUTH_REQUIRED };
