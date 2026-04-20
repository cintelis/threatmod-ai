CREATE TABLE IF NOT EXISTS approval_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES pipeline_runs(id),
  triggered_at TEXT NOT NULL,
  approver_email TEXT NOT NULL,
  document_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  decision TEXT,
  reviewer TEXT,
  comments TEXT,
  decided_at TEXT,
  reminder_sent_at TEXT,
  escalated_at TEXT,
  created_at TEXT NOT NULL
);
