-- Admins remove subsystems and processes the team no longer uses. One nothing points at is
-- deleted; one that parts, instances, batches or the Actions Log still name is archived instead
-- (lib/removal.ts): left out of every picker for new parts, while what already uses it keeps it
-- and shows its name. Restoring clears it.
ALTER TABLE subsystems ADD COLUMN archived_at INTEGER;
ALTER TABLE processes ADD COLUMN archived_at INTEGER;
