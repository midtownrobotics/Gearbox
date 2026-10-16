---
"@g3/worker-shop": major
---

Batches are tracked as one unit. A batch is not started, in progress or complete at its File Producer process and then at its File Consumer process, and its parts move with it. It has a name you can change, a detail view of its own (its file, its parts and where they are), a Send back button for a part that failed, and Duplicate batch. A file now reaches parts only through a batch, a part can go through a File Producer process without one, and the Files page groups files and drawings by progress. A File Consumer process must come after the File Producer process in a part's processes. Run migration `0019_batches.sql` before deploying: files assigned straight to instances become batches.
