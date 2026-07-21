-- Les objets impliqués dans une conjonction ne sont pas systématiquement
-- présents dans la table `objects` (peuplée uniquement pour "stations") —
-- on stocke donc leur nom directement ici, pour un affichage autonome.
ALTER TABLE conjunctions ADD COLUMN object_a_name TEXT;
ALTER TABLE conjunctions ADD COLUMN object_b_name TEXT;
