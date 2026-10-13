-- Batches are tracked as one unit, and are the only thing that links an instance to a file.
--
-- A batch now has a number and a name, a status at its File Producer process and one at the File
-- Consumer process its parts go to next. Files assigned straight to instances
-- (part_instance_files) become batches, and that table goes.

ALTER TABLE staging_batches ADD COLUMN number INTEGER;
ALTER TABLE staging_batches ADD COLUMN name TEXT;
ALTER TABLE staging_batches ADD COLUMN consumer_process_id INTEGER REFERENCES processes(id);
ALTER TABLE staging_batches ADD COLUMN producer_status TEXT NOT NULL DEFAULT 'todo';
ALTER TABLE staging_batches ADD COLUMN consumer_status TEXT NOT NULL DEFAULT 'todo';
ALTER TABLE staging_batches ADD COLUMN completed_at INTEGER;

-- A file is obsolete once an instance it was made for is. That is worked out from its batches;
-- this keeps it when those instances are deleted.
ALTER TABLE files ADD COLUMN obsoleted_at INTEGER;

-- An instance sent back out of a batch after its file was made, kept as a record.
CREATE TABLE staging_batch_removals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL,
  batch_id INTEGER NOT NULL REFERENCES staging_batches(id) ON DELETE CASCADE,
  part_instance_id INTEGER NOT NULL REFERENCES part_instances(id) ON DELETE CASCADE,
  removed_by TEXT NOT NULL,
  removed_at INTEGER NOT NULL
);

CREATE INDEX staging_batch_removals_batch_idx ON staging_batch_removals (batch_id);
CREATE INDEX staging_batch_removals_team_idx ON staging_batch_removals (team_id);

-- A step that left its batch the old way kept the batch's id: one sent back after its batch was
-- completed (recorded as removed), or sent back or finished by hand while its batch was open.
INSERT INTO staging_batch_removals (team_id, batch_id, part_instance_id, removed_by, removed_at)
SELECT s.team_id, s.batch_id, s.part_instance_id, 'migration',
       CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM part_instance_processes s
JOIN staging_batches b ON b.id = s.batch_id
WHERE b.closed_at IS NOT NULL AND s.process_id = b.process_id AND s.status <> 'done';

UPDATE part_instance_processes
SET batch_id = NULL
WHERE batch_id IS NOT NULL
  AND (
    process_id <> (SELECT b.process_id FROM staging_batches b WHERE b.id = part_instance_processes.batch_id)
    OR (status <> 'done' AND batch_id IN (SELECT id FROM staging_batches WHERE closed_at IS NOT NULL))
    OR (status <> 'doing' AND batch_id IN (SELECT id FROM staging_batches WHERE closed_at IS NULL))
  );

-- An open batch with no file takes the file most of its instances were given by hand.
UPDATE staging_batches
SET file_id = (
  SELECT pif.file_id
  FROM part_instance_processes s
  JOIN part_instance_files pif ON pif.part_instance_id = s.part_instance_id
  WHERE s.batch_id = staging_batches.id
  GROUP BY pif.file_id
  ORDER BY COUNT(*) DESC
  LIMIT 1
)
WHERE file_id IS NULL AND closed_at IS NULL;

-- Instances given a file outside any batch become batches: one for each file, File Producer
-- process and status there. (An instance's File Producer step is its first one. Instances that
-- hadn't reached it, or have none, lose the link; the file stays in the library.)
INSERT INTO staging_batches
  (team_id, process_id, file_id, created_by, created_at, closed_at, producer_status)
SELECT s.team_id, s.process_id, pif.file_id, 'migration-0019', MIN(pif.created_at),
       CASE WHEN s.status = 'done' THEN MAX(COALESCE(s.completed_at, pif.created_at)) END,
       s.status
FROM part_instance_files pif
JOIN part_instance_processes s ON s.part_instance_id = pif.part_instance_id
JOIN processes p ON p.id = s.process_id AND p.type = 'file_producer'
WHERE s.batch_id IS NULL
  AND s.status IN ('todo', 'doing', 'done')
  AND s."index" = (
    SELECT MIN(f."index")
    FROM part_instance_processes f
    JOIN processes fp ON fp.id = f.process_id AND fp.type = 'file_producer'
    WHERE f.part_instance_id = s.part_instance_id
  )
GROUP BY s.team_id, s.process_id, pif.file_id, s.status;

UPDATE part_instance_processes
SET batch_id = (
  SELECT b.id
  FROM staging_batches b
  JOIN part_instance_files pif ON pif.file_id = b.file_id
  WHERE b.created_by = 'migration-0019'
    AND pif.part_instance_id = part_instance_processes.part_instance_id
    AND b.team_id = part_instance_processes.team_id
    AND b.process_id = part_instance_processes.process_id
    AND b.producer_status = part_instance_processes.status
)
WHERE batch_id IS NULL
  AND status IN ('todo', 'doing', 'done')
  AND part_instance_id IN (SELECT part_instance_id FROM part_instance_files)
  AND process_id IN (SELECT id FROM processes WHERE type = 'file_producer')
  AND "index" = (
    SELECT MIN(f."index")
    FROM part_instance_processes f
    JOIN processes fp ON fp.id = f.process_id AND fp.type = 'file_producer'
    WHERE f.part_instance_id = part_instance_processes.part_instance_id
  );

UPDATE staging_batches SET created_by = 'migration' WHERE created_by = 'migration-0019';

-- A batch keeps the number it was known by.
UPDATE staging_batches SET number = id WHERE number IS NULL;
CREATE UNIQUE INDEX staging_batches_team_number ON staging_batches (team_id, number);

-- At its File Producer process: complete, in progress (what staging used to mean), or empty.
UPDATE staging_batches
SET producer_status = CASE
  WHEN closed_at IS NOT NULL THEN 'done'
  WHEN EXISTS (
    SELECT 1 FROM part_instance_processes s
    WHERE s.batch_id = staging_batches.id AND s.status = 'doing'
  ) THEN 'doing'
  ELSE 'todo'
END;

-- Where its parts go next: the first File Consumer step after the batch's own.
UPDATE staging_batches
SET consumer_process_id = (
  SELECT c.process_id
  FROM part_instance_processes s
  JOIN part_instance_processes c
    ON c.part_instance_id = s.part_instance_id AND c."index" > s."index"
  JOIN processes p ON p.id = c.process_id AND p.type = 'file_consumer'
  WHERE s.batch_id = staging_batches.id
  ORDER BY c."index"
  LIMIT 1
);

-- At its File Consumer process, from where its parts that are still live have got to there:
-- complete when none is left to do, in progress once any has started, else not started.
UPDATE staging_batches
SET consumer_status = CASE
  WHEN consumer_process_id IS NULL THEN 'done'
  WHEN NOT EXISTS (
    SELECT 1
    FROM part_instance_processes s
    JOIN part_instances i ON i.id = s.part_instance_id AND i.is_stale = 0
    JOIN part_definitions d ON d.id = i.part_definition_id AND d.is_obsolete = 0
    JOIN part_instance_processes c
      ON c.part_instance_id = s.part_instance_id
     AND c.process_id = staging_batches.consumer_process_id
     AND c."index" > s."index"
    WHERE s.batch_id = staging_batches.id AND c.status <> 'done'
  ) THEN 'done'
  WHEN EXISTS (
    SELECT 1
    FROM part_instance_processes s
    JOIN part_instances i ON i.id = s.part_instance_id AND i.is_stale = 0
    JOIN part_definitions d ON d.id = i.part_definition_id AND d.is_obsolete = 0
    JOIN part_instance_processes c
      ON c.part_instance_id = s.part_instance_id
     AND c.process_id = staging_batches.consumer_process_id
     AND c."index" > s."index"
    WHERE s.batch_id = staging_batches.id AND c.status IN ('doing', 'done')
  ) THEN 'doing'
  ELSE 'todo'
END
WHERE producer_status = 'done';

UPDATE staging_batches
SET completed_at = COALESCE(
  (
    SELECT MAX(c.completed_at)
    FROM part_instance_processes s
    JOIN part_instance_processes c
      ON c.part_instance_id = s.part_instance_id
     AND c.process_id = staging_batches.consumer_process_id
     AND c."index" > s."index"
    WHERE s.batch_id = staging_batches.id
  ),
  closed_at
)
WHERE producer_status = 'done' AND consumer_status = 'done';

CREATE INDEX staging_batches_consumer_idx ON staging_batches (consumer_process_id, consumer_status);

DROP TABLE part_instance_files;
