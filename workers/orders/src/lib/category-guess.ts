/** "bolt" matches "Bolt", "bolts" and "hex bolt", not "Boltzmann": a whole word, plural allowed. */
export const matchesKeyword = (text: string, keyword: string) =>
  new RegExp(
    `(^|[^a-z0-9])${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:e?s)?(?![a-z0-9])`,
    "i",
  ).test(text);

/**
 * Light built-in keywords for the catalog's categories (the FRCDesign set it was seeded with).
 * Checked in order, so phrases and more specific words come before the general ones: "shaft
 * collar" is a shaft accessory, but "hex shaft" is stock. Only a guess; the requester checks it.
 */
const CATALOG_KEYWORDS: [keyword: string, category: string][] = [
  ["swerve", "Swerve"],
  ["bumper", "Bumper Mounting"],
  ["gearbox", "Gearboxes"],
  ["maxplanetary", "Gearboxes"],
  ["ultraplanetary", "Gearboxes"],
  ["shaft collar", "Shaft & Bearing Accessories"],
  ["collar", "Shaft & Bearing Accessories"],
  ["bearing block", "Shaft & Bearing Accessories"],
  ["hub", "Shaft & Bearing Accessories"],
  ["spacer", "Spacers & Standoffs"],
  ["standoff", "Spacers & Standoffs"],
  ["bearing", "Bearings & Bushings"],
  ["bushing", "Bearings & Bushings"],
  ["sprocket", "Sprockets & Chain Accessories"],
  ["chain", "Sprockets & Chain Accessories"],
  ["pulley", "Pulleys & Belt Accessories"],
  ["belt", "Pulleys & Belt Accessories"],
  ["gear", "Gears"],
  ["pinion", "Gears"],
  ["wheel", "Wheels"],
  ["omni", "Wheels"],
  ["tread", "Wheels"],
  ["shaft", "Extrusions & Shafts"],
  ["tube", "Extrusions & Shafts"],
  ["tubing", "Extrusions & Shafts"],
  ["extrusion", "Extrusions & Shafts"],
  ["slide", "Linear Mechanism Components"],
  ["linear", "Linear Mechanism Components"],
  ["elevator", "Linear Mechanism Components"],
  ["cylinder", "Pneumatics"],
  ["solenoid", "Pneumatics"],
  ["pneumatic", "Pneumatics"],
  ["compressor", "Pneumatics"],
  ["motor", "Motors & Servos"],
  ["servo", "Motors & Servos"],
  ["neo", "Motors & Servos"],
  ["falcon", "Motors & Servos"],
  ["kraken", "Motors & Servos"],
  ["camera", "Sensors & Cameras"],
  ["sensor", "Sensors & Cameras"],
  ["encoder", "Sensors & Cameras"],
  ["limelight", "Sensors & Cameras"],
  ["gyro", "Sensors & Cameras"],
  ["controller", "Control System"],
  ["breaker", "Control System"],
  ["roborio", "Control System"],
  ["wire", "Control System"],
  ["cable", "Control System"],
  ["connector", "Control System"],
  ["battery", "Control System"],
  ["bolt", "Fasteners"],
  ["screw", "Fasteners"],
  ["nut", "Fasteners"],
  ["washer", "Fasteners"],
  ["rivet", "Fasteners"],
  ["bracket", "Structure"],
  ["gusset", "Structure"],
  ["plate", "Structure"],
];

/** The catalog category a product's name suggests, if that category exists. */
export function guessCatalogCategory(title: string, categories: string[]): string | null {
  const available = new Set(categories);
  for (const [keyword, category] of CATALOG_KEYWORDS) {
    if (available.has(category) && matchesKeyword(title, keyword)) return category;
  }
  return null;
}
