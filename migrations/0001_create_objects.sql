CREATE TABLE objects (
  norad_id      INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  object_type   TEXT,              -- PAYLOAD | ROCKET BODY | DEBRIS
  country       TEXT,
  launch_date   TEXT,
  origin_event  TEXT,              -- ex: 'COSMOS-1408 ASAT 2021'
  tle_line1     TEXT NOT NULL,
  tle_line2     TEXT NOT NULL,
  tle_epoch     TEXT NOT NULL,     -- pour afficher la fraîcheur
  updated_at    TEXT NOT NULL
);

CREATE INDEX idx_objects_type ON objects(object_type);
CREATE INDEX idx_objects_event ON objects(origin_event);
