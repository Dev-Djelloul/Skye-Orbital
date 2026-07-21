-- object_a/object_b référencent des NORAD ID qui ne sont pas tous présents
-- dans `objects` (peuplée uniquement pour "stations" — les objets Starlink
-- et débris ne le sont pas). La contrainte FK bloquait donc l'écriture des
-- conjonctions pour la quasi-totalité des cas réels. On la retire : les noms
-- sont déjà auto-portés (object_a_name/object_b_name), plus besoin de
-- dépendre de `objects` pour l'intégrité de cette table.
CREATE TABLE conjunctions_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  object_a      INTEGER NOT NULL,
  object_b      INTEGER NOT NULL,
  object_a_name TEXT,
  object_b_name TEXT,
  tca           TEXT NOT NULL,
  min_distance  REAL NOT NULL,
  rel_velocity  REAL,
  computed_at   TEXT NOT NULL,
  tle_age_hours REAL
);

INSERT INTO conjunctions_new
  (id, object_a, object_b, object_a_name, object_b_name, tca, min_distance, rel_velocity, computed_at, tle_age_hours)
SELECT id, object_a, object_b, object_a_name, object_b_name, tca, min_distance, rel_velocity, computed_at, tle_age_hours
FROM conjunctions;

DROP TABLE conjunctions;
ALTER TABLE conjunctions_new RENAME TO conjunctions;

CREATE INDEX idx_conj_tca ON conjunctions(tca);
