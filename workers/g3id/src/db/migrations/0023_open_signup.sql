-- Whether people can sign up with Google or GitHub, not only through the team's chat (Slack or
-- Discord), on the Sign-in page of the team's admin pages. Off unless an admin switches it on;
-- those sign-ups pass a Turnstile check and wait for an admin's approval.
ALTER TABLE team_sign_in_methods ADD COLUMN open_signup INTEGER NOT NULL DEFAULT 0;
