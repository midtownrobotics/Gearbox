-- The box's public address (as Cloudflare sees its uploads), and when it last changed.
ALTER TABLE edge_status ADD COLUMN public_ip TEXT;
ALTER TABLE edge_status ADD COLUMN public_ip_since INTEGER;
