---
title: Network and blocking
summary: Data used by each device and site, the monthly cap, blocklists and exceptions. For admins.
order: 1
pages: /network /network/clients /network/clients/:mac /network/controls /network/sites /network/sites/:site
---

## Usage

**Overview** shows the shop's data use for the billing cycle, against the cap, with where it's heading. Pick any range of days; click a day on a chart to see its hours. **Clients** is each device, with who's online now. **Sites** is each site, across all devices or one; admins also see the top sites for the dates picked on **Overview**, so click a day to see that day's.

Usage is kept by hour for two weeks and by day after that. Site data is kept by hour for 30 days, then by day for a year.

## The data cap

Admins set the cap (in GB) and the day of the month each billing cycle starts at the bottom of **Overview**. Leave the cap at zero for none.

## Blocking

On **Controls**:

- **Blocklists:** lists of sites to block or slow down. Switch on **Enforce blocklists** to apply them.
- **Exceptions:** a device that may get past them, for the rest of the day or longer.
- **DNS hardening** stops devices getting around the blocklists with encrypted DNS or iCloud Private Relay.

Changes show as pending until the box has applied them. The box keeps enforcing while it's offline.
