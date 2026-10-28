-- When each member last used Gearbox: any app's call that checks who's signed in (/auth/me), at
-- most once a minute. Admins see it on Portal's Members pages; the operators' console counts
-- members online now and active lately from it.
ALTER TABLE core_users ADD COLUMN last_seen_at INTEGER;
