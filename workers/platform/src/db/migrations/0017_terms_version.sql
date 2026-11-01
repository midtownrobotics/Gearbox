-- Which terms of service a team's owner accepted: the terms' "Last updated" date (site.ts,
-- legal.termsVersion), set at sign-up and when the owner accepts new terms on the home page.
-- Teams that signed up before this have none, so their owners are asked once.
ALTER TABLE teams ADD COLUMN terms_version TEXT;
