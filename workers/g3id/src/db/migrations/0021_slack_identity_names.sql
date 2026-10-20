-- Slack sign-ins linked before Slack names were kept on them get one: the member's username, which
-- for everyone here before 0020 is the name they had then (their Slack name, for members who joined
-- with Slack). Sign-ins that already have a name keep it.
UPDATE core_user_identities
SET provider_email = (SELECT username FROM core_users WHERE core_users.id = core_user_identities.user_id)
WHERE provider = 'slack' AND provider_email IS NULL;
