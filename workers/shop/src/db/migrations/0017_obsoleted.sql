-- When a part instance was made obsolete, and who did it. Null for one that isn't obsolete, and
-- for one made obsolete before this was recorded.
ALTER TABLE `part_instances` ADD COLUMN `obsoleted_at` integer;
ALTER TABLE `part_instances` ADD COLUMN `obsoleted_by` text;
