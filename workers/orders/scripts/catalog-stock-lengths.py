"""Replaces the FRCDesign library's CAD lengths on stock material with what vendors sell (run once).

The library models shafts, tubes, splines and the like at a short preset length ("1/2" Hex Lite
(1" L)"), but vendors sell them as stock: WCP's is ".500" OD Hex Lite Stock (36")". This script
finds each catalog item's product in the vendor's own list (the same downloads as
catalog-relink.py) and writes a migration that, for stock material only:

  - puts the vendor's stock length in the name and the Length option when the product comes in one
    length (36", 47", 4ft, 480mm, ...);
  - removes the CAD length when the vendor sells several lengths (AndyMark) or there's no listing
    to read it from, rather than guess.

Items whose length the vendor really sells (Thrifty Bot's 2" SplineXS) are left alone. Each update
only applies while the item still has the name and options it was seeded with, so edits made in
the app are kept.

    cd workers/orders
    npx wrangler d1 execute ORDERS_DB --env production --remote --json \\
        --command "SELECT id, category, name, vendor, sku, options, store_variant_id, source_id FROM catalog_items WHERE source = 'frcdesign'" \\
        > /tmp/catalog-items.json
    python3 scripts/catalog-stock-lengths.py /tmp/catalog-items.json /tmp/catalog-cache \\
        > src/db/migrations/0015_catalog_stock_lengths.sql
"""

import importlib.util
import json
import re
import sys
from pathlib import Path

_spec = importlib.util.spec_from_file_location("relink", Path(__file__).with_name("catalog-relink.py"))
relink = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(relink)

# Stock material: sold as long lengths you cut yourself. Everything else with a length (bolts,
# standoffs, spacers, couplers) is sold at that length.
STOCK_CATEGORIES = {"Extrusions & Shafts"}
STOCK_SKUS = {"WCP-0543", "WCP-0291"}  # WCP gear rack, sold as 35.5" sticks
LENGTH_KEY = re.compile(r"^length$", re.I)
# Stock lengths are long; anything shorter in a title is a cross-section ("2" x 1"), not a length.
MIN_STOCK_INCHES = 12


def number(text):
    text = text.strip()
    if m := re.fullmatch(r"(\d+)-(\d+)/(\d+)", text):
        return int(m[1]) + int(m[2]) / int(m[3])
    if m := re.fullmatch(r"(\d+)/(\d+)", text):
        return int(m[1]) / int(m[2])
    try:
        return float(text.replace(",", "."))
    except ValueError:
        return None


def inches(value):
    return f'{value:g}"'


def lengths_in(text):
    """Every length a vendor's title states, as (inches, how to write it)."""
    out = []
    for m in re.finditer(
        r'(\d+-\d+/\d+|\d+/\d+|\d+(?:\.\d+)?|\.\d+)\s*(?:"|”|\s?in\b\.?|\s?inch(?:es)?\b)', text, re.I
    ):
        if (n := number(m[1])) is not None:
            out.append((n, inches(n)))
    for m in re.finditer(r"(\d+(?:\.\d+)?)\s*(?:ft\b\.?|foot|feet)", text, re.I):
        out.append((float(m[1]) * 12, inches(float(m[1]) * 12)))
    for m in re.finditer(r"(\d+(?:\.\d+)?)\s*mm\b", text, re.I):
        out.append((float(m[1]) / 25.4, f"{float(m[1]):g}mm"))
    return out


def stock_length(text):
    """The one stock length a title states, or None."""
    long = {label: n for n, label in lengths_in(text) if n >= MIN_STOCK_INCHES}
    return next(iter(long)) if len(long) == 1 else None


# The library writes the CAD length into names as "1" L", "3,0 " L" (SWYFT) and the like.
NAME_LENGTH = re.compile(r'\d+(?:[.,]\d+)?(?:-\d+/\d+|/\d+)?\s*"\s*L\b')


def rename(name, length):
    if length:
        return NAME_LENGTH.sub(f"{length} L", name, count=1)
    name = re.sub(rf"\(\s*{NAME_LENGTH.pattern}\s*,\s*", "(", name, count=1)
    name = re.sub(rf",\s*{NAME_LENGTH.pattern}\s*\)", ")", name, count=1)
    name = re.sub(rf"\s*\(\s*{NAME_LENGTH.pattern}\s*\)", "", name, count=1)
    return name


def listings():
    """Each vendor's products: (vendor, variant id or part number) → (title, lengths it comes in)."""
    found = {}
    for vendor, host in relink.SHOPIFY.items():
        for p in relink.cached(CACHE, f"{host}.json", lambda h=host: relink.shopify_products(h)):
            lengths = {stock_length(v["title"]) for v in p["variants"]} - {None}
            for v in p["variants"]:
                text = p["title"] + ("" if v["title"] == "Default Title" else f" {v['title']}")
                entry = (text, lengths)
                found[(vendor, str(v["id"]))] = entry
                for sku in relink.sku_candidates(v.get("sku")):
                    found[(vendor, sku)] = entry
    for p in relink.cached(CACHE, "revrobotics.json", relink.rev_products):
        for e in p["variants"]["edges"]:
            v = e["node"]
            labels = " ".join(
                val["node"]["label"]
                for o in v["options"]["edges"]
                for val in o["node"]["values"]["edges"]
            )
            entry = (f"{p['name']} {labels}", set())
            found[("REV Robotics", str(v["entityId"]))] = entry
            for sku in relink.sku_candidates(v["sku"] or p["sku"]):
                found[("REV Robotics", sku)] = entry
    return found


def q(value):
    return "'" + value.replace("'", "''") + "'"


def main(items_path):
    items = json.load(open(items_path))[0]["results"]
    found = listings()
    changes = []
    for item in items:
        if item["category"] not in STOCK_CATEGORIES and item["sku"] not in STOCK_SKUS:
            continue
        options = json.loads(item["options"])
        keys = [k for k in options if LENGTH_KEY.match(k)]
        if not keys and not NAME_LENGTH.search(item["name"]):
            continue
        entry = found.get((item["vendor"], str(item["store_variant_id"])))
        for sku in relink.sku_candidates(item["sku"]):
            entry = entry or found.get((item["vendor"], sku))
        text, product_lengths = entry or ("", set())
        # SWYFT has no product list; its part numbers carry the length ("...-0.5in-36in-AL7075").
        if not entry and item["vendor"] == "SWYFT Robotics" and item["sku"]:
            text = item["sku"].replace("-", " ")
        sold = stock_length(text)
        if len(product_lengths) > 1:
            sold = None  # several lengths for sale (AndyMark): none is "the" length
        named = NAME_LENGTH.search(item["name"])
        cad_text = " ".join(options[k] for k in keys) or (named[0].replace(",", ".") if named else "")
        cad = [n for n, _ in lengths_in(cad_text)]
        # A short part the vendor sells at this length ("2 Inch Long SplineXS Shaft"). Only checked
        # when there's no stock length: a title's cross-section ("2" x 2"") isn't a length.
        if not sold and cad and any(abs(c - n) < 0.01 for c in cad for n, _ in lengths_in(text)):
            continue
        new_options = {k: v for k, v in options.items() if k not in keys}
        if sold and keys:
            new_options[keys[0]] = sold
        new_name = rename(item["name"], sold)
        if new_name == item["name"] and new_options == options:
            continue
        changes.append((item, new_name, new_options, sold, text))

    print("-- Generated by workers/orders/scripts/catalog-stock-lengths.py: stock material (shafts, tube,")
    print("-- spline, extrusion) loses the FRCDesign CAD length and gets the length vendors sell, or none")
    print("-- when they sell several. Only items still as seeded change, matched by FRCDesign record id.")
    for item, name, options, sold, text in changes:
        print(f"-- {item['sku'] or '(no part number)'}: {text or 'no vendor listing'}")
        print(
            f"UPDATE catalog_items SET name = {q(name)}, options = {q(json.dumps(options))}"
            f" WHERE source_id = {q(item['source_id'])} AND name = {q(item['name'])}"
            f" AND options = {q(item['options'])};"
        )
    print(f"changed {len(changes)} items", file=sys.stderr)


if __name__ == "__main__":
    CACHE = sys.argv[2]
    Path(CACHE).mkdir(parents=True, exist_ok=True)
    main(sys.argv[1])
