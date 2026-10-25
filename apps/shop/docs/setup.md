---
title: Set up Shop
summary: Add your processes, connect Onshape, choose chat channels and set up shop screens. For admins.
order: 0
pages: /admin
---

## Checklist

- [ ] On [Admin](team:shop/admin), add your **processes**: the machines and steps parts go through
- [ ] Add your **subsystems**
- [ ] [Connect Onshape](#connect-onshape), so releases come in by themselves
- [ ] Choose the [chat channels](#chat-channels) for releases and the daily summary
- [ ] Turn on [kiosk mode](#shop-screens) on the shop's computers
- [ ] If your team has an Edge box with a printer (Edge, the last app in these docs), try printing a drawing

## Processes

A process is a step a part can go through: "Router", "Mill", "Lathe", "Deburr", "3D printer". Order them as they usually happen. Each is one of three kinds:

- **Regular:** someone does it and marks it done.
- **File producer:** makes a file, such as CAM or slicing.
- **File consumer:** uses one, such as a CNC router or a 3D printer.

A part that uses files needs both kinds, with the producer first. Batches and files, later in this section, covers them.

## Connect Onshape

Under **Onshape Configuration**:

1. In Onshape's Developer Portal, make an API key for your team's Onshape company. Enter its **API access key** and **API secret key**, and the portal's **webhook signing keys** (primary and secondary).
2. Enter your **Company ID** and the **Document ID** of the robot's document. Add the **Main Assembly ID** if you want quantities from its bill of materials.
3. Save. Shop registers its webhook on the document and says whether Onshape accepted it. If Onshape refused it, check the keys and the company.

From then on, each approved release in that document shows up on Ingest. Saved keys are never shown again; leave a key blank to keep it.

## Chat channels

Choose the channel where new Onshape releases are posted, and the one for the daily summary of what the shop finished. The picker warns you if the bot can't post there.

## Shop screens

On a shop computer, open Shop's Admin page and choose **Enable kiosk mode on this device**. The computer then stays on the Shop Floor, with no menu to the rest of Gearbox. Pair it with a [kiosk device](/portal/kiosks) so people sign in with their PIN.

## Shop status

The Shop Floor's overview names how busy the shop is by how many parts are in the queue, from "Mooing Cow 🐮" to "Ash 🔥". Change the words, and the number of parts each one starts at, under **Shop Status** on Admin.

## Extra part information

Turn on **Require additional part information (material + thickness) at ingest** if you want every part's stock recorded before it goes to the shop.
