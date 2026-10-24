-- A report's title, when the member gave one (src/reports.ts): the GitHub issue's title, in place
-- of the report's first line.
ALTER TABLE problem_reports ADD COLUMN title TEXT;
