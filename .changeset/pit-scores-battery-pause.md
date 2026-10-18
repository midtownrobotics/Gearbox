---
"@g3/worker-pit": major
"@g3/worker-schedule": minor
---

Pit's Monitor keeps the team's played matches in its match list, with the blue and red scores and a green W or red L in place of the time; the list opens at the next match. On a wide screen the Monitor fits the window: the match list and the checklists scroll on their own, with the column names and the overall progress bar kept at the top. The Batteries page has Pause All and Unpause All, which stop and restart every battery's timer without changing any battery's state. On the days of a published Schedule event, the timers go back to zero and pause when the first day opens, pause when each day closes, and carry on when the next day opens. Deployers: apply Pit's migration 0018 first, and deploy Schedule with Pit (Pit's new `SCHEDULE` service binding).
