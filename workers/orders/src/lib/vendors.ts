/** Display names for vendor sites, so exports read "McMaster-Carr", not "mcmaster.com". */
const VENDOR_NAMES: Record<string, string> = {
  "amazon.com": "Amazon",
  "a.co": "Amazon",
  "amzn.to": "Amazon",
  "mcmaster.com": "McMaster-Carr",
  "digikey.com": "Digikey",
  "wcproducts.com": "West Coast Products",
  "revrobotics.com": "REV Robotics",
  "thethriftybot.com": "The Thrifty Bot",
  "andymark.com": "AndyMark",
  "swervedrivespecialties.com": "Swerve Drive Specialties",
  "ctr-electronics.com": "CTR Electronics",
  "store.ctr-electronics.com": "CTR Electronics",
  "homedepot.com": "Home Depot",
  "lowes.com": "Lowe's",
  "acehardware.com": "Ace Hardware",
  "ebay.com": "eBay",
  "ebay.io": "eBay",
  "powerwerx.com": "Powerwerx",
  "onlinemetals.com": "Online Metals",
  "vbeltguys.com": "V-Belt Guys",
  "bambulab.com": "Bambu Lab",
  "us.store.bambulab.com": "Bambu Lab",
  "easyrulerplastic.com": "EasyRuler Plastic",
  "tekton.com": "TEKTON",
  "walmart.com": "Walmart",
  "swyftrobotics.com": "SWYFT Robotics",
  "lastanvil.com": "Last Anvil Innovations",
  "reduxrobotics.com": "Redux Robotics",
  "armabot.com": "ARMABOT",
  "8020.net": "80/20",
};

/** A friendly vendor name for a hostname (or a name someone typed, which is kept). */
export function vendorName(vendor: string): string {
  const host = vendor
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return vendor.trim();
  return VENDOR_NAMES[host] ?? VENDOR_NAMES[host.split(".").slice(-2).join(".")] ?? host;
}

/** How requests and vendor profiles match up: the vendor name, trimmed and lowercased. */
export const vendorKey = (vendor: string) => vendor.trim().toLowerCase();
