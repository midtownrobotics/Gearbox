-- What Onshape says about each release package, read when the release is approved: its name and
-- notes, who made it and when, its approvers (with when each approved or rejected it) and its
-- comments. Null for releases from before this was recorded.
ALTER TABLE `onshape_releases` ADD COLUMN `name` text;
ALTER TABLE `onshape_releases` ADD COLUMN `notes` text;
ALTER TABLE `onshape_releases` ADD COLUMN `state` text;
ALTER TABLE `onshape_releases` ADD COLUMN `document_id` text;
ALTER TABLE `onshape_releases` ADD COLUMN `version_id` text;
ALTER TABLE `onshape_releases` ADD COLUMN `made_by` text;
ALTER TABLE `onshape_releases` ADD COLUMN `made_at` text;
ALTER TABLE `onshape_releases` ADD COLUMN `approvers` text;
ALTER TABLE `onshape_releases` ADD COLUMN `comments` text;
ALTER TABLE `onshape_releases` ADD COLUMN `details_at` integer;
