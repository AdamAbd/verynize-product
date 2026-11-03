CREATE TABLE account_state (
  accountId TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  updatedAt INTEGER NOT NULL,
  PRIMARY KEY (accountId, key)
);
