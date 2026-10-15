CREATE TABLE student_permissions (
  team_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  app TEXT NOT NULL,
  permission TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT REFERENCES core_users(id) ON DELETE SET NULL,
  PRIMARY KEY (team_id, user_id, app, permission),
  FOREIGN KEY (team_id, user_id) REFERENCES core_users(team_id, id) ON DELETE CASCADE ON UPDATE CASCADE
);
-- Convert preview app roles to student grants. Global roles are never overridden.
INSERT OR IGNORE INTO student_permissions
SELECT team_id, user_id, CASE WHEN app = 'skill-tree' THEN 'skillTree' ELSE app END,
CASE WHEN app IN ('skill-tree', 'skillTree') THEN 'skills' ELSE 'manage' END, updated_at, updated_by
FROM app_permissions WHERE trusted_student = 1 AND app NOT IN ('id', 'portal');
INSERT OR IGNORE INTO student_permissions
SELECT team_id, user_id, CASE WHEN app = 'skill-tree' THEN 'skillTree' ELSE app END,
CASE app WHEN 'orders' THEN 'orders' WHEN 'inventory' THEN 'items' ELSE 'skills' END, updated_at, updated_by
FROM app_permissions WHERE mentor_access = 1 AND app IN ('orders', 'inventory', 'skill-tree', 'skillTree');
