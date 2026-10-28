---
title: The Shop Floor
summary: Start, finish and send back parts at each process. For everyone in the shop.
order: 1
pages: /board /board/process/:processId
---

The [Shop Floor](team:shop/board) shows one process at a time, with what's **ready to start**, **in progress** and what's coming next.

- **Start** a part when you begin work on it.
- **Mark as complete** when you're done. It moves on to its next process.
- **Send back** a part that needs redoing. It asks which status to move it back to.
- **Scan a drawing:** scan the barcode on a printed drawing to open its part.

Parts marked as priority show first.

**Switch to details view** on a part, or open one from the Parts page, for everything about it. **Open in Onshape** opens the part at that revision, and **Release** the release it came from.

## Quality control

At a Quality Control process, only a shop manager or an admin can mark a part complete. Others see **Needs a shop manager**.

If your team uses quality reports, **Start quality report** opens the part's drawing beside its checklist. Check every line that the part meets (a line that doesn't apply is checked anyway), and add notes.

- Every line checked: **Pass Part**, and the part is done.
- A line not checked: pick the step the mistake likely happened at (or **Unsure**), then **Report Problem**. Then choose **What now?**:
  - **Send it back** to a step: it's made through the rest of its steps again.
  - **Fix it**: send it to a step with a note on the part saying what to do. The step can be one the part doesn't have yet, such as sanding. Then **Send to Fix**.
  - **Start over**: this one becomes obsolete and a new one starts at the first step (**Obsolete and Start Over**).
  - Or **Leave it at** the check **for now**: it waits there, and is checked again with a new quality report.

Admins see every report on Shop's Admin page.

## Printing drawings

If your team has an Edge box with a printer, a part's drawing has a Print button. Without one, download the drawing and print it yourself.
