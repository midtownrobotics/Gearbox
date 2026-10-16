-- Friends: members each person picks to see beside them on schedules (the Friends view, and "With"
-- on their own day). Private: only the person who added a friend ever sees it, so the friend isn't
-- told, no page lists who added whom, and the team's data download leaves it out. Not per schedule.
CREATE TABLE friends (
  team_id TEXT NOT NULL,
  -- G3ID user ids: who added the friend, and the friend.
  user_id TEXT NOT NULL,
  friend_id TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  CHECK (user_id <> friend_id),
  PRIMARY KEY (team_id, user_id, friend_id)
);
