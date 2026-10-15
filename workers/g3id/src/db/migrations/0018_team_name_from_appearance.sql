-- A team's name is the one in its Team Appearance: saving a new one renames the team here and in
-- the platform's registry (renameTeam in lib/team-ui.ts). Teams that saved a name before that
-- get it here once; the platform's copy follows on their next save.
UPDATE teams
SET
  name = (
    SELECT trim(json_extract(s.settings_json, '$.name'))
    FROM team_ui_settings s
    WHERE s.team_id = teams.id
  ),
  updated_at = unixepoch()
WHERE EXISTS (
  SELECT 1
  FROM team_ui_settings s
  WHERE s.team_id = teams.id
    AND json_valid(s.settings_json)
    AND trim(coalesce(json_extract(s.settings_json, '$.name'), '')) <> ''
    AND trim(json_extract(s.settings_json, '$.name')) <> teams.name
);
