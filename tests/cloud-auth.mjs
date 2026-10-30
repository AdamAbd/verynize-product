// Better Auth on D1 (cloud/auth.js): email + password sign-up, required email verification,
// bearer sessions for the cookie-less desktop, password reset, organizations, per-IP rate limits
// and persistence across a restart, on local workerd with the built Worker bundle.
import { Miniflare } from "miniflare";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cloudOptions } from "./cloud-harness.mjs";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-auth-"));
const options = await cloudOptions(path.join(dir, "state"));
let mf = new Miniflare(options);
const ORIGIN = "http://local";
const send = (route, { method = "GET", body, bearer, ip = "203.0.113.1" } = {}) =>
  mf.dispatchFetch(ORIGIN + route, {
    method,
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": ip,
      ...(bearer ? { authorization: "Bearer " + bearer } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const data = async (response, status) => {
  const text = await response.text();
  assert.equal(response.status, status, text);
  return text ? JSON.parse(text) : null;
};
const outbox = async (email) =>
  (await data(await send("/api/dev/outbox?to=" + encodeURIComponent(email)), 200)).messages;

try {
  // Seed the pre-Drizzle storage format directly into the existing migration schema.
  // A driver switch must preserve old sessions, expiry comparisons and boolean values.
  const db = await mf.getD1Database("DB");
  const oldDate = new Date(Date.now() - 2 * 86400000).toISOString();
  await db
    .prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind("legacy-orm-user", "Legacy ORM", "legacy-orm@example.com", 1, oldDate, oldDate)
    .run();
  for (const [id, expiry] of [
    ["valid", Date.now() + 86400000],
    ["expired", Date.now() - 86400000],
  ]) {
    await db
      .prepare(
        'INSERT INTO "session" (id, token, userId, expiresAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(
        "legacy-" + id,
        "legacy-token-" + id,
        "legacy-orm-user",
        new Date(expiry).toISOString(),
        oldDate,
        oldDate,
      )
      .run();
  }
  const legacy = await data(
    await send("/api/auth/get-session", { bearer: "legacy-token-valid" }),
    200,
  );
  assert.equal(legacy.user.email, "legacy-orm@example.com");
  assert.equal(legacy.user.emailVerified, true);
  assert.equal(legacy.user.createdAt, oldDate);
  assert.equal(
    await data(await send("/api/auth/get-session", { bearer: "legacy-token-expired" }), 200),
    null,
  );
  await data(
    await send("/api/auth/sign-out", { method: "POST", bearer: "legacy-token-valid", body: {} }),
    200,
  );
  assert.equal(
    await data(await send("/api/auth/get-session", { bearer: "legacy-token-valid" }), 200),
    null,
  );

  const email = "ana@example.com";
  const password = "correct horse battery";

  // Sign-up stores the user unverified and emails a verification link; no session yet.
  let started = performance.now();
  const signedUp = await data(
    await send("/api/auth/sign-up/email", {
      method: "POST",
      body: { email, password, name: "Ana" },
    }),
    200,
  );
  const signUpMs = performance.now() - started;
  assert.equal(signedUp.user.email, email);
  assert.equal(signedUp.user.emailVerified, false);
  assert.equal(signedUp.token, null);
  assert.equal(
    (
      await send("/api/auth/sign-up/email", {
        method: "POST",
        body: { email: "short@example.com", password: "short", name: "S" },
      })
    ).status,
    400,
  );

  // Unverified accounts cannot sign in.
  assert.equal(
    (await send("/api/auth/sign-in/email", { method: "POST", body: { email, password } })).status,
    403,
  );

  // The emailed link verifies the address (once).
  const [verification] = await outbox(email);
  assert.match(verification.subject, /Verify/);
  const link = new URL(verification.link);
  assert.equal(link.origin, ORIGIN);
  assert.equal(link.pathname, "/api/auth/verify-email");
  const verified = await send(link.pathname + link.search);
  assert.ok([200, 302].includes(verified.status), await verified.text());
  // The token is a signed JWT: a tampered one verifies nothing.
  const tampered = new URL(link);
  tampered.searchParams.set("token", link.searchParams.get("token").slice(0, -4) + "AAAA");
  const rejected = await send(tampered.pathname + tampered.search);
  assert.ok(
    rejected.status >= 400 || /error=/.test(rejected.headers.get("location") || ""),
    "tampered verification token is refused",
  );

  // Password sign-in returns the session token in the body and in set-auth-token (bearer plugin),
  // and responses carry the desktop CORS headers.
  assert.equal(
    (
      await send("/api/auth/sign-in/email", {
        method: "POST",
        body: { email, password: "wrong password!!" },
      })
    ).status,
    401,
  );
  started = performance.now();
  const signInResponse = await send("/api/auth/sign-in/email", {
    method: "POST",
    body: { email, password },
  });
  const signInMs = performance.now() - started;
  assert.equal(signInResponse.headers.get("access-control-allow-origin"), "*");
  assert.equal(signInResponse.headers.get("set-cookie"), null, "no cookie sessions");
  assert.match(signInResponse.headers.get("access-control-expose-headers"), /set-auth-token/);
  const bearer = signInResponse.headers.get("set-auth-token");
  const signedIn = await data(signInResponse, 200);
  assert.ok(bearer && signedIn.token);
  assert.equal(signedIn.user.emailVerified, true);

  const session = await data(await send("/api/auth/get-session", { bearer }), 200);
  assert.equal(session.user.email, email);
  assert.equal(await data(await send("/api/auth/get-session"), 200), null);
  assert.equal(
    await data(await send("/api/auth/get-session", { bearer: "forged.token" }), 200),
    null,
  );

  // Organizations: the creator becomes owner, invitations are emailed, membership is listed.
  const org = await data(
    await send("/api/auth/organization/create", {
      method: "POST",
      bearer,
      body: { name: "Studio Ana", slug: "studio-ana" },
    }),
    200,
  );
  assert.equal(org.slug, "studio-ana");
  assert.equal(org.members[0].role, "owner");
  assert.equal(
    (
      await send("/api/auth/organization/create", {
        method: "POST",
        body: { name: "Anonymous", slug: "anonymous" },
      })
    ).status,
    401,
  );
  const orgs = await data(await send("/api/auth/organization/list", { bearer }), 200);
  assert.deepEqual(
    orgs.map((o) => o.id),
    [org.id],
  );
  const invitation = await data(
    await send("/api/auth/organization/invite-member", {
      method: "POST",
      bearer,
      body: { email: "budi@example.com", role: "member", organizationId: org.id },
    }),
    200,
  );
  const [invite] = await outbox("budi@example.com");
  assert.match(invite.subject, /Studio Ana/);
  assert.equal(invite.link, `${ORIGIN}/#invitation=${invitation.id}`);

  // The invitee signs up, verifies and accepts; the organization then lists both members.
  await data(
    await send("/api/auth/sign-up/email", {
      method: "POST",
      body: { email: "budi@example.com", password: "another long password", name: "Budi" },
    }),
    200,
  );
  const budiVerify = new URL(
    (await outbox("budi@example.com")).find((m) => /Verify/.test(m.subject)).link,
  );
  await send(budiVerify.pathname + budiVerify.search);
  const budi = (
    await send("/api/auth/sign-in/email", {
      method: "POST",
      body: { email: "budi@example.com", password: "another long password" },
    })
  ).headers.get("set-auth-token");
  assert.ok(budi);
  await data(
    await send("/api/auth/organization/accept-invitation", {
      method: "POST",
      bearer: budi,
      body: { invitationId: invitation.id },
    }),
    200,
  );
  const full = await data(
    await send("/api/auth/organization/get-full-organization?organizationId=" + org.id, { bearer }),
    200,
  );
  assert.deepEqual(full.members.map((m) => m.role).sort(), ["member", "owner"]);
  assert.equal(
    (
      await send("/api/auth/organization/get-full-organization?organizationId=" + org.id, {
        bearer: "not-a-session",
      })
    ).status,
    401,
  );

  // Password reset: the emailed link carries a single-use token; the old password and every
  // existing session stop working.
  await data(
    await send("/api/auth/request-password-reset", {
      method: "POST",
      body: { email, redirectTo: ORIGIN + "/reset" },
    }),
    200,
  );
  const resetLink = new URL((await outbox(email)).find((m) => /Reset/.test(m.subject)).link);
  const token = resetLink.pathname.split("/").pop();
  const newPassword = "an even better passphrase";
  await data(
    await send("/api/auth/reset-password", { method: "POST", body: { token, newPassword } }),
    200,
  );
  assert.equal(
    (await send("/api/auth/reset-password", { method: "POST", body: { token, newPassword } }))
      .status,
    400,
  );
  assert.equal(await data(await send("/api/auth/get-session", { bearer }), 200), null);
  assert.equal(
    (await send("/api/auth/sign-in/email", { method: "POST", body: { email, password } })).status,
    401,
  );
  const renewed = (
    await send("/api/auth/sign-in/email", {
      method: "POST",
      body: { email, password: newPassword },
    })
  ).headers.get("set-auth-token");
  assert.ok(renewed);

  // Sign-out ends the session.
  await data(await send("/api/auth/sign-out", { method: "POST", bearer: budi, body: {} }), 200);
  assert.equal(await data(await send("/api/auth/get-session", { bearer: budi }), 200), null);

  // Password and email endpoints are limited per IP and endpoint (AUTH_LIMIT: 10 per minute).
  let limited = false;
  for (let i = 0; i < 15 && !limited; i++)
    limited =
      (
        await send("/api/auth/sign-in/email", {
          method: "POST",
          ip: "198.51.100.7",
          body: { email, password: "wrong password!!" },
        })
      ).status === 429;
  assert.ok(limited, "sign-in attempts are rate limited");
  assert.equal(
    (await send("/api/auth/get-session", { bearer: renewed, ip: "198.51.100.7" })).status,
    200,
    "reading the session is not limited",
  );

  // Users, sessions and organizations live in D1 and survive a restart.
  await mf.dispose();
  mf = new Miniflare(await cloudOptions(path.join(dir, "state")));
  assert.equal(
    (await data(await send("/api/auth/get-session", { bearer: renewed }), 200)).user.email,
    email,
  );
  assert.equal(
    (await data(await send("/api/auth/organization/list", { bearer: renewed }), 200)).length,
    1,
  );

  // Legacy magic-link accounts keep working beside Better Auth until the desktop moves over.
  assert.equal(
    (await send("/api/auth/start", { method: "POST", body: { email: "legacy@example.com" } }))
      .status,
    200,
  );

  console.log(
    `PASS Better Auth on D1: sign-up (${Math.round(signUpMs)} ms), verification, bearer sessions (sign-in ${Math.round(signInMs)} ms), password reset, organizations and invitations, rate limit, restart persistence`,
  );
} finally {
  await mf.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
