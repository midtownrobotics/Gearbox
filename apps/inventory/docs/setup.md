---
title: Set up Inventory
summary: Make your locations, robots, subsystems and fields, by hand or from a setup file. For admins.
order: 0
pages: /admin
access: admin
---

A new team's Inventory is empty: how it's arranged is up to you. Do this on [Admin](team:inventory/admin).

## Checklist

- [ ] Make your **locations**: up to four levels, such as Shop › Cabinet A › Drawer 3 › Bin 2
- [ ] Add your **robots** ("2026 Comp", "2026 Practice") and **subsystems** ("Drivetrain", "Intake")
- [ ] Add any **fields** you want on every entry: a material, a size, a datasheet link
- [ ] Or start from the **starter setup** and change it to fit
- [ ] Add your first entries, or let them come in from [Orders](#parts-from-orders)

## Locations

- **Add top-level locations:** type several names, one on each line. Names already there are skipped.
- **Add inside** a location to put new ones in it, up to four levels deep.
- **Edit** a location to rename it, or choose another location it's **Inside**. Moving it takes everything inside it along.
- Drag a location by its handle to put it in order among the ones beside it. Arrow keys work too.
- **Delete** removes a location you no longer use.

Members give locations a short description on the Locations page, such as "Misc. electronics". It then shows with the name everywhere: "A1 - Misc. electronics".

## Robots and subsystems

The robots and subsystems parts can be checked out onto. Add them, **Rename** them, or **Delete** one you no longer need.

## Fields

Fields are what your team records about each entry besides its name, quantity and location. **Add a field** and choose its kind: text, paragraph, number, choice (with its choices, one on each line), checkbox, link or date. Turn on **Show as a column in the main table** for the ones you want to see at a glance. Deleting a field removes it from every entry.

## Setup files

A setup file holds your fields, locations, robots and subsystems, without your parts, so you can copy your arrangement between seasons or teams. Under **Setup file**:

- **Save to a file** downloads your current setup.
- **Load the starter setup** brings in the one that comes with Inventory.
- Load a file of your own. You see what it would add before anything changes.

Loading only adds what's missing, matched by name: nothing is changed or removed.

## Parts from Orders

If your team uses Orders, parts can go into Inventory as they're received: whoever marks a delivery received says where it goes. A mentor can make that required in Orders' Admin page. Orders' section, next, covers deliveries.
