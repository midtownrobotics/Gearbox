-- G3's sales tax rate, which was fixed in the Carts page (8.9% of a new order's items). It's now
-- each team's setting (lib/settings.ts: a team without a row starts at 0), edited on Settings.
INSERT INTO app_settings (team_id, key, value)
VALUES ('frc1648', 'sales_tax_percent', '8.9')
ON CONFLICT (team_id, key) DO NOTHING;
