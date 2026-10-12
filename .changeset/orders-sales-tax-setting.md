---
"@g3/worker-orders": major
---

Mentors set the team's default sales tax rate on Settings: a new order's tax starts at that percent of its items, except at tax-exempt vendors. It was 8.9% for every team; a team that hasn't set one now starts at 0%. Apply migration 0020_sales_tax.sql before deploying, which keeps the site team's 8.9%.
