const { test } = require("node:test");
const assert = require("node:assert/strict");
const M = require("../../js/plates/model");
const now = new Date("2026-11-10T18:00:00Z");
const record = (id, andy, savannah, locked = true) => ({
  id,
  locked,
  andyStates: Array.from({ length: andy }, (_, i) => M.STATES[i]),
  savannahStates: Array.from({ length: savannah }, (_, i) => M.STATES[i]),
});
const build = (rows) => M.buildMonths(rows, now);
test("calendar order and 2026 season are independent of stored order and missing months", () => {
  const months = build([
    { ...record("november", 3, 4, false), order: -5 },
    record("january", 2, 3),
  ]);
  assert.equal(months.length, 12);
  assert.equal(months[0].name, "January");
  assert.equal(months[10].name, "November");
  assert.equal(months[1].exists, false);
  assert.equal(M.YEAR, 2026);
});
test("only locked nonempty results award wins or ties; live counts remain visible", () => {
  const months = build([
    record("january", 28, 29),
    record("february", 4, 4),
    record("march", 0, 0),
    record("october", 30, 10, false),
    record("november", 5, 9, false),
  ]);
  const stats = M.seasonStats(months, now);
  assert.deepEqual(stats.wins, { andy: 0, savannah: 1 });
  assert.equal(stats.ties, 1);
  assert.equal(stats.finalized, 3);
  assert.equal(stats.noResult, 1);
  assert.equal(months[2].result, "No result");
  assert.equal(months[10].result, "Savannah leads by 4");
  assert.equal(months[9].status, "Awaiting finalization");
  assert.equal(months[11].status, "Upcoming");
});
test("January manual totals survive absent logs and are reported as incomplete history", () => {
  const input = [
    {
      id: "january",
      locked: true,
      manualCounts: { andy: 28, savannah: 29 },
      andyStates: [],
      savannahStates: [],
    },
  ];
  const original = structuredClone(input);
  const months = build(input),
    jan = months[0],
    stats = M.seasonStats(months, now);
  assert.equal(jan.andy, 28);
  assert.equal(jan.savannah, 29);
  assert.equal(jan.result, "Savannah won by 1");
  assert.equal(jan.incomplete, true);
  assert.deepEqual(M.comparison(jan), []);
  assert.equal(stats.unique, 0);
  assert.equal(stats.incomplete, true);
  assert.deepEqual(stats.totals, { andy: 28, savannah: 29 });
  assert.deepEqual(input, original);
});
test("valid manual zeros override logs, while null or partial manual values do not invent zero scores", () => {
  const zero = build([
    { ...record("january", 4, 3), manualCounts: { andy: 0, savannah: 0 } },
  ])[0];
  assert.equal(zero.andy, 0);
  assert.equal(zero.winner, null);
  for (const manualCounts of [
    { andy: null, savannah: null },
    { andy: 5 },
    { andy: "", savannah: "" },
    { andy: -1, savannah: 2 },
  ]) {
    const month = build([{ ...record("january", 4, 3), manualCounts }])[0];
    assert.equal(month.andy, 4);
    assert.equal(month.savannah, 3);
  }
  assert.equal(
    build([
      {
        ...record("january", 4, 3),
        manualCounts: { andy: "28", savannah: "29" },
      },
    ])[0].savannah,
    29,
  );
});
test("successful empty live records never regain historical sample scores", () => {
  const months = build([
    {
      id: "january",
      locked: true,
      andyStates: [],
      savannahStates: [],
      manualCounts: null,
    },
  ]);
  assert.equal(months[0].andy, 0);
  assert.equal(months[0].savannah, 0);
  assert.equal(M.seasonStats(months, now).bestTotal, 0);
  assert.equal(
    build([]).some((m) => m.hasScore),
    false,
  );
});
test("current month uses Chicago at UTC boundaries; after the season choose latest recorded month", () => {
  const before = new Date("2026-12-01T05:59:00Z"),
    after = new Date("2026-12-01T06:00:00Z");
  assert.equal(M.defaultMonth(build([]), before), "november");
  assert.equal(M.defaultMonth(build([]), after), "december");
  const nextYear = new Date("2027-01-10T18:00:00Z");
  assert.equal(
    M.defaultMonth(
      build([record("march", 3, 2), record("october", 2, 4)]),
      nextYear,
    ),
    "october",
  );
  assert.equal(M.defaultMonth(build([]), nextYear), "january");
  assert.equal(M.monthId(" NOVEMBER "), "november");
  assert.equal(M.monthId("javascript:alert(1)"), "");
});
test("ties and calendar gaps break streaks, but trailing unfinished months do not erase them", () => {
  let stats = M.seasonStats(
    build([
      record("january", 4, 1),
      record("february", 5, 1),
      record("march", 2, 2),
      record("april", 4, 1),
      record("june", 4, 1),
      record("july", 4, 1),
      record("august", 4, 1),
    ]),
    now,
  );
  assert.deepEqual(stats.current, { player: "andy", count: 3 });
  assert.equal(stats.longest, 3);
  assert.deepEqual(stats.longestPlayers, ["andy"]);
  stats = M.seasonStats(
    build([
      record("january", 4, 1),
      record("february", 5, 1),
      record("march", 2, 2),
    ]),
    now,
  );
  assert.deepEqual(stats.current, { player: null, count: 0 });
  assert.equal(stats.longest, 2);
});
test("a locked zero result breaks current and longest streak runs", () => {
  const stats = M.seasonStats(
    build([
      record("january", 4, 1),
      record("february", 0, 0),
      record("march", 4, 1),
      record("april", 4, 1),
      record("may", 0, 0),
    ]),
    now,
  );
  assert.equal(stats.longest, 2);
  assert.equal(stats.current.count, 0);
});
test("equal longest streaks credit both players instead of choosing an arbitrary winner", () => {
  const stats = M.seasonStats(
    build([
      record("january", 4, 1),
      record("february", 4, 1),
      record("march", 1, 4),
      record("april", 1, 4),
    ]),
    now,
  );
  assert.equal(stats.longest, 2);
  assert.deepEqual(stats.longestPlayers, ["andy", "savannah"]);
  assert.deepEqual(stats.current, { player: "savannah", count: 2 });
});
test("monthly totals and distinct logged states are separate, with D.C. included", () => {
  const months = build([
    {
      id: "january",
      locked: true,
      andyStates: ["Minnesota", "District of Columbia"],
      savannahStates: ["Minnesota"],
    },
    {
      id: "february",
      locked: true,
      andyStates: ["Minnesota"],
      savannahStates: ["Wisconsin"],
    },
  ]);
  const stats = M.seasonStats(months, now);
  assert.deepEqual(stats.totals, { andy: 3, savannah: 2 });
  assert.equal(stats.unique, 3);
  assert.equal(M.STATES.length, 51);
  assert.equal(stats.incomplete, false);
});
test("comparison filters and search are alphabetical and do not mutate official counts", () => {
  const month = build([
    {
      id: "november",
      andyStates: ["Wisconsin", "Minnesota", "Iowa"],
      savannahStates: ["Minnesota", "Ohio", "Iowa", "District of Columbia"],
    },
  ])[10];
  assert.deepEqual(
    M.comparison(month, "both").map((r) => r.name),
    ["Iowa", "Minnesota"],
  );
  assert.deepEqual(
    M.comparison(month, "andy").map((r) => r.name),
    ["Wisconsin"],
  );
  assert.deepEqual(
    M.comparison(month, "savannah").map((r) => r.name),
    ["District of Columbia", "Ohio"],
  );
  assert.equal(M.comparison(month, "all", " wIS ").length, 1);
  assert.equal(M.comparison(month, "both", "Wis").length, 0);
  assert.equal(month.andy, 3);
});
test("live leadership is not a season championship before the season ends", () => {
  const records = M.MONTHS.map((m, i) =>
    record(m.toLowerCase(), i === 0 ? 4 : 3, 1),
  );
  assert.match(M.seasonStats(build(records), now).lead, /leads the season/);
  assert.match(
    M.seasonStats(
      M.buildMonths(records, new Date("2027-01-01T12:00:00Z")),
      new Date("2027-01-01T12:00:00Z"),
    ).lead,
    /wins the season/,
  );
});
