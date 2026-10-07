---
"@g3/worker-inventory": major
"@g3/worker-orders": major
"@g3/worker-portal": patch
"@g3/worker-platform": patch
---

Inventory is a new app: everything your team owns, how many, and where. Parts are in storage at a location (a tree of places, up to four levels deep) or in use on a robot's subsystem, with Check out and Check in to move them between the two. Quantities and locations are changed right in the main table. Each entry has its own page with your team's fields, the vendor listings it's bought as (linked to the Orders catalog, with product page, price and a Request button), and a history of everything done to it. Mentors can merge equivalent parts into one entry and split them again. Admins set up fields, locations, robots and subsystems on Settings, or load them from a setup file.

Orders: marking parts received now asks where they go in Inventory (a storage location, or in use on a robot) and adds them there. A new switch on Orders' Settings makes that required; it's off to begin with, and parts received without it don't appear in Inventory.

Inventory: a Locations page shows every location as a panel that opens, with what's kept in it. From there you can move an entry, or everything in a location, in one go, and give a location a title that says what belongs there ("A1 - Misc. Electronics"), which then shows beside its name everywhere.

Orders: when marking parts received, each part has its own place in Inventory. It starts as where Inventory already keeps that part, or else where it went the last time it was received.

Orders: requests and catalog parts have a "Pack of" number, for things sold several to a unit. A pack of 4 is still ordered and budgeted as 1, and arrives in Inventory as 4 parts. New Request fills it in from the catalog, or guesses it from the product's name for you to check.

Orders: anyone signed in can now mark parts received on the Receiving page, not only mentors and whoever asked for the part. Approving and placing orders are still for mentors.

Orders: name and category suggestions on New Request no longer fail for long product links.

Before deploying: create Inventory's database, apply its migration and deploy its worker first. Orders' worker now binds to it and won't deploy until it exists (see docs/deploy.md). Apply Orders' new migrations (0016 and 0017) and Inventory's second (0002) before deploying them.
