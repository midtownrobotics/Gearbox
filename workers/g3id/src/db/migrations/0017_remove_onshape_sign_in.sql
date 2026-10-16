-- Onshape is no longer a way to sign in or a service linked to an account: its routes are gone,
-- so its stored links and access tokens are deleted. Shop's own Onshape connection (each team's
-- API keys, in Shop's settings) is separate and unchanged. The provider CHECK on
-- core_user_identities still names 'onshape'; rebuilding the table only to drop it isn't worth it.
DELETE FROM core_user_identities WHERE provider = 'onshape';
