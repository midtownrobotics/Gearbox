// The text a demo visitor can put in a field: anything a page sends from the demo is picked from
// these lists with a rotate button (TextField in @g3/ui), never typed. Each field names the kind of
// text it holds, which chooses its list. Keep every entry plain and neutral: anyone can see it.

export const SAFE_TEXT = {
  /** Anything without a better list. */
  text: [
    "Practice day",
    "Ready for review",
    "Ask a mentor",
    "Done for today",
    "Waiting on parts",
    "Next build session",
    "Looks good",
    "Needs a second check",
  ],
  person: [
    "Alex Rivera",
    "Jordan Lee",
    "Sam Patel",
    "Taylor Nguyen",
    "Morgan Brooks",
    "Casey Kim",
    "Riley Chen",
    "Avery Johnson",
  ],
  email: [
    "alex.rivera@example.com",
    "jordan.lee@example.com",
    "sam.patel@example.com",
    "taylor.nguyen@example.com",
  ],
  teamName: ["Gearbox Demo", "Demo Robotics", "The Sample Bots", "Practice Field Robotics"],
  shortName: ["DEMO", "GBX", "SAMPLE", "BOTS"],
  /** Names for lists, batches, schedules, archives and the like. */
  title: [
    "Drivetrain rebuild",
    "Week 2 build",
    "Practice robot",
    "Competition prep",
    "Intake upgrade",
    "Spare parts",
    "Kickoff weekend",
    "District event",
    "Offseason project",
  ],
  partName: [
    "Swerve module",
    "Intake roller",
    "Side plate",
    "Bumper bracket",
    "Shooter flywheel",
    "Climber hook",
    "Battery mount",
    "Gusset",
    "Motor plate",
    "Hex shaft spacer",
  ],
  vendor: ["WCP", "REV Robotics", "AndyMark", "CTR Electronics", "McMaster-Carr", "Amazon"],
  sku: ["WCP-0451", "REV-21-1650", "am-3541", "217-4243", "91251A540", "DEMO-1001"],
  /** A link's name on the team's home. */
  linkName: ["Team wiki", "Build log", "CAD library", "Sponsors", "Outreach"],
  url: [
    "https://wcproducts.com/products/wcp-0451",
    "https://www.revrobotics.com/rev-21-1650/",
    "https://andymark.com/products/am-3541",
    "https://store.ctr-electronics.com/products/kraken-x60",
    "https://www.mcmaster.com/91251A540/",
  ],
  /** Why a part is needed. */
  reason: [
    "Replacing a worn part",
    "Spares for competition",
    "For the new intake",
    "Needed for the drivetrain",
    "Running low in the shop",
    "Prototype testing",
  ],
  /** Longer notes, descriptions and comments. */
  note: [
    "Checked and ready to go.",
    "Please double check the measurements before cutting.",
    "Keep these together in the labeled bin.",
    "Ask a mentor before changing this.",
    "Used during practice matches last week.",
    "Nothing to report.",
  ],
  /** A problem found on the robot or in the pit. */
  issue: [
    "Loose bolt on the intake",
    "Battery cable is worn",
    "Bumper fabric is torn",
    "Encoder reads zero",
    "Chain is too loose",
    "Camera is out of focus",
  ],
  /** A checklist item or a step to do. */
  checklist: [
    "Check battery voltage",
    "Inspect bumpers",
    "Tighten wheel bolts",
    "Test the intake",
    "Charge the driver station",
    "Check air pressure",
    "Load the autonomous routine",
  ],
  material: ["Aluminum 6061", "Steel", "Polycarbonate", "Delrin", "Carbon fiber"],
  /** A size or thickness. */
  size: ["1/8 in", "1/4 in", "1/16 in", "1/2 in hex", "2 in", "10-32"],
  unit: ["ft", "in", "sheet", "kg", "roll"],
  revision: ["A", "B", "C"],
  location: ["Shelf A", "Bin 12", "Workbench", "Pit cart", "Tool wall", "Drawer 3", "Back room"],
  /** A short code: a budget category's, a battery's, a process's. */
  code: ["4101", "4102", "4200", "A1", "B2", "C3"],
  tracking: ["1Z999AA10123456784", "9400100000000000000000", "770000000000"],
  skill: ["Safe drill press use", "Reading a drawing", "Crimping connectors", "Using calipers"],
  category: ["Drivetrain", "Electrical", "Hardware", "Tools", "Raw stock", "Pneumatics"],
  /** An Inventory field, robot or subsystem, or a Schedule role. */
  label: [
    "Material",
    "Size",
    "Color",
    "Practice bot",
    "Competition bot",
    "Drive base",
    "Intake",
    "Pit crew",
    "Scouting",
  ],
  event: ["2026gacmp", "2026gadal", "2026gagwi"],
  /** What's kept in a location. */
  contents: [
    "Spare hardware",
    "Electronics",
    "Cables and wire",
    "Motors",
    "Bearings",
    "Hand tools",
  ],
  /** A list of choices or names, one per line. */
  lines: ["Hardware\nMotion\nTools", "Small\nMedium\nLarge", "Shelf A\nShelf B\nShelf C"],
  /** Scouting: a pick-list entry, a tier, a strategy map, a match, an auto routine. */
  strategy: [
    "Strong defender",
    "Fast cycler",
    "Reliable climber",
    "Good auto",
    "Pick for playoffs",
  ],
  tier: ["First pick", "Second pick", "Defense", "Backup"],
  map: ["Auto routes", "Defense plan", "Shooting spots"],
  match: ["Qual 12", "Qual 47", "Practice 3", "Playoff 5"],
  routine: ["3-piece center", "2-piece amp side", "Leave and score"],
  /** A scouting form's question, and answers to one. */
  question: [
    "How many pieces in auto?",
    "Did they leave the starting zone?",
    "Climb level",
    "Defense rating",
  ],
  answer: [
    "Scored twice",
    "Played defense",
    "Climbed at the end",
    "Stopped moving",
    "Fast and accurate",
  ],
  observation: [
    "Quick cycles, scored most of their shots.",
    "Strong defense in the second half.",
    "Climbed with time to spare.",
    "Missed a few pickups but recovered.",
  ],
  /** Team numbers and names, one "number,name" per line. */
  teamNames: ["9999,Gearbox Demo", "4242,Practice Field Robotics\n5151,The Sample Bots"],
  skills: ["Mechanical, electrical", "Programming", "Mechanical, programming"],
  points: ["Scout Points", "Scouting Stars", "Gear Points"],
  /** Answers to a scouting question, comma separated. */
  choices: ["Yes, No", "Low, Mid, High", "Left, Center, Right", "None, Some, Lots"],
  /** A part's sizes and types, one "Name: value" per line. */
  options: ['Length: 1/2"', "Bore: 1/2 in hex", "Color: Black", "Size: 1/4 in"],
  device: ["Driver station", "Practice laptop", "CAD desktop", "Scouting tablet", "Shop printer"],
  blocklist: ["Video", "Games", "Social media", "Streaming"],
  /** Web addresses for a blocklist, one per line. */
  domains: ["youtube.com\ntwitch.tv", "example.com", "games.example.com"],
  payment: ["Team credit card", "Purchase order", "Mentor reimbursement"],
  credit: ["Sponsor discount", "Store credit", "Gift card"],
  currency: ["USD", "CAD", "EUR", "GBP"],
  /** Orders' naming template. */
  template: ["{vendor} {sku} – {title}", "{title} ({vendor})", "{vendor} – {title}"],
  keyword: ["bolt", "bearing", "motor", "wire", "drill"],
  process: ["CAM", "Router", "Lathe", "Mill", "Welding", "Deburr", "Assembly"],
  /** Shop's status words for how full its queue is. */
  shopStatus: ["Mooing Cow 🐮", "Chopping Block 🔪", "Raw 🥩", "Rare 🍖", "Cooked 🍳", "Ash 🔥"],
  icon: ["🔧", "⚙️", "🤖", "🛠️", "🔩", "💡"],
  /** A skill tree's name. */
  tree: ["Safety", "Manufacturing", "Programming", "Electrical", "Design"],
  role: ["Drive Team", "Scouting", "Pit", "Break", "Lunch", "Media"],
  period: ["Load in", "Practice matches", "Lunch", "Qualification matches", "Awards"],
  /** A notification a team's admins send its members. */
  announcement: [
    "Build session moved to Saturday",
    "The shop is closed on Friday",
    "Bring safety glasses to every meeting",
    "Sign up for the district event by Monday",
    "This Saturday's build session starts at 9 AM instead of 10. Bring safety glasses, and sign in at the door as usual.",
    "The shop is closed on Friday for a school event. The next build session is Saturday as usual.",
  ],
  /** A Slack channel's id (the demo can't connect Slack, so these only fill the field). */
  channel: ["C0DEMO0001", "C0DEMO0002"],
} as const satisfies Record<string, readonly string[]>;

/** The kinds of text a field can hold, each with its list. */
export type SafeTextKind = keyof typeof SAFE_TEXT;

/** Another entry of a kind's list than `current`, at random: what the rotate button gives. */
export function nextSafe(kind: SafeTextKind, current?: string): string {
  const list: readonly string[] = SAFE_TEXT[kind];
  const others = list.filter((text) => text !== current);
  const pool = others.length > 0 ? others : list;
  return pool[Math.floor(Math.random() * pool.length)] ?? "";
}
