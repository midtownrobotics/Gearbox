---
"@g3/worker-scouting": patch
---

Every answer on a scouting form takes 0. A rating of 0, a choice named "0", a selection including it and a note reading "0" were all refused as if the field were blank; a robot that did nothing is now recorded as doing nothing. Each field still needs an answer, and says so instead of blaming 0.
