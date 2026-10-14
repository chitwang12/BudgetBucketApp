-- One row per record (bucket, transaction, ledger entry, ...). See server/docs.ts.
CREATE TABLE docs (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  pos INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (kind, id)
) WITHOUT ROWID;

-- Each save claims the next revision. Two saves racing for the same number can't both succeed,
-- so one of them retries on fresh data instead of overwriting the other.
CREATE TABLE revisions (
  rev INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  summary TEXT NOT NULL
);

-- Commands already applied, so a retried request never applies a change twice.
CREATE TABLE applied (
  id TEXT PRIMARY KEY,
  rev INTEGER NOT NULL
) WITHOUT ROWID;
