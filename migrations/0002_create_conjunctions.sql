CREATE TABLE conjunctions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  object_a      INTEGER NOT NULL REFERENCES objects(norad_id),
  object_b      INTEGER NOT NULL REFERENCES objects(norad_id),
  tca           TEXT NOT NULL,     -- Time of Closest Approach (ISO 8601)
  min_distance  REAL NOT NULL,     -- km
  rel_velocity  REAL,              -- km/s
  computed_at   TEXT NOT NULL,
  tle_age_hours REAL               -- fiabilité du calcul
);

CREATE INDEX idx_conj_tca ON conjunctions(tca);
