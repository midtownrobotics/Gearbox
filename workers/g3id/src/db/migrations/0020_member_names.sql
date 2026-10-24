-- A member's name is their full name, which they enter when they sign up and an admin can change;
-- their username is the name on the chat account they signed up with (Slack or Discord), which
-- nobody edits. Everyone already here keeps their name, and it becomes their username too.
ALTER TABLE core_users ADD COLUMN username TEXT;
UPDATE core_users SET username = display_name;

-- 1 while someone who just signed up hasn't entered their name yet: their team's admins are told
-- about them only once they have.
ALTER TABLE core_users ADD COLUMN needs_name INTEGER NOT NULL DEFAULT 0;
