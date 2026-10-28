// What other apps send to Inventory and read from it (Orders, when a part is received). Exported
// as "@g3/worker-inventory/intake-types"; keep it dependency-free.

/** Where received parts go: into storage at a location, or in use on a robot's subsystem. */
export type InventoryDestination = {
  status: "storage" | "in_use";
  /** The location for deliveries that don't name their own. */
  locationId?: number | null;
  /** Both needed when `status` is "in_use". */
  robotId?: number | null;
  subsystemId?: number | null;
};

/** One delivery of one part. */
export type IntakeLine = {
  /** Names the delivery where it came from ("orders:request:12"); sent twice, it's added once. */
  sourceKey: string;
  /** How many arrived, in `unit`: 4 for one pack of 4, 100 for a 100 ft spool. */
  quantity: number;
  /**
   * What the quantity counts ("ft"); "" or left out for one of each. A new entry takes it; an
   * entry Inventory already has keeps its own.
   */
  unit?: string;
  /** What to call a new entry, if the part isn't in Inventory yet. */
  name: string;
  /** The vendor's listing, which is how a later delivery of the same part finds the entry. */
  listing: {
    /** The part's id in Orders' catalog. */
    catalogItemId: number | null;
    vendor: string;
    sku: string | null;
    url: string | null;
    /** What one of the unit cost (a pack's price over the pack quantity). */
    priceCents: number | null;
    priceAt: number | null;
  };
  /** Shown in the entry's history ("WCP order #12"). */
  note: string | null;
  /** Where this delivery goes, when it isn't the destination's location. */
  locationId?: number | null;
};

export type IntakeRequest = { destination: InventoryDestination; lines: IntakeLine[] };

export type IntakeResult = {
  added: { sourceKey: string; itemId: number; created: boolean; duplicate: boolean }[];
};

/** What a destination can be picked from. */
export type InventoryOptions = {
  /** `title` says what's kept there; a location reads as "name - title" when it has one. */
  locations: { id: number; parentId: number | null; name: string; title: string }[];
  robots: { id: number; name: string }[];
  subsystems: { id: number; name: string }[];
};

/** Asks where parts that are about to arrive are already kept. */
export type PlacesRequest = {
  lines: { sourceKey: string; listing: IntakeLine["listing"] }[];
};

export type PlacesResult = {
  places: {
    sourceKey: string;
    /** The entry the part would be added to, if Inventory has it. */
    itemId: number | null;
    itemName: string | null;
    /** What that entry counts in ("ft"; "" for each), so a different unit can be pointed out. */
    unit: string | null;
    /** Where that entry's parts are kept (its storage, before parts in use). */
    locationId: number | null;
  }[];
};
