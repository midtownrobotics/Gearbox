---
title: Set up Orders
summary: Money settings, budget categories, vendors and who can edit the catalog.
order: 0
pages: /admin
access: mentor
---

Do these as a mentor, before members start requesting.

## Checklist

- [ ] On [Admin](team:orders/admin), under **Money and calendar**: your currency, the month your fiscal year starts, and your usual sales tax rate
- [ ] On [Budget](team:orders/budget): add your budget categories ("Drivetrain", "Electrical", "Tools") and give each this year's budget
- [ ] On [Vendors](team:orders/vendors): add the vendors you buy from most, with free-shipping thresholds, minimums, lead times and whether you're tax-exempt there
- [ ] Choose a few **trusted students** on Admin to look after the catalog
- [ ] Connect [Share-A-Cart](#share-a-cart) if you order from Amazon
- [ ] If you use [Inventory](/inventory), decide whether received parts must go into it
- [ ] Tell members where to request parts: [New Request](team:orders/catalog)

## Money and calendar

- **Currency** is used for every price and total.
- **Fiscal year starts in** sets when budgets roll over. Spending counts in the year an order was placed.
- **Default sales tax rate** is the tax a new order starts with on Carts, as a percent of its parts. Vendors marked tax-exempt start with none.

## Request names

Requests get a name from a template. The default is `{vendor} {sku} – {title}`, so a request reads like "WCP WCP-0123 – 1/2" Hex Bearing". Change it under **Request names**.

## Budget category guesses

When someone requests a part, Orders guesses its budget category: the category it was bought under last time, else the vendor's default, else keywords you set here ("bearing" → Drivetrain). Guesses are marked for the requester to check.

## Share-A-Cart

Share-A-Cart turns a cart of Amazon parts into one link that fills an Amazon cart. Under **Share-A-Cart** on Admin, choose **Connect the team's Share-A-Cart account** and sign in to it. Then the Carts page offers a one-click cart for Amazon orders. Shopify stores (WCP, The Thrifty Bot and others) get one-click carts without connecting anything.

## Receiving and Inventory

With Inventory on, people marking parts received can say where they're going. Turn on **Require a place in Inventory when marking parts received** under **Receiving and Inventory** if every delivery must go into Inventory.

## Part lookup

When someone pastes a link, Orders fills in the part's name, price and number from the vendor. It does this on its own for REV and for stores on Shopify: WCP, AndyMark, The Thrifty Bot, CTRE, Swerve Drive Specialties, Swyft, Last Anvil, Limelight, Armabot and most other robot part stores. Other sites, such as Amazon, McMaster-Carr and DigiKey, need your team's Edge box (Edge, the last app in these docs). Without one, requesters type those parts' details in.
