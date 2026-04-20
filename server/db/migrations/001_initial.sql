CREATE TABLE IF NOT EXISTS pipeline_runs (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL,
  github_repo  TEXT NOT NULL,
  folder_path  TEXT NOT NULL,
  approver_email TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'IDLE',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pipeline_stages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id     TEXT NOT NULL REFERENCES pipeline_runs(id),
  stage      TEXT NOT NULL,
  status     TEXT NOT NULL,
  actor      TEXT,
  detail     TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ingested_docs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id     TEXT NOT NULL REFERENCES pipeline_runs(id),
  filename   TEXT NOT NULL,
  path       TEXT NOT NULL,
  content    TEXT NOT NULL,
  sha        TEXT NOT NULL,
  created_at TEXT NOT NULL
);
