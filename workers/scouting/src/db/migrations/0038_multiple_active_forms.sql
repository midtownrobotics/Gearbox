-- Scouts may submit each form once for the same match, with the rule enforced atomically.
DROP TRIGGER scouting_submission_one_per_match;
CREATE TRIGGER scouting_submission_one_per_match
BEFORE INSERT ON scouting_form_submissions
WHEN (SELECT form_kind FROM scouting_forms WHERE team_id = NEW.team_id AND id = NEW.form_id) = 'scouting'
  AND EXISTS (
    SELECT 1 FROM scouting_form_submissions existing
    WHERE existing.team_id = NEW.team_id
      AND existing.form_id = NEW.form_id
      AND existing.submitted_by = NEW.submitted_by
      AND existing.event_key = NEW.event_key
      AND existing.match_number = NEW.match_number
  )
BEGIN
  SELECT RAISE(ABORT, 'one scouting submission per match');
END;
