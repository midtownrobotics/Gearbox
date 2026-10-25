-- The sender's name, when they chose to put it on the report (src/reports.ts): shown on the public
-- GitHub issue. Null for a report sent without it.
ALTER TABLE problem_reports ADD COLUMN reporter_name TEXT;
