// What other apps send to Inventory and read from it (Orders, when a part is received). Exported
// as "@g3/worker-inventory/intake-types"; keep it dependency-free.

/** Where received parts go: into storage at a location, or in use on a robot's subsystem. */
export type InventoryDestination = {
  status: "storage" | "in_use";
  locationId: number;
  /** Both needed when `status` is "in_use". */
  robotId?: number | null;
  subsystemId?: number | null;
};

/** One delivery of one part. */
export type IntakeLine = {
  /** Names the delivery where it came from ("orders:request:12"); sent twice, it's added once. */
  sourceKey: string;
  /** How many parts arrived: 4 for one pack of 4. */
  quantity: number;
  /** What to call a new entry, if the part isn't in Inventory yet. */
  name: string;
  /** The vendor's listing, which is how a later delivery of the same part finds the entry. */
  listing: {
    /** The part's id in Orders' catalog. */
    catalogItemId: number | null;
    vendor: string;
    sku: string | null;
    url: string | null;
    /** What one part cost (a pack's price over the parts in it). */
    priceCents: number | null;
    priceAt: number | null;
  };
  /** Shown in the entry's history ("WCP order #12"). */
  note: string | null;
};

export type IntakeRequest = { destination: InventoryDestination; lines: IntakeLine[] };

export type IntakeResult = {
  added: { sourceKey: string; itemId: number; created: boolean; duplicate: boolean }[];
};

/** What a destination can be picked from. */
export type InventoryOptions = {
  locations: { id: number; parentId: number | null; name: string }[];
  robots: { id: number; name: string }[];
  subsystems: { id: number; name: string }[];
};
