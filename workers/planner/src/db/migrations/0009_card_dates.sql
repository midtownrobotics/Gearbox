-- A card's dates, each a calendar day (YYYY-MM-DD), the same for everyone:
-- due_date: when it's due, if ever.
-- starts_on: a card scheduled ahead stays off the board until that day, then is in Not Started.
ALTER TABLE cards ADD COLUMN due_date TEXT
  CHECK (due_date IS NULL OR due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
ALTER TABLE cards ADD COLUMN starts_on TEXT
  CHECK (starts_on IS NULL OR starts_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
