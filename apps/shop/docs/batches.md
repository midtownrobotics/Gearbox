---
title: Batches and files
summary: Group parts that share one CAM or slicer file, and move them through together.
order: 3
pages: /files
---

A **batch** is a set of parts made from one file: a sheet of plates cut together on the router, a plate of 3D prints. It goes through two processes as one:

1. **The file producer** (CAM, slicing): someone makes the file and attaches it.
2. **The file consumer** (the router, the printer): the parts are made from it.

## Make a batch

At a file producer process on the Shop Floor, **Stage** parts into a batch. Only parts headed for the same next process can share one. **Unstage** takes one out again. A batch gets a name, or one is made from its part and count ("Side Plate × 4").

Once the batch has moved on, parts don't join or leave it that way: send the whole batch back, or send one part back to start again.

## Files

The [Files](team:shop/files) page lists every file by its batches' progress: not started, in progress, complete, unused and obsolete. A file is **obsolete** once a part it was made for has changed in a newer release; it can't go on a new batch.

To clear out old files and drawings, tick the box by each one and choose **Delete selected**, or, in **Complete**, **Unused** and **Obsolete**, the box by the group's name to choose all of it. **Complete** and **Obsolete** also have **Delete all**. Deleting can't be undone, and a batch that had a deleted file has none. Shop computers in kiosk mode can't delete.

**Duplicate** a batch to make the same parts again from the same file.
