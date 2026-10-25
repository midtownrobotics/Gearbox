---
title: The Inventory table
summary: Find parts, keep counts right, move them, and check them out to a robot. For every member.
order: 1
pages: /inventory
---

[Inventory](team:inventory/inventory) is one table: a row for each place an entry's parts are, with its location, quantity and whether they're in storage or in use. Your team's own fields can show as columns too.

## Find parts

Search by name, details, vendor or location. Narrow it down with:

- **Status:** In storage and in use, In storage, or In use
- **Location**, and anything inside it
- **Robot:** what's in use on one robot

On a phone, each row is two lines: the entry with its button, then its location, quantity and status.

## Count

Type the real quantity into a row. That records a count, with who and when, in the entry's history.

## Move

Choose a row's location to move its parts somewhere else, all of them or some.

## Check out and check in

- **Check out** puts parts in use on a robot and subsystem: "4 bearings onto the comp bot's swerve". Say how many, and pick the robot and subsystem. The parts stay at their location unless you choose another.
- **Check in** puts them back in storage. It starts with the place the entry is already kept, so parts go back together.

An entry with everything checked out still remembers where it's kept. An entry kept nowhere yet has **Say where it's kept**.
