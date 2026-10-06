-- Budgets per fiscal year (July–June; fiscal_year = the starting year, 2026 = July 2026–June 2027).
CREATE TABLE category_budgets (
  category_id INTEGER NOT NULL REFERENCES budget_categories(id),
  fiscal_year INTEGER NOT NULL,
  budget_cents INTEGER NOT NULL,
  PRIMARY KEY (category_id, fiscal_year)
);
-- Existing budgets become the current fiscal year's.
INSERT INTO category_budgets (category_id, fiscal_year, budget_cents)
SELECT id,
       CAST(strftime('%Y', 'now') AS INTEGER) - (CAST(strftime('%m', 'now') AS INTEGER) < 7),
       budget_cents
FROM budget_categories WHERE budget_cents IS NOT NULL;

-- Vendor profiles, keyed by the lowercased vendor name used on requests.
CREATE TABLE vendors (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tax_exempt INTEGER NOT NULL DEFAULT 0,
  tax_exempt_expires INTEGER,
  team_account_login INTEGER NOT NULL DEFAULT 0,
  free_shipping_cents INTEGER,
  typical_shipping_cents INTEGER,
  minimum_order_cents INTEGER,
  lead_time_days INTEGER,
  shipping_days INTEGER,
  order_cutoff TEXT,
  payment_method TEXT,
  account_owner TEXT,
  notes TEXT,
  default_category_id INTEGER REFERENCES budget_categories(id),
  updated_at INTEGER NOT NULL
);

-- Vouchers, store credit and sponsor discount codes, per vendor.
CREATE TABLE vendor_credits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('voucher', 'credit', 'discount')),
  label TEXT NOT NULL,
  code TEXT,
  balance_cents INTEGER,
  expires_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX vendor_credits_vendor_idx ON vendor_credits (vendor_key);

ALTER TABLE order_requests ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'
  CHECK (priority IN ('blocking', 'high', 'normal', 'nice'));
ALTER TABLE order_requests ADD COLUMN need_by INTEGER;
