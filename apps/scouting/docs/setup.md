---
title: Set up Scouting
summary: Set the event and its keys, edit your forms, and choose strategy leads and the service crew.
order: 0
pages: /admin
access: admin
---

## Checklist

- [ ] Get a [read API key from The Blue Alliance](https://www.thebluealliance.com/account) for your team
- [ ] On [Admin](team:scouting/admin), under **Event Configuration**: the **TBA Event Key** (such as `2026gacmp`) and your **TBA Auth Key**
- [ ] If the event uses Nexus, its **Nexus Event Key** and your **Nexus API Key**
- [ ] Choose your **strategy leads** on Admin
- [ ] Choose the **service crew** (Service tickets, later in this section, explains them)
- [ ] Look over the match and pit forms on [Scouting Forms](team:scouting/), edit their questions for this year's game, and hide any you won't use
- [ ] Decide whether to turn on points and predictions (Points and predictions, at the end of this section)

## Event Configuration

The event key tells Scouting which matches to assign. The keys are your team's own, saved for your team only, and never shown again; **Configured** means one is saved. Choose **Update event** to save.

- **Move on after a match (seconds):** how long scouts have after a match is scored before their form moves to the next one. 120 unless you change it; anything from 0 to 1800.
- **Accept late reports for (seconds):** how long after that a report that missed the move can still be sent. It goes to its own match, marked late. 600 (10 minutes) unless you change it.

## Strategy leads

Strategy leads run Scouting like its admins: they edit forms, see every page, and move the event along. Choose a member under **Strategy lead** on Admin to add one. Points and predictions stay with your team's admins.

## The service crew

The crew gets a chat message for every robot breakdown someone reports. Admins choose them on **Service Tickets**, under **Approved service helpers**.

## Forms

Scouting Forms has **Match scouting** and **Pit scouting**, and each can have several forms, each with its own name: a main match form and a "Driver ratings" form, say. Choose **New match form** or **New pit form** to add one, and **Edit** on one to change it: its **Form name**, and its questions. Add questions, drag them into order, and delete the ones you don't need. A question can be:

- **Counter**, with a minimum, maximum and how much each tap adds (1, 5, 10 or 20)
- **Slider**
- **Multiple choice** or **Multiple select**, with the choices separated by commas. A short list shows as buttons, one tap each.
- **Text entry**, short or long
- **Field map drawing**, for an auto path

**Hide from scouts** takes a form off scouts' list without deleting it; **Show to scouts** puts it back. Hidden forms, and the reports already sent with them, stay for strategy leads and admins. Scouts fill in every visible match form for their team before moving on to the next match.

Change forms before an event: reports already in keep the answers they were given.

## When the schedule isn't online

Scouting reads the match schedule from The Blue Alliance. For an off-season event, a practice day or a scrimmage, use one of your own:

1. Under **Match schedule** on Admin, choose **Switch to all-manual mode**, and give the competition's name and the day it ends.
2. Add the matches: type them into the table (**Add match**), or upload the printed schedule's pages, photos or a spreadsheet (**Take a photo** on a phone) and choose **Scan selected pages**. Nothing goes live until you've checked it.
3. Under **Advanced CSV and team names** you can paste the schedule as text, one match per line (match, time, red 1–3, blue 1–3), and teams' names.
4. Choose **Save manual schedule**.

With a manual schedule, a strategy lead moves everyone from match to match on Admin (Strategy tools, later in this section). The schedule is deleted three days after the competition ends. **Switch back to TBA mode** deletes it straight away. Scouting reports are kept either way.
