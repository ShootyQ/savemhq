const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const M = require("../teams/model");
test("only owners and leaders manage shared work", () => {
  for (const role of ["owner", "leader"]) assert.equal(M.manages(role), true);
  for (const role of ["member", "admin", "", null])
    assert.equal(M.manages(role), false);
});
test("progress excludes cancelled work, handles empty and rounds consistently", () => {
  assert.deepEqual(M.progress([]), { done: 0, total: 0, percent: 0 });
  assert.deepEqual(
    M.progress([
      { status: "done" },
      { status: "todo" },
      { status: "blocked" },
      { status: "cancelled" },
    ]),
    { done: 1, total: 3, percent: 33 },
  );
  assert.equal(M.progress([{ status: "cancelled" }]).percent, 0);
});
test("validate email, calendar dates, status and bounded text", () => {
  assert.equal(M.email(" Name@Example.com "), "name@example.com");
  assert.equal(M.date("2028-02-29"), "2028-02-29");
  for (const d of ["2026-02-29", "2026-11-31", "yesterday", null])
    assert.throws(() => M.date(d));
  assert.throws(() => M.email("not an email"));
  assert.throws(() => M.choice("approved", M.STATUSES));
  assert.throws(() => M.text("x".repeat(121)));
  assert.throws(() => M.text("  "));
  assert.equal(M.text("", 200, false), "");
});
test("server and browser share exactly the same policy implementation", () =>
  assert.equal(
    fs.readFileSync(require.resolve("../teams/model"), "utf8"),
    fs.readFileSync(require.resolve("../../js/teams/model"), "utf8"),
  ));
