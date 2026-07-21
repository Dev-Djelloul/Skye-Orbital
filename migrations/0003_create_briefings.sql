CREATE TABLE briefings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  date          TEXT NOT NULL UNIQUE,
  content       TEXT NOT NULL,
  model_used    TEXT,
  generated_at  TEXT NOT NULL
);
