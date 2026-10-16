---
"@g3/worker-shop": major
---

Shop works better on a phone. In a machine's queue, a part's name is now the link that opens it (the Open button is gone), and on a narrow screen the buttons sit on their own row so names and part numbers stay visible. The shop view puts the part's information and buttons under the drawing on a narrow screen. A part's two views link to each other with "Switch to Shop View" and "Switch to Details View", and the details view's top bar no longer lets the drawing show through it.

On the Files page, a file's name gets the whole top row on a narrow screen, with its status and buttons under its details. Assigning a file to a part by number no longer asks for a revision: it always uses the part's most recent one.

An obsolete part's details are now view only: no Files panel and no Add One, Send Back or Edit & Obsolete buttons, and its information shows when it was made obsolete and by whom. A file can no longer be assigned to an obsolete part.

Deployers: apply Shop's migration `0017_obsoleted.sql` before deploying.
