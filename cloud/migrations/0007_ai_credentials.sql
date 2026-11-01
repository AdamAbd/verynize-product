-- Model API runtime credentials (cloud/ai-credentials.js, docs/ai-runtime.md "Credentials"): each
-- account brings its own OpenRouter key. "ai_credential" holds it encrypted at rest with AES-GCM
-- under a key derived (HKDF-SHA256) from BETTER_AUTH_SECRET; "ciphertext" and "iv" are base64, the
-- additional data binds a row to its account and provider. "last4" and "label" are display only.
-- "source" is 'oauth' (OpenRouter PKCE) or 'manual' (pasted key). Times are epoch ms.
create table "ai_credential" ("accountId" text not null, "provider" text not null, "ciphertext" text not null, "iv" text not null, "last4" text not null, "label" text, "source" text not null, "createdAt" integer not null, "updatedAt" integer not null, primary key ("accountId", "provider"));

-- "ai_oauth_state": one pending OpenRouter PKCE sign-in, keyed by the SHA-256 of its state value
-- (the raw state only travels through the browser). It binds the PKCE verifier (encrypted like a
-- credential) to the account that started the flow and to that browser (SHA-256 of a nonce kept
-- in an HttpOnly cookie). The callback claims the row once (deleted on use); it expires after
-- ten minutes like OpenRouter's authorization codes.
create table "ai_oauth_state" ("stateHash" text not null primary key, "accountId" text not null, "provider" text not null, "verifier" text not null, "iv" text not null, "browserHash" text not null, "returnTo" text not null, "expiresAt" integer not null, "createdAt" integer not null);

create index "ai_oauth_state_expires_idx" on "ai_oauth_state" ("expiresAt");
