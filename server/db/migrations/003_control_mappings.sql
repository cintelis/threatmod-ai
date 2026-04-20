CREATE TABLE IF NOT EXISTS control_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stride_category TEXT NOT NULL,
  framework TEXT NOT NULL,
  control_id TEXT NOT NULL,
  control_name TEXT NOT NULL,
  description TEXT NOT NULL
);
