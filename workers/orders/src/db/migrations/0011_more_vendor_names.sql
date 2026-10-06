-- Vendors the catalog brought in (src/lib/vendors.ts): requests saved with their web address
-- take the same name, so they group with catalog items and vendor profiles.
UPDATE order_requests SET vendor = CASE lower(CASE WHEN lower(trim(vendor)) LIKE 'www.%' THEN substr(trim(vendor), 5) ELSE trim(vendor) END)
  WHEN 'swyftrobotics.com' THEN 'SWYFT Robotics'
  WHEN 'lastanvil.com' THEN 'Last Anvil Innovations'
  WHEN 'reduxrobotics.com' THEN 'Redux Robotics'
  WHEN 'shop.reduxrobotics.com' THEN 'Redux Robotics'
  WHEN 'armabot.com' THEN 'ARMABOT'
  WHEN '8020.net' THEN '80/20'
  ELSE vendor END;
