---
"@g3/worker-orders": patch
"@g3/worker-inventory": patch
"@g3/worker-pit": patch
"@g3/worker-shop": patch
"@g3/worker-g3id": patch
"@g3/worker-portal": patch
"@g3/worker-edge": patch
---

Names are the same across the apps. An app's settings page is called Admin: Orders' and Inventory's Settings pages are now Admin (old links still open them), and Shop's Admin is last in its bar. Every "Log in" and "Log Out" is now "Sign in" and "Sign out". A page's title matches its link in the top bar: Pit's Editor is Edit Checklists and its admin page is titled Admin; ID's Dash is Account, its Kiosk Devices page is titled that, and its Attendance admin page is Attendance; Portal's Manage Apps and Appearance; Edge's Overview and Drive.

Fixes: in Pit, card headings that couldn't be read, error messages that were a dark block in light mode, and checklist progress bars that were red until complete (they are your team's color now). In Pit, Shop and Portal, pages no longer scroll a little when they have nothing to scroll. In ID, revoking a kiosk asks first. In Orders and Inventory, dates follow your own language. Inventory's search and filters stay when you reload or go back.
