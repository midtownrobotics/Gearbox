-- Schedule, a new app: switched on for every team already here, as 0005 did for the apps that
-- existed then. A team that has already switched it on or off from its Apps page keeps that. A
-- team that signs up from now on starts with none, as before.
INSERT INTO team_apps (team_id, app, enabled, changed_at)
SELECT id, 'schedule', 1, unixepoch() FROM teams WHERE status IN ('active', 'suspended')
ON CONFLICT (team_id, app) DO NOTHING;
