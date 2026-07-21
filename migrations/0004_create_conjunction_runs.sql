-- Suivi de progression du pipeline de screening de conjonctions (Phase 5),
-- découpé en messages Queue pour tenir sous la limite CPU par invocation.
-- Une ligne par jour de screening (run_id = date ISO du jour).
CREATE TABLE conjunction_runs (
  run_id            TEXT PRIMARY KEY,
  stage             TEXT NOT NULL, -- 'parsing' | 'precomputing' | 'scanning' | 'done'
  parse_total       INTEGER NOT NULL DEFAULT 0,
  parse_done        INTEGER NOT NULL DEFAULT 0,
  precompute_total  INTEGER NOT NULL DEFAULT 0,
  precompute_done   INTEGER NOT NULL DEFAULT 0,
  scan_total        INTEGER NOT NULL DEFAULT 0,
  scan_done         INTEGER NOT NULL DEFAULT 0,
  candidate_pairs   INTEGER,
  started_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
