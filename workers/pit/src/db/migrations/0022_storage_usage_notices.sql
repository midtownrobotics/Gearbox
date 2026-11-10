-- High-water warnings per team and allowance, rearmed only below 85%.
CREATE TABLE storage_usage_notices (
 team_id TEXT NOT NULL,
 allowance TEXT NOT NULL,
 level INTEGER NOT NULL,
 PRIMARY KEY (team_id, allowance)
);
