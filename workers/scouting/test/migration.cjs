const path = require("node:path");
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");
const assert = require("node:assert/strict");
const db = new DatabaseSync(":memory:");
const md = path.join(__dirname, "../src/db/migrations");
for (const f of fs
  .readdirSync(md)
  .filter((f) => f < "0033")
  .sort())
  db.exec(fs.readFileSync(`${md}/${f}`, "utf8"));
const fixtures = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures/team-rows.json"), "utf8"),
);
const names = Object.keys(fixtures);
const parents = [
  "scouting_forms",
  "robot_teams",
  "manual_events",
  "boylebucks_accounts",
  "game_parlays",
];
for (const name of [...parents, ...names.filter((n) => !parents.includes(n))]) {
  const row = { ...fixtures[name] };
  // biome-ignore lint/performance/noDelete: compare exact pre-migration row shapes
  delete row.team_id;
  if (name === "scouting_engagement_settings") row.team_key = "original-engagement";
  if (name === "robot_images") {
    row.team_id = row.robot_id;
    // biome-ignore lint/performance/noDelete: compare exact pre-migration row shapes
    delete row.robot_id;
  }
  if (name === "scouting_forms") row.form_kind = "pit";
  if (name === "service_tickets") {
    row.issue_type = "mechanical";
    row.status = "open";
  }
  if (name === "game_bets" || name === "game_parlays" || name === "game_parlay_legs") {
    row.status = "open";
    if ("market" in row) row.market = "spread";
    row.selection &&= "red";
  }
  if (name === "boylebucks_accounts") row.balance = 100;
  const columns = Object.keys(row);
  db.prepare(
    `INSERT INTO ${name} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
  ).run(...columns.map((c) => row[c]));
}
const before = Object.fromEntries(names.map((n) => [n, db.prepare(`SELECT * FROM ${n}`).all()]));
db.exec("BEGIN");
db.exec(fs.readFileSync(`${md}/0033_team_ownership.sql`, "utf8"));
db.exec("COMMIT");
for (const name of names) {
  const after = db
    .prepare(`SELECT * FROM ${name}`)
    .all()
    .map((row) => {
      if (name === "scouting_engagement_settings") {
        row.team_key = row.team_id;
      } else assert.equal(row.team_id, "__legacy_scouting__");
      // biome-ignore lint/performance/noDelete: compare exact pre-migration row shapes
      delete row.team_id;
      if (name === "robot_images") {
        row.team_id = row.robot_id;
        // biome-ignore lint/performance/noDelete: compare exact pre-migration row shapes
        delete row.robot_id;
      }
      return row;
    });
  assert.deepEqual(after, before[name], name);
}
assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
console.log(
  "Populated migration preserves every row and column across all 27 private tables; foreign keys pass.",
);
// Exercise the adoption order with populated composite foreign keys.
const bootstrap = fs.readFileSync(path.join(__dirname, "../src/db/bootstrap.ts"), "utf8");
const order = bootstrap.match(/export const teamTables = \[([\s\S]*?)\];/)[1].match(/\b\w+(?=,)/g);
db.exec("BEGIN");
for (const table of order) {
  const name = table.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  db.prepare(`UPDATE ${name} SET team_id = ? WHERE team_id = ?`).run(
    "test-original-owner",
    "__legacy_scouting__",
  );
}
db.exec("COMMIT");
assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
const beforeDelay = db
  .prepare("SELECT * FROM strategy_event_config")
  .all()
  .map((row) => ({ ...row }));
db.exec(fs.readFileSync(`${md}/0034_auto_advance_delay.sql`, "utf8"));
const afterDelay = db.prepare("SELECT * FROM strategy_event_config").all();
assert.deepEqual(
  afterDelay.map(({ auto_advance_delay_minutes, ...row }) => {
    assert.equal(auto_advance_delay_minutes, 2);
    return row;
  }),
  beforeDelay,
);
for (const value of [-1, 31, 1.5])
  assert.throws(() =>
    db.prepare("UPDATE strategy_event_config SET auto_advance_delay_minutes = ?").run(value),
  );
console.log(
  "Auto-advance migration preserves event configuration, defaults existing teams to two minutes and rejects invalid delays.",
);
db.prepare("UPDATE strategy_event_config SET auto_advance_delay_minutes = 5").run();
db.exec(fs.readFileSync(`${md}/0035_submission_window.sql`, "utf8"));
const converted = db.prepare("SELECT * FROM strategy_event_config").get();
assert.equal(converted.submission_window_seconds, 300);
assert.equal("auto_advance_delay_minutes" in converted, false);
const { submission_window_seconds, ...preserved } = converted;
assert.deepEqual(preserved, beforeDelay[0]);
db.prepare(
  "INSERT INTO strategy_event_config (team_id, id, updated_by, updated_at) VALUES ('migration-test-new', 1, 'test', 1)",
).run();
assert.equal(
  db
    .prepare(
      "SELECT submission_window_seconds FROM strategy_event_config WHERE team_id = 'migration-test-new'",
    )
    .get().submission_window_seconds,
  120,
);
for (const value of [-1, 1801, 30.5])
  assert.throws(() =>
    db.prepare("UPDATE strategy_event_config SET submission_window_seconds = ?").run(value),
  );
console.log(
  "Seconds-based window migration preserves saved delays, defaults new teams to 120 seconds and removes the duplicate setting.",
);
db.close();
