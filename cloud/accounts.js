// Account directory: one SQLite Durable Object holding accounts, magic-link sign-in,
// hashed sessions, public creator profiles, the room membership index and published apps.
import { DurableObject } from "cloudflare:workers";
import { randomHex, digestHex, rpcFail, sameDigest } from "./http.js";
import { sendMail } from "./mail.js";
import { ALGORITHMS, toBase64url, verifyRegistration, verifyAssertion } from "./webauthn.js";

const LINK_TTL = 15 * 60 * 1000;
const PASSKEY_TTL = 10 * 60 * 1000;
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;
const RESERVED = new Set([
  "api",
  "apps",
  "admin",
  "u",
  "public",
  "verynize",
  "support",
  "help",
  "settings",
  "login",
  "signin",
]);
export const EMAIL = /^[^\s@<>()",;:]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/;
export const HANDLE = /^[a-z0-9][a-z0-9-]{2,29}$/;
export const APP_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const SESSION = /^vs_[0-9a-f]{64}$/;

const normalizeEmail = (value) => {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (email.length > 254 || !EMAIL.test(email)) rpcFail(400, "Enter a valid email address");
  return email;
};
const publicAccount = (row) =>
  row && {
    id: row.id,
    email: row.email,
    handle: row.handle,
    displayName: row.display_name,
    avatarUrl: row.avatar_url || "",
    createdAt: row.created_at,
  };

export class AccountDirectory extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, handle TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, avatar_url TEXT, created_at INTEGER NOT NULL, verified INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS sign_in_links (hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, label TEXT);
      CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account_id);
      CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, recipient TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, link TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS memberships (account_id TEXT NOT NULL, room_id TEXT NOT NULL, role TEXT NOT NULL, title TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY (account_id, room_id));
      CREATE TABLE IF NOT EXISTS publications (kind TEXT NOT NULL, ref TEXT NOT NULL, account_id TEXT NOT NULL, title TEXT NOT NULL, path TEXT NOT NULL, published_at INTEGER NOT NULL, PRIMARY KEY (kind, ref));
      CREATE TABLE IF NOT EXISTS passkeys (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, alg INTEGER NOT NULL, jwk TEXT NOT NULL, sign_count INTEGER NOT NULL, label TEXT, created_at INTEGER NOT NULL, last_used_at INTEGER);
      CREATE INDEX IF NOT EXISTS passkeys_account ON passkeys(account_id);
      CREATE TABLE IF NOT EXISTS passkey_challenges (challenge TEXT PRIMARY KEY, kind TEXT NOT NULL, account_id TEXT, handoff_id TEXT, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS passkey_tickets (hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS handoffs (id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL, account_id TEXT, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS apps (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, name TEXT NOT NULL, title TEXT NOT NULL, active_version INTEGER, created_at INTEGER NOT NULL, UNIQUE (account_id, name));
    `);
  }

  account(id) {
    return this.sql.exec("SELECT * FROM accounts WHERE id=?", id).toArray()[0] || null;
  }
  accountByEmail(email) {
    return this.sql.exec("SELECT * FROM accounts WHERE email=?", email).toArray()[0] || null;
  }
  accountByHandle(handle) {
    return this.sql.exec("SELECT * FROM accounts WHERE handle=?", handle).toArray()[0] || null;
  }

  freeHandle(email) {
    let base = email
      .split("@")[0]
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 20);
    if (base.length < 3 || RESERVED.has(base)) base = "designer";
    let handle = base;
    while (this.accountByHandle(handle)) handle = `${base}-${randomHex(2)}`;
    return handle;
  }

  /** Account for an email address, created (unverified) when needed so it can receive invites. */
  ensureAccount(rawEmail) {
    const email = normalizeEmail(rawEmail);
    let row = this.accountByEmail(email);
    if (!row) {
      const id = crypto.randomUUID();
      this.sql.exec(
        "INSERT INTO accounts (id,email,handle,display_name,created_at) VALUES (?,?,?,?,?)",
        id,
        email,
        this.freeHandle(email),
        email.split("@")[0].slice(0, 80),
        Date.now(),
      );
      row = this.account(id);
    }
    return publicAccount(row);
  }

  /**
   * The directory account for a Better Auth user (cloud/auth.js). Better Auth only signs in
   * verified addresses, so the email proves ownership: an account created earlier by a magic
   * link or an invitation is linked and marked verified. Emails cannot be changed in Better
   * Auth, so the address stays a stable link until accounts move to D1.
   */
  linkVerifiedAccount(rawEmail, name) {
    const email = normalizeEmail(rawEmail);
    const created = !this.accountByEmail(email);
    const account = this.ensureAccount(email);
    this.sql.exec("UPDATE accounts SET verified=1 WHERE id=?", account.id);
    const displayName = typeof name === "string" ? name.trim().slice(0, 80) : "";
    if (created && displayName)
      this.sql.exec("UPDATE accounts SET display_name=? WHERE id=?", displayName, account.id);
    return publicAccount(this.account(account.id));
  }

  accountIdForEmail(email) {
    return typeof email === "string"
      ? this.accountByEmail(email.trim().toLowerCase())?.id || null
      : null;
  }
  accountsById(ids) {
    return (Array.isArray(ids) ? ids.slice(0, 64) : [])
      .map((id) => publicAccount(this.account(String(id))))
      .filter(Boolean);
  }

  async startSignIn(rawEmail, origin) {
    const email = normalizeEmail(rawEmail);
    const token = randomHex(32),
      now = Date.now();
    this.sql.exec("DELETE FROM sign_in_links WHERE expires_at<?", now);
    this.sql.exec(
      "INSERT INTO sign_in_links (hash,email,expires_at) VALUES (?,?,?)",
      await digestHex(token),
      email,
      now + LINK_TTL,
    );
    const link = `${origin}/#signin=${token}`;
    await sendMail(this.env, this, {
      to: email,
      subject: "Your Verynize sign-in link",
      text: `Open this link (or paste it into Verynize › Share › Account) within 15 minutes to sign in:\n\n${link}\n\nIf you did not ask to sign in, ignore this message.`,
      link,
    });
    return { sent: true, expiresInSeconds: LINK_TTL / 1000 };
  }

  /** Best-effort invitation email; a disabled provider never blocks the membership change. */
  async notifyInvite(email, title, role, link) {
    try {
      await sendMail(this.env, this, {
        to: email,
        subject: `You were invited to “${String(title).slice(0, 80)}” on Verynize`,
        text: `You can now open this shared design as ${role === "owner" || role === "editor" ? "an" : "a"} ${role}. Sign in with this email address, then open:\n\n${link}`,
        link,
      });
      return true;
    } catch {
      return false;
    }
  }

  async verifySignIn(token, label) {
    if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token))
      rpcFail(400, "Sign-in code is invalid");
    const hash = await digestHex(token);
    const row = this.sql.exec("SELECT * FROM sign_in_links WHERE hash=?", hash).toArray()[0];
    // Links are single use: remove before checking expiry so a replay always fails.
    this.sql.exec("DELETE FROM sign_in_links WHERE hash=?", hash);
    if (!row || row.expires_at < Date.now()) rpcFail(401, "Sign-in link expired or already used");
    const account = this.ensureAccount(row.email);
    this.sql.exec("UPDATE accounts SET verified=1 WHERE id=?", account.id);
    return this.newSession(account.id, label);
  }

  async newSession(accountId, label) {
    const session = "vs_" + randomHex(32),
      now = Date.now();
    this.sql.exec(
      "INSERT INTO sessions (hash,account_id,created_at,expires_at,label) VALUES (?,?,?,?,?)",
      await digestHex(session),
      accountId,
      now,
      now + SESSION_TTL,
      typeof label === "string" ? label.slice(0, 80) : null,
    );
    return { session, account: publicAccount(this.account(accountId)) };
  }

  // ---- passkeys (WebAuthn) ----
  // Ceremonies run on the server's own origin (/passkey page). Apps on another origin, such as
  // the desktop renderer, start a handoff: they keep its secret and claim the session once the
  // page has completed a sign-in for that handoff id.
  async createHandoff() {
    const id = randomHex(16),
      secret = randomHex(32);
    this.sql.exec("DELETE FROM handoffs WHERE expires_at<?", Date.now());
    this.sql.exec(
      "INSERT INTO handoffs (id,secret_hash,expires_at) VALUES (?,?,?)",
      id,
      await digestHex(secret),
      Date.now() + PASSKEY_TTL,
    );
    return { id, secret, expiresInSeconds: PASSKEY_TTL / 1000 };
  }

  async claimHandoff(id, secret, label) {
    const row =
      typeof id === "string"
        ? this.sql.exec("SELECT * FROM handoffs WHERE id=?", id).toArray()[0]
        : null;
    if (
      !row ||
      row.expires_at < Date.now() ||
      typeof secret !== "string" ||
      !sameDigest(row.secret_hash, await digestHex(secret))
    )
      rpcFail(404, "Sign-in request expired; start again");
    if (!row.account_id) return { pending: true };
    this.sql.exec("DELETE FROM handoffs WHERE id=?", id);
    return this.newSession(row.account_id, label);
  }

  async createPasskeyTicket(accountId) {
    const ticket = randomHex(32);
    this.sql.exec("DELETE FROM passkey_tickets WHERE expires_at<?", Date.now());
    this.sql.exec(
      "INSERT INTO passkey_tickets (hash,account_id,expires_at) VALUES (?,?,?)",
      await digestHex(ticket),
      accountId,
      Date.now() + PASSKEY_TTL,
    );
    return { ticket, expiresInSeconds: PASSKEY_TTL / 1000 };
  }

  async ticketAccount(ticket) {
    if (typeof ticket !== "string" || !/^[0-9a-f]{64}$/.test(ticket))
      rpcFail(400, "Invalid passkey ticket");
    const row = this.sql
      .exec("SELECT * FROM passkey_tickets WHERE hash=?", await digestHex(ticket))
      .toArray()[0];
    if (!row || row.expires_at < Date.now())
      rpcFail(401, "This passkey setup link expired; start again from Verynize");
    return this.account(row.account_id);
  }

  storeChallenge(kind, accountId, handoffId) {
    const challenge = toBase64url(crypto.getRandomValues(new Uint8Array(32)));
    this.sql.exec("DELETE FROM passkey_challenges WHERE expires_at<?", Date.now());
    // Signature checks are cheap and challenges single use; only bound how many may be outstanding.
    this.sql.exec(
      "DELETE FROM passkey_challenges WHERE challenge IN (SELECT challenge FROM passkey_challenges ORDER BY expires_at DESC LIMIT -1 OFFSET 5000)",
    );
    this.sql.exec(
      "INSERT INTO passkey_challenges (challenge,kind,account_id,handoff_id,expires_at) VALUES (?,?,?,?,?)",
      challenge,
      kind,
      accountId,
      handoffId,
      Date.now() + PASSKEY_TTL,
    );
    return challenge;
  }
  /** Challenges are single use: they are deleted before verification. */
  takeChallenge(challenge, kind) {
    const row =
      typeof challenge === "string"
        ? this.sql
            .exec("SELECT * FROM passkey_challenges WHERE challenge=?", challenge)
            .toArray()[0]
        : null;
    this.sql.exec("DELETE FROM passkey_challenges WHERE challenge=?", String(challenge));
    if (!row || row.kind !== kind || row.expires_at < Date.now())
      rpcFail(401, "Passkey request expired; try again");
    return row;
  }

  async registrationOptions(ticket, rpId, rpName) {
    const account = await this.ticketAccount(ticket);
    const existing = this.sql
      .exec("SELECT id FROM passkeys WHERE account_id=?", account.id)
      .toArray();
    if (existing.length >= 20) rpcFail(409, "An account can hold at most 20 passkeys");
    return {
      challenge: this.storeChallenge("register", account.id, null),
      rp: { id: rpId, name: rpName },
      user: {
        id: toBase64url(new TextEncoder().encode(account.id)),
        name: account.email,
        displayName: account.display_name,
      },
      pubKeyCredParams: ALGORITHMS.map((alg) => ({ type: "public-key", alg })),
      authenticatorSelection: {
        residentKey: "required",
        requireResidentKey: true,
        userVerification: "preferred",
      },
      attestation: "none",
      timeout: 120000,
      excludeCredentials: existing.map((row) => ({ type: "public-key", id: row.id })),
    };
  }

  async verifyPasskeyRegistration({ ticket, challenge, credential, label }, origin, rpId) {
    const account = await this.ticketAccount(ticket);
    const row = this.takeChallenge(challenge, "register");
    if (row.account_id !== account.id) rpcFail(401, "Passkey request does not match this account");
    const verified = await verifyRegistration({ credential, challenge, origin, rpId });
    if (this.sql.exec("SELECT id FROM passkeys WHERE id=?", verified.credentialId).toArray()[0])
      rpcFail(409, "This passkey is already registered");
    this.sql.exec("DELETE FROM passkey_tickets WHERE account_id=?", account.id);
    this.sql.exec(
      "INSERT INTO passkeys (id,account_id,alg,jwk,sign_count,label,created_at) VALUES (?,?,?,?,?,?,?)",
      verified.credentialId,
      account.id,
      verified.alg,
      JSON.stringify(verified.jwk),
      verified.signCount,
      typeof label === "string" && label.trim() ? label.trim().slice(0, 80) : "Passkey",
      Date.now(),
    );
    this.sql.exec("UPDATE accounts SET verified=1 WHERE id=?", account.id);
    return { passkey: this.passkeys(account.id).find((item) => item.id === verified.credentialId) };
  }

  loginOptions(handoffId, rpId, email) {
    if (handoffId !== undefined && handoffId !== null) {
      const handoff =
        typeof handoffId === "string"
          ? this.sql.exec("SELECT * FROM handoffs WHERE id=?", handoffId).toArray()[0]
          : null;
      if (!handoff || handoff.expires_at < Date.now() || handoff.account_id)
        rpcFail(404, "Sign-in request expired; start again from Verynize");
    }
    // Without an email the authenticator offers this site's discoverable passkeys (browsers show an
    // account chooser). With one, the account's credential ids are listed, which embedded windows
    // without a chooser (Electron) need. This reveals whether an email has passkeys.
    let allowCredentials = [];
    if (typeof email === "string" && email.trim()) {
      const owner = this.accountByEmail(email.trim().toLowerCase());
      allowCredentials = owner
        ? this.sql
            .exec("SELECT id FROM passkeys WHERE account_id=?", owner.id)
            .toArray()
            .map((row) => ({ type: "public-key", id: row.id }))
        : [];
      if (!allowCredentials.length) rpcFail(404, "No passkey is registered for that email");
    }
    return {
      challenge: this.storeChallenge("login", null, handoffId ?? null),
      rpId,
      userVerification: "preferred",
      timeout: 120000,
      allowCredentials,
    };
  }

  async verifyPasskeyLogin({ challenge, credential, label }, origin, rpId) {
    const row = this.takeChallenge(challenge, "login");
    const stored =
      typeof credential?.id === "string"
        ? this.sql.exec("SELECT * FROM passkeys WHERE id=?", credential.id).toArray()[0]
        : null;
    if (!stored) rpcFail(401, "This passkey is not registered with Verynize");
    const handle = credential.response?.userHandle;
    if (handle && handle !== toBase64url(new TextEncoder().encode(stored.account_id)))
      rpcFail(401, "Passkey user does not match");
    const result = await verifyAssertion({
      credential,
      stored: { alg: stored.alg, jwk: JSON.parse(stored.jwk), signCount: stored.sign_count },
      challenge,
      origin,
      rpId,
    });
    this.sql.exec(
      "UPDATE passkeys SET sign_count=?,last_used_at=? WHERE id=?",
      result.signCount,
      Date.now(),
      stored.id,
    );
    if (row.handoff_id) {
      const updated = this.sql.exec(
        "UPDATE handoffs SET account_id=? WHERE id=? AND account_id IS NULL AND expires_at>?",
        stored.account_id,
        row.handoff_id,
        Date.now(),
      ).rowsWritten;
      if (!updated) rpcFail(404, "Sign-in request expired; start again from Verynize");
      return {
        handedOff: true,
        account: { displayName: this.account(stored.account_id).display_name },
      };
    }
    return this.newSession(stored.account_id, label);
  }

  passkeys(accountId) {
    return this.sql
      .exec(
        "SELECT id,alg,label,created_at,last_used_at FROM passkeys WHERE account_id=? ORDER BY created_at",
        accountId,
      )
      .toArray()
      .map((row) => ({
        id: row.id,
        alg: row.alg,
        label: row.label,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at,
      }));
  }
  deletePasskey(accountId, id) {
    const removed = this.sql.exec(
      "DELETE FROM passkeys WHERE id=? AND account_id=?",
      String(id),
      accountId,
    ).rowsWritten;
    if (!removed) rpcFail(404, "Passkey not found");
    return { removed: id };
  }

  async resolveSession(session) {
    if (typeof session !== "string" || !SESSION.test(session)) return null;
    const row = this.sql
      .exec("SELECT * FROM sessions WHERE hash=?", await digestHex(session))
      .toArray()[0];
    if (!row) return null;
    if (row.expires_at < Date.now()) {
      this.sql.exec("DELETE FROM sessions WHERE hash=?", row.hash);
      return null;
    }
    return publicAccount(this.account(row.account_id));
  }

  async signOut(session) {
    if (typeof session === "string")
      this.sql.exec("DELETE FROM sessions WHERE hash=?", await digestHex(session));
    return { signedOut: true };
  }

  signOutEverywhere(accountId) {
    const count = this.sql
      .exec("SELECT COUNT(*) AS n FROM sessions WHERE account_id=?", accountId)
      .one().n;
    this.sql.exec("DELETE FROM sessions WHERE account_id=?", accountId);
    return { signedOut: true, sessions: count };
  }

  sessionCount(accountId) {
    return this.sql
      .exec(
        "SELECT COUNT(*) AS n FROM sessions WHERE account_id=? AND expires_at>?",
        accountId,
        Date.now(),
      )
      .one().n;
  }

  updateProfile(accountId, patch) {
    const row = this.account(accountId);
    if (!row) rpcFail(404, "Account not found");
    if (patch.handle !== undefined) {
      const handle = String(patch.handle).trim().toLowerCase();
      if (!HANDLE.test(handle) || RESERVED.has(handle))
        rpcFail(400, "Handles use 3–30 lowercase letters, numbers or dashes");
      const owner = this.accountByHandle(handle);
      if (owner && owner.id !== accountId) rpcFail(409, "That handle is taken");
      this.sql.exec("UPDATE accounts SET handle=? WHERE id=?", handle, accountId);
    }
    if (patch.displayName !== undefined) {
      const name = String(patch.displayName).trim().replace(/\s+/g, " ");
      if (!name || name.length > 80) rpcFail(400, "Display names use 1–80 characters");
      this.sql.exec("UPDATE accounts SET display_name=? WHERE id=?", name, accountId);
    }
    if (patch.avatarUrl !== undefined) {
      const url = String(patch.avatarUrl).trim();
      if (url) {
        let parsed;
        try {
          parsed = new URL(url);
        } catch {
          rpcFail(400, "Avatar must be an HTTPS image URL");
        }
        if (parsed.protocol !== "https:" || parsed.username || parsed.password || url.length > 500)
          rpcFail(400, "Avatar must be an HTTPS image URL");
      }
      this.sql.exec("UPDATE accounts SET avatar_url=? WHERE id=?", url || null, accountId);
    }
    return publicAccount(this.account(accountId));
  }

  profile(handle) {
    const row = typeof handle === "string" ? this.accountByHandle(handle.toLowerCase()) : null;
    if (!row || !row.verified) return null;
    // App paths include the handle, so they are recomputed in case the handle changed since publishing.
    const publications = this.sql
      .exec(
        "SELECT kind,ref,title,path,published_at FROM publications WHERE account_id=? ORDER BY published_at DESC LIMIT 200",
        row.id,
      )
      .toArray()
      .map((item) => ({
        kind: item.kind,
        title: item.title,
        path: item.kind === "app" ? this.appInfo(item.ref)?.path || item.path : item.path,
        publishedAt: item.published_at,
      }));
    return {
      handle: row.handle,
      displayName: row.display_name,
      avatarUrl: row.avatar_url || "",
      publications,
    };
  }

  recordPublication(accountId, { kind, ref, title, path }) {
    this.sql.exec(
      "INSERT OR REPLACE INTO publications (kind,ref,account_id,title,path,published_at) VALUES (?,?,?,?,?,?)",
      kind,
      ref,
      accountId,
      String(title || "Untitled").slice(0, 120),
      path,
      Date.now(),
    );
  }
  removePublication(kind, ref) {
    this.sql.exec("DELETE FROM publications WHERE kind=? AND ref=?", kind, ref);
  }

  linkRoom(accountId, roomId, role, title) {
    this.sql.exec(
      "INSERT OR REPLACE INTO memberships (account_id,room_id,role,title,updated_at) VALUES (?,?,?,?,?)",
      accountId,
      roomId,
      role,
      title ? String(title).slice(0, 120) : null,
      Date.now(),
    );
  }
  unlinkRoom(accountId, roomId) {
    this.sql.exec("DELETE FROM memberships WHERE account_id=? AND room_id=?", accountId, roomId);
  }
  rooms(accountId) {
    return this.sql
      .exec(
        "SELECT room_id,role,title,updated_at FROM memberships WHERE account_id=? ORDER BY updated_at DESC LIMIT 500",
        accountId,
      )
      .toArray()
      .map((row) => ({
        id: row.room_id,
        role: row.role,
        title: row.title || "Shared design",
        updatedAt: row.updated_at,
      }));
  }

  outbox(recipient) {
    if (this.env.EMAIL_PROVIDER !== "outbox") rpcFail(404, "Not found");
    return this.sql
      .exec(
        "SELECT recipient,subject,body,link,created_at FROM outbox WHERE recipient=? ORDER BY id DESC LIMIT 20",
        String(recipient || "").toLowerCase(),
      )
      .toArray()
      .map((row) => ({
        to: row.recipient,
        subject: row.subject,
        text: row.body,
        link: row.link,
        createdAt: row.created_at,
      }));
  }
  storeOutbox(message) {
    this.sql.exec(
      "INSERT INTO outbox (recipient,subject,body,link,created_at) VALUES (?,?,?,?,?)",
      message.to,
      message.subject,
      message.text,
      message.link || null,
      Date.now(),
    );
    this.sql.exec(
      "DELETE FROM outbox WHERE id NOT IN (SELECT id FROM outbox ORDER BY id DESC LIMIT 500)",
    );
  }

  // Published applications: names are unique per account and served at /apps/<handle>/<name>/.
  ensureApp(accountId, rawName, rawTitle) {
    const name = String(rawName || "")
      .trim()
      .toLowerCase();
    if (!APP_NAME.test(name)) rpcFail(400, "App names use lowercase letters, numbers and dashes");
    const title =
      String(rawTitle || name)
        .trim()
        .slice(0, 120) || name;
    let row = this.sql
      .exec("SELECT * FROM apps WHERE account_id=? AND name=?", accountId, name)
      .toArray()[0];
    if (!row) {
      const count = this.sql
        .exec("SELECT COUNT(*) AS n FROM apps WHERE account_id=?", accountId)
        .one().n;
      if (count >= 50) rpcFail(429, "An account can publish at most 50 apps");
      this.sql.exec(
        "INSERT INTO apps (id,account_id,name,title,created_at) VALUES (?,?,?,?,?)",
        crypto.randomUUID(),
        accountId,
        name,
        title,
        Date.now(),
      );
      row = this.sql
        .exec("SELECT * FROM apps WHERE account_id=? AND name=?", accountId, name)
        .toArray()[0];
    } else if (rawTitle) this.sql.exec("UPDATE apps SET title=? WHERE id=?", title, row.id);
    return this.appInfo(row.id);
  }
  appInfo(appId) {
    const row = this.sql
      .exec(
        "SELECT apps.*, accounts.handle FROM apps JOIN accounts ON accounts.id=apps.account_id WHERE apps.id=?",
        appId,
      )
      .toArray()[0];
    return row
      ? {
          id: row.id,
          accountId: row.account_id,
          name: row.name,
          title: row.title,
          handle: row.handle,
          activeVersion: row.active_version ?? null,
          path: `/apps/${row.handle}/${row.name}/`,
        }
      : null;
  }
  apps(accountId) {
    return this.sql
      .exec("SELECT id FROM apps WHERE account_id=? ORDER BY created_at DESC", accountId)
      .toArray()
      .map((row) => this.appInfo(row.id));
  }
  resolveApp(handle, name) {
    const row = this.sql
      .exec(
        "SELECT apps.id FROM apps JOIN accounts ON accounts.id=apps.account_id WHERE accounts.handle=? AND apps.name=?",
        String(handle).toLowerCase(),
        String(name).toLowerCase(),
      )
      .toArray()[0];
    return row ? this.appInfo(row.id) : null;
  }
  setActiveVersion(appId, version) {
    const app = this.appInfo(appId);
    if (!app) rpcFail(404, "App not found");
    this.sql.exec("UPDATE apps SET active_version=? WHERE id=?", version, appId);
    if (version === null) this.removePublication("app", appId);
    else
      this.recordPublication(app.accountId, {
        kind: "app",
        ref: appId,
        title: app.title,
        path: app.path,
      });
    return this.appInfo(appId);
  }
}
