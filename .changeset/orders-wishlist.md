---
"@g3/worker-orders": major
---

New Wishlist tab: anyone adds parts the team would like one day, edits or removes them, and promotes one to a request (it becomes their request). Wishlist parts stay off the Requests page, budgets and lists. Apply migration 0019_wishlist.sql (it rebuilds order_requests to allow the new status) before deploying.
