"""Finds real product links for the catalog's FRCDesign items, from this machine (run once).

The library export's links are often a vendor homepage, a search page, or a guess. This script
downloads each vendor's own product list and matches items by part number (then, for items without
one, by name), and writes a migration that updates the items by their FRCDesign record id:

    cd workers/orders
    npx wrangler d1 execute ORDERS_DB --local --json \\
        --command "SELECT id, vendor, sku, name, url, link_kind, source_id FROM catalog_items WHERE source = 'frcdesign'" \\
        > /tmp/catalog-items.json
    python3 scripts/catalog-relink.py /tmp/catalog-items.json /tmp/catalog-cache \\
        > src/db/migrations/0012_catalog_links.sql

Downloads are cached in the cache folder. Sources:
  - Shopify stores (WCP, AndyMark, Thrifty Bot, SDS, CTRE, Last Anvil, Redux, ARMABOT):
    /products.json, every variant with its SKU. REV packs ("-PK4") match the part number.
  - REV (BigCommerce): the storefront GraphQL API with the token every page embeds.
  - SWYFT (custom site): its sitemap's product pages, by where each part number appears most.
80/20 refuses scripted requests, and McMaster's part-number links are
already right; McMaster items with no part number ("null") are deleted, as they have no link.
"""

import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

def _site_value(key):
    """A value from packages/site-config/src/site.ts (the team's name and domain live there)."""
    text = (Path(__file__).resolve().parents[3] / "packages/site-config/src/site.ts").read_text()
    return re.search(rf'{key}: "([^"]+)"', text).group(1)


UA = f"{_site_value('name').replace(' ', '')}Catalog/0.1 (+https://{_site_value('domain')})"

SHOPIFY = {
    "West Coast Products": "wcproducts.com",
    "AndyMark": "andymark.com",
    "The Thrifty Bot": "www.thethriftybot.com",
    "Swerve Drive Specialties": "www.swervedrivespecialties.com",
    "CTR Electronics": "store.ctr-electronics.com",
    "Last Anvil Innovations": "lastanvil.com",
    "Redux Robotics": "shop.reduxrobotics.com",
    "ARMABOT": "www.armabot.com",
}


def get(url, data=None, headers=None, tries=5):
    for attempt in range(tries):
        try:
            req = urllib.request.Request(
                url, data=data, headers={"User-Agent": UA, **(headers or {})}
            )
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < tries - 1:
                time.sleep(10 * (attempt + 1))
                continue
            raise


def cached(cache, name, fetch):
    path = os.path.join(cache, name)
    if not os.path.exists(path):
        with open(path, "w") as f:
            json.dump(fetch(), f)
    with open(path) as f:
        return json.load(f)


def shopify_products(host):
    products, page = [], 1
    while True:
        batch = json.loads(get(f"https://{host}/products.json?limit=250&page={page}"))["products"]
        if not batch:
            return products
        products += batch
        page += 1
        time.sleep(1.5)


REV_QUERY = """query($after: String) { site { products(first: 50, after: $after) {
  pageInfo { hasNextPage endCursor }
  edges { node { entityId name path sku defaultImage { url(width: 500) }
    variants(first: 100) { edges { node { entityId sku
      options { edges { node { displayName values { edges { node { label } } } } } } } } } } } } } }"""


def rev_products():
    html = get("https://www.revrobotics.com/").decode()
    token = re.search(r'graphQLToken\\?"\s*:\s*\\?"([^"\\]+)', html).group(1)
    products, after = [], None
    while True:
        body = json.loads(
            get(
                "https://www.revrobotics.com/graphql",
                data=json.dumps({"query": REV_QUERY, "variables": {"after": after}}).encode(),
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
            )
        )
        page = body["data"]["site"]["products"]
        products += [e["node"] for e in page["edges"]]
        if not page["pageInfo"]["hasNextPage"]:
            return products
        after = page["pageInfo"]["endCursor"]
        time.sleep(1)


def check_links(items):
    """Where each product link really goes: AndyMark's /<part number> links redirect to the
    product; dead ones answer 404."""
    out = {}
    for item in items:
        try:
            req = urllib.request.Request(item["url"], headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                out[item["source_id"]] = [r.status, r.geturl()]
        except urllib.error.HTTPError as e:
            out[item["source_id"]] = [e.code, item["url"]]
        except Exception as e:  # noqa: BLE001 - unreachable counts as unknown
            print(f"couldn't check {item['url']}: {e}", file=sys.stderr)
        time.sleep(1.2)
    return out


def swyft_pages():
    sitemap = get("https://swyftrobotics.com/sitemap.xml").decode()
    pages = {}
    for url in re.findall(r"<loc>([^<]+)</loc>", sitemap):
        path = url.replace("https://swyftrobotics.com", "")
        # Product pages are two levels deep (/motion/bearings); machines are a separate shop.
        if path.count("/") != 2 or path.startswith("/machines/"):
            continue
        try:
            pages[path] = get(url).decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001 - a missing page just matches nothing
            print(f"skipped {url}: {e}", file=sys.stderr)
        time.sleep(1)
    return pages


# --- matching --------------------------------------------------------------

norm_sku = lambda s: re.sub(r"[^A-Z0-9]", "", (s or "").upper())  # noqa: E731
PACK = re.compile(r"PK\d+$")


def sku_candidates(sku):
    """The part numbers a messy cell holds: "am-3227 (Discontinued)", "VH-109 / WCP-1538"."""
    if not sku or sku in ("null", "None"):
        return []
    sku = re.sub(r"\([^)]*\)", " ", sku)
    return [norm_sku(s) for s in re.split(r"\s+/\s+|\s+OR\s+|,", sku) if norm_sku(s)]


def decimal(n):
    return ("%.4f" % n).rstrip("0").rstrip(".")


def tokens(text):
    """Same idea as the app's search: fractions → decimals, units split, quotes dropped."""
    t = text.lower()
    t = re.sub(r"\b(\d+)[- ](\d+)/(\d+)\b", lambda m: decimal(int(m[1]) + int(m[2]) / int(m[3])) if int(m[3]) else m[0], t)
    t = re.sub(r"\b(\d+)/(\d+)\b", lambda m: decimal(int(m[1]) / int(m[2])) if int(m[2]) else m[0], t)
    t = re.sub(r"(^|[^\d.])\.(\d)", r"\g<1>0.\2", t)
    t = re.sub(r"(\d)\s*x\s*(?=[\d.])", r"\1 x ", t)
    t = re.sub(r"(\d)(mm|in|t|ft)\b", r"\1 \2", t)
    words = re.split(r"[\s,;:()\[\]{}\"'#|+/*-]+", t)
    out = set()
    for w in words:
        w = w.strip(".")
        if not w or w in {"x", "in", "the", "for", "with", "and", "of", "a", "l", "od", "id", "wd"}:
            continue
        out.add(decimal(float(w)) if re.fullmatch(r"\d*\.?\d+", w) else w)
    return out


OPPOSITES = [
    ("single", "double"),
    ("left", "right"),
    ("star", "straight"),
    ("upgrade", None),
    ("spare", None),
    ("kit", None),
]


def clean(text):
    """A store's name without what doesn't describe the part: part numbers, pack counts."""
    text = re.sub(r"\((?:REV|WCP|am|TTB)-[^)]*\)", " ", text, flags=re.I)
    return re.sub(r"\b(?:qty\s*\d+|\d+\s*-?\s*(?:pack|pk))\b", " ", text, flags=re.I)


def name_score(name, text):
    """How well a store name matches the item's, or None when it can't be the same part."""
    want, have = tokens(name), tokens(clean(text))
    if not want or not have:
        return None
    numbers = lambda ws: {w for w in ws if re.fullmatch(r"[\d.]+", w)}  # noqa: E731
    # Every number of ours must be there, and no extra dimensions of theirs (0.192" ID ≠ ours).
    if not numbers(want) <= have or any("." in n for n in numbers(have) - numbers(want)):
        return None
    for a, b in OPPOSITES:
        if b is None and a in have and a not in want:
            return None
        if b and ((a in want and b in have) or (b in want and a in have)):
            return None
    cover, back = len(want & have) / len(want), len(want & have) / len(have)
    if cover < 0.75 or back < 0.3:
        return None
    return cover + back / 10


def by_name(name, candidates):
    """The clearly best candidate by name, with its score."""
    scored = sorted(
        ((score, cand) for cand, text in candidates if (score := name_score(name, text)) is not None),
        key=lambda s: -s[0],
    )
    if scored and (len(scored) == 1 or scored[0][0] - scored[1][0] >= 0.05):
        return scored[0][1], scored[0][0]
    return None


def product_key(url):
    """workers/orders/src/lib/catalog.ts productKey()."""
    m = re.match(r"https?://([^/?#]+)([^?#]*)(?:\?([^#]*))?", url)
    host = m[1].lower().removeprefix("www.")
    variant = re.search(r"(?:^|&)variant=([^&]+)", m[3] or "")
    return f"{host}{m[2].rstrip('/').lower()}" + (f"?variant={variant[1]}" if variant else "")


def catalog_key(url, variant_id):
    """workers/orders/src/lib/catalog.ts catalogKey()."""
    key = product_key(url)
    return key if not variant_id or "?variant=" in key else f"{key}?variant={variant_id}"


def index_skus(entries):
    """SKU → entry, plus pack-less SKU → entries (REV sells most parts as -PK packs)."""
    exact, base = {}, {}
    for e in entries:
        s = norm_sku(e["sku"])
        if not s:
            continue
        exact.setdefault(s, e)
        base.setdefault(PACK.sub("", s), []).append(e)
    return exact, base


def find(sku, exact, base):
    """The store entry for a part number: exact, the same part in another pack size, or the one
    store SKU a cut-off part number ("TTB-0010-YELLO") starts."""
    for s in sku_candidates(sku):
        if s in exact:
            return exact[s]
        same = base.get(PACK.sub("", s), [])
        if same:
            pack = lambda e: int((re.search(r"PK(\d+)$", norm_sku(e["sku"])) or [0, 1])[1])  # noqa: E731
            return min(same, key=pack)
        if len(s) >= 8:
            longer = [e for k, e in exact.items() if k.startswith(s)]
            if len(longer) == 1:
                return longer[0]
    return None


def main(items_path, cache):
    os.makedirs(cache, exist_ok=True)
    items = json.load(open(items_path))[0]["results"]

    entries = {}  # vendor → list of {sku, url, variant, platform, image, text}
    for vendor, host in SHOPIFY.items():
        products = cached(cache, f"{host}.json", lambda h=host: shopify_products(h))
        out = []
        for p in products:
            many = len(p["variants"]) > 1
            image = (p.get("images") or [{}])[0].get("src")
            for v in p["variants"]:
                url = f"https://{host}/products/{p['handle']}" + (f"?variant={v['id']}" if many else "")
                vimg = (v.get("featured_image") or {}).get("src") or image
                title = p["title"] + ("" if v["title"] == "Default Title" else f" {v['title']}")
                out.append(dict(sku=v.get("sku"), url=url, variant=str(v["id"]), platform="shopify", image=vimg, text=title, handle=p["handle"]))
        entries[vendor] = out
    rev = cached(cache, "revrobotics.json", rev_products)
    entries["REV Robotics"] = [
        dict(
            sku=v["node"]["sku"] or p["sku"],
            url=f"https://www.revrobotics.com{p['path']}",
            variant=str(v["node"]["entityId"]),
            platform="bigcommerce",
            image=(p.get("defaultImage") or {}).get("url"),
            text=p["name"] + " " + " ".join(
                val["node"]["label"]
                for o in v["node"]["options"]["edges"]
                for val in o["node"]["values"]["edges"]
            ),
        )
        for p in rev
        for v in (p["variants"]["edges"] or [{"node": {"sku": p["sku"], "entityId": p["entityId"], "options": {"edges": []}}}])
    ]
    swyft = cached(cache, "swyft-pages.json", swyft_pages)

    indexes = {v: index_skus(e) for v, e in entries.items()}
    stats = {}
    updates, deletes, unmatched = [], [], []
    named = {}  # store variant → items matched to it by name
    for item in items:
        vendor, sku = item["vendor"], item["sku"]
        stat = stats.setdefault(vendor, {"sku": 0, "name": 0, "none": 0})
        if vendor == "McMaster-Carr":
            if sku in ("null", "None", None):
                deletes.append(item)
            elif sku.lower() not in item["url"].lower():
                # A filtered category page instead of the part's own page.
                url = f"https://www.mcmaster.com/{sku}/"
                updates.append((item, dict(url=url, variant=None, platform=None, image=None)))
                stat["sku"] += 1
            continue
        match = None
        if vendor in indexes:
            match = find(sku, *indexes[vendor])
            if match:
                stat["sku"] += 1
            else:
                found = by_name(item["name"], [(e, e["text"]) for e in entries[vendor]])
                if found:
                    match, score = found
                    named.setdefault((match["url"], match["variant"]), []).append((score, item))
                    stat["name"] += 1
        elif vendor == "SWYFT Robotics" and sku:
            counts = sorted(((html.count(sku), path) for path, html in swyft.items() if sku in html), reverse=True)
            if counts and (len(counts) == 1 or counts[0][0] > counts[1][0]):
                match = dict(url=f"https://swyftrobotics.com{counts[0][1]}", variant=None, platform=None, image=None, sku=sku)
                stat["sku"] += 1
        if not match:
            stat["none"] += 1
            unmatched.append(item)
            continue
        updates.append((item, match))

    # Items still without a match: follow their product link. A redirect to a product page is
    # that page; a dead link becomes the vendor's search for the part number.
    checkable = [
        i for i in unmatched
        if i["link_kind"] == "product" and i["vendor"] not in ("McMaster-Carr", "80/20")
    ]
    checked = cached(cache, "link-check.json", lambda: check_links(checkable))
    searches = []
    for item in checkable:
        code, final = checked.get(item["source_id"], [None, None])
        code = int(code) if code else None
        host = SHOPIFY.get(item["vendor"])
        if code == 200 and final != item["url"] and "/products/" in final:
            variant = re.search(r"[?&]variant=(\d+)", final)
            m = dict(url=final, variant=variant[1] if variant else None, platform="shopify" if host else None, image=None)
            updates.append((item, m))
            stats[item["vendor"]]["redirect"] = stats[item["vendor"]].get("redirect", 0) + 1
            stats[item["vendor"]]["none"] -= 1
        elif code == 404 and host and sku_candidates(item["sku"]):
            first = re.sub(r"\([^)]*\)", "", item["sku"]).split(" / ")[0].split(" OR ")[0].strip()
            searches.append((item, f"https://{host}/search?type=product&q={urllib.parse.quote(first)}"))
            stats[item["vendor"]]["dead"] = stats[item["vendor"]].get("dead", 0) + 1

    # Several items named onto one store variant: only the closest keeps it (the generic
    # "Elevator Bearing Block" isn't the clamping one its specific sibling is).
    for matched in named.values():
        if len(matched) > 1:
            matched.sort(key=lambda m: -m[0])
            for _, loser in matched[1:]:
                updates[:] = [u for u in updates if u[0] is not loser]
                stats[loser["vendor"]]["name"] -= 1
                stats[loser["vendor"]]["none"] += 1
                unmatched.append(loser)

    print("-- Generated by workers/orders/scripts/catalog-relink.py: product links found by part number")
    print("-- (or name) in each vendor's own product list. Items are matched by their FRCDesign record id.")
    q = lambda v: "NULL" if v is None else "'" + str(v).replace("'", "''") + "'"  # noqa: E731
    for item, m in updates:
        sets = [
            f"url = {q(m['url'])}",
            "link_kind = 'product'",
            f"product_key = {q(catalog_key(m['url'], m['variant']))}",
            f"store_platform = {q(m['platform'])}",
            f"store_variant_id = {q(m['variant'])}",
        ]
        if m.get("image"):
            sets.append(f"image = COALESCE(image, {q(m['image'])})")
        if not item["sku"] and m.get("sku"):
            sets.append(f"sku = {q(m['sku'])}")
        print(f"UPDATE catalog_items SET {', '.join(sets)} WHERE source_id = {q(item['source_id'])};")
    for item, url in searches:
        print(
            f"UPDATE catalog_items SET url = {q(url)}, link_kind = 'search', product_key = NULL, "
            f"store_platform = NULL, store_variant_id = NULL WHERE source_id = {q(item['source_id'])};"
        )
    for item in deletes:
        # Requests keep their own details; they just stop pointing at the deleted item.
        print(
            "UPDATE order_requests SET catalog_item_id = NULL WHERE catalog_item_id = "
            f"(SELECT id FROM catalog_items WHERE source_id = {q(item['source_id'])});"
        )
        print(f"DELETE FROM catalog_items WHERE source_id = {q(item['source_id'])};")
    print("-- A link to a vendor's bare homepage isn't a product page, whatever the export called it.")
    print(
        "UPDATE catalog_items SET link_kind = 'homepage', product_key = NULL\n"
        "  WHERE link_kind = 'product' AND instr(substr(url, 9), '/') IN (0, length(substr(url, 9)));"
    )
    print("DELETE FROM catalog_families WHERE id NOT IN (SELECT family_id FROM catalog_items WHERE family_id IS NOT NULL);")

    for vendor, s in sorted(stats.items(), key=lambda kv: -sum(kv[1].values())):
        print(
            f"{vendor:26} part number {s['sku']:4}  name {s['name']:3}  redirect {s.get('redirect', 0):3}"
            f"  dead→search {s.get('dead', 0):3}  unchanged {s['none'] - s.get('dead', 0):4}",
            file=sys.stderr,
        )
    print(f"deleted (McMaster, no part number): {len(deletes)}", file=sys.stderr)
    with open(os.path.join(cache, "unmatched.json"), "w") as f:
        json.dump(unmatched, f, indent=1)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
