-- Part recognition (lib/part-recognition.ts): what Onshape said about a released part (its
-- material, size and a plate's thickness), as JSON, so Ingest asks Onshape about each part once.
ALTER TABLE onshape_parts ADD COLUMN recognition TEXT;
