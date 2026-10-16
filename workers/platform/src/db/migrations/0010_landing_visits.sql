-- Visits to the public landing page, counted per day (UTC): how many, and how many of them by
-- someone signed in to Gearbox. Nothing about the visitor is kept: no address, no id, no cookie.
-- Operators see the counts in the console.
CREATE TABLE landing_visits (
  day TEXT PRIMARY KEY,
  visits INTEGER NOT NULL DEFAULT 0,
  signed_in INTEGER NOT NULL DEFAULT 0
);
