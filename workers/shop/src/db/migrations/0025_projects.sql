-- Projects (a robot, a season's practice bot): what a team's parts are made for. A team follows
-- any number of Onshape documents, each linked to one project, and every subsystem belongs to a
-- project, so a part's project is its subsystem's. A release keeps the project of the document it
-- came from, so it stays put when the document is later taken off the list.
--
-- A team that already uses Shop gets one project, "Robot", holding its saved document, every
-- subsystem, every release and every quality report. Admins rename it on the Admin page.
--
-- SQLite can't add a NOT NULL column with a foreign key; the app always sets subsystems'
-- project_id, and this fills it in on every row there is.
CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  archived_at INTEGER,
  UNIQUE (team_id, name)
);

CREATE TABLE onshape_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  document_id TEXT NOT NULL,
  main_assembly_id TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (team_id, document_id)
);

ALTER TABLE subsystems ADD COLUMN project_id INTEGER REFERENCES projects(id);
ALTER TABLE onshape_releases ADD COLUMN project_id INTEGER REFERENCES projects(id);
ALTER TABLE quality_reports ADD COLUMN project_id INTEGER;
ALTER TABLE quality_reports ADD COLUMN project_name TEXT;

INSERT INTO projects (team_id, name, created_at)
SELECT team_id, 'Robot', CAST(strftime('%s', 'now') AS INTEGER) * 1000 FROM (
  SELECT team_id FROM subsystems
  UNION SELECT team_id FROM part_definitions
  UNION SELECT team_id FROM onshape_releases
  UNION SELECT team_id FROM quality_reports
  UNION SELECT team_id FROM admin_settings WHERE key = 'onshape_document_id' AND value != ''
);

INSERT INTO onshape_documents (team_id, project_id, document_id, main_assembly_id, created_at)
SELECT d.team_id, p.id, d.value,
       (SELECT NULLIF(a.value, '') FROM admin_settings a
        WHERE a.team_id = d.team_id AND a.key = 'onshape_main_assembly_id'),
       CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM admin_settings d JOIN projects p ON p.team_id = d.team_id
WHERE d.key = 'onshape_document_id' AND d.value != '';

-- Releases from before their document was kept were all from the team's one document.
UPDATE onshape_releases SET document_id = (
  SELECT document_id FROM onshape_documents o WHERE o.team_id = onshape_releases.team_id
) WHERE document_id IS NULL;

UPDATE subsystems SET project_id = (
  SELECT id FROM projects p WHERE p.team_id = subsystems.team_id
);
UPDATE onshape_releases SET project_id = (
  SELECT id FROM projects p WHERE p.team_id = onshape_releases.team_id
);
UPDATE quality_reports SET
  project_id = (SELECT id FROM projects p WHERE p.team_id = quality_reports.team_id),
  project_name = 'Robot';

DELETE FROM admin_settings WHERE key IN ('onshape_document_id', 'onshape_main_assembly_id');

CREATE INDEX projects_team_idx ON projects (team_id);
CREATE INDEX subsystems_project_idx ON subsystems (team_id, project_id);
