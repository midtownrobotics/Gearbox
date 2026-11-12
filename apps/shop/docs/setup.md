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
- [ ] If parts should be checked before they're done, set up [quality control](#quality-control)
- [ ] If your team has an Edge box with a printer (Edge, the last app in these docs), try printing a drawing

## Processes

A process is a step a part can go through: "Router", "Mill", "Lathe", "Deburr", "3D printer". Order them as they usually happen. Only admins add and remove them. Each is one of four kinds:

- **Regular:** someone does it and marks it done.
- **File producer:** makes a file, such as CAM or slicing.
- **File consumer:** uses one, such as a CNC router or a 3D printer.
- **Quality Control:** checking a finished part. Only shop managers and admins mark it complete (see [quality control](#quality-control)).

A part that uses files needs both file kinds, with the producer first. Batches and files, later in this section, covers them.

## Removing a subsystem or process

Choose **Remove** beside one you no longer use, such as a typo or an old machine. If nothing uses it, it's deleted. If parts do, it's hidden from new parts (Ingest, Add Part, a part's processes), and parts that already have it keep it. The Shop Floor still shows a removed process while parts are at it.

Switch on **Show removed** to see removed ones and **Restore** them. The required quality check can't be removed while it's required. Removing and restoring are in the team's log.

## Quality control

Under **Quality Control** on Admin:

- **Shop Managers:** the members who sign parts off at a Quality Control process, besides admins. A kiosk PIN sign-in doesn't carry anyone's admin role, so add your admins here too if they check parts at a kiosk.
- **Require Quality Control:** pick a Quality Control process to go at the end of every new part's processes, so nothing finishes without a shop manager's sign-off. Parts already being made keep the steps they have.
- **Quality reports:** with this on, a shop manager finishes a Quality Control step by filling in a report against the part's drawing. Every report is listed here, with search and filters.
- **Checklist:** the lines a report checks, from 1 to 20 ("Part is the proper thickness"). Change them, **Add a line**, and **Save checklist**. A report passes only when every line is checked.

## Connect Onshape

Under **Onshape Configuration**:

1. In Onshape's Developer Portal, make an API key for your team's Onshape company. Enter its **API access key** and **API secret key**, and the portal's **webhook signing keys** (primary and secondary).
2. Enter your **Company ID** and the **Document ID** of the robot's document. Add the **Main Assembly ID** if you want quantities from its bill of materials.
3. Save. Shop registers its webhook on the document and says whether Onshape accepted it. If Onshape refused it, check the keys and the company.

From then on, each approved release in that document shows up on Ingest. Saved keys are never shown again; leave a key blank to keep it.

## Onshape API usage

Every call Shop makes to Onshape with your keys counts toward your Onshape plan's API allowance. **Onshape API Usage** on Admin shows how many calls Shop has made over the last 7 days, 30 days, 12 months or all time, which kinds of calls they were (reading a release, downloading a drawing, and so on), and the latest calls that failed with what Onshape said. **Check connection** tries your keys once.

The numbers are for the API keys saved now: saving new keys starts their count from zero. Once you've switched keys, choose **All API keys** to see the old keys' calls too.

While Shop has no Onshape API keys, or Onshape is refusing its calls (keys not accepted, the API limit reached, Onshape down), every Shop page shows a red banner under the top bar. It goes away by itself once a call to Onshape works again.

## Chat channels

Choose the channel where new Onshape releases are posted, and the one for the daily summary of what the shop finished. The picker warns you if the bot can't post there.

## Shop screens

On a shop computer, open Shop's Admin page and choose **Enable kiosk mode on this device**. The computer then stays on the Shop Floor, with no menu to the rest of Gearbox. Pair it with a [kiosk device](/portal/kiosks) so people sign in with their PIN.

## Shop status

The Shop Floor's overview names how busy the shop is by how many parts are in the queue, from "Mooing Cow 🐮" to "Ash 🔥". Change the words, and the number of parts each one starts at, under **Shop Status** on Admin.

## Extra part information

Turn on **Require additional part information (material + thickness) at ingest** if you want every part's stock recorded before it goes to the shop.
