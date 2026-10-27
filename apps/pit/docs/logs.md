---
title: Match logs
summary: Copy the robot's AdvantageKit logs off the roboRIO after each match, and keep them in Pit.
order: 4
pages: /logs /logs/advantagescope
---

The **pit log downloader** is a small program for a laptop in the pit (Windows, macOS or Linux). When the laptop joins the robot's network, it copies the robot's AdvantageKit match logs off the roboRIO, names them by match, and uploads them to Pit whenever it's online.

## Set it up

1. On [Logs](team:pit/logs), follow the setup steps for the laptop's system.
2. A mentor or admin gets a **6-digit pairing code** on the same page. It works once, for 10 minutes.
3. On the laptop, the downloader's page asks for your team number, the code and a name for the computer.

The laptop now shows up on Logs. To stop it, remove it there.

To update the downloader, stop it (Ctrl+C), run `git pull` in its Gearbox folder, and start it again.

## The logs

Logs lists every log by event, for anyone signed in to download. Admins delete them.

- Each team keeps at most 20 logs. On Logs, choose what happens when you're full: **Don't save new ones** (the default), or **Delete the oldest**.
- A log over 40 MB (compressed) waits on the laptop until it's trimmed. The downloader's page can trim a log to the part you need, and suggests from just before the robot was first enabled to just after it was last disabled. The file on the laptop is never cut.
- **Export and delete all** downloads everything as one zip, then offers to delete them.

## AdvantageScope

**Open AdvantageScope** on Logs, or **Open in AdvantageScope** beside a log, opens Mechanical Advantage's AdvantageScope in Pit, with your team's match logs to choose from at the top. Its layout is saved for the whole team. It can't connect to the robot live: use the Driver Station's AdvantageScope for that.

- **Save all to this device** keeps AdvantageScope and every log on this computer or tablet, so they open without a connection at an event. Logs you've opened are kept too, marked **On this device**.
- **AdvantageScope assets** lists the fields and robot models your team uploaded in AdvantageScope (**File** › **Upload Asset**). Mentors and admins upload and remove them, up to 100 MB in all.

This is in beta.
