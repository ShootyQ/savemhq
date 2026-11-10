import {
  initHeaderAuth,
  hasSectionAccess,
  getPersonFromEmail,
} from "../auth-shared.js";
import { mountSiteHeader } from "../header-component.js";
import { initHeaderShell } from "../header-shell.js";
import { watchCompetition } from "./api.js";
const M = globalThis.PlateModel,
  $ = (id) => document.getElementById(id);
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const text = (id, value) => {
  const el = $(id),
    next = String(value);
  if (el.textContent !== next) el.textContent = next;
};
const html = (id, value) => {
  const el = $(id);
  if (el.innerHTML !== value) el.innerHTML = value;
};
const names = { andy: "Andy", savannah: "Savannah" };
let months = [],
  selected = "",
  loaded = false,
  canEnter = false,
  filter = "all",
  search = "",
  unsubscribe = null,
  generation = 0,
  slowTimer = null,
  announceTimer = null,
  signature = "";
mountSiteHeader({
  brandHref: "index.html",
  navLinks: [
    { label: "Scores", href: "#selected-month" },
    { label: "Monthly results", href: "#monthly-scoreboard" },
    { label: "States", href: "#plate-views" },
    { label: "Season stats", href: "#yearly-stats" },
  ],
});
initHeaderShell();
$("month-select").innerHTML = M.MONTHS.map(
  (name) => `<option value="${name.toLowerCase()}">${name}</option>`,
).join("");
$("month-results").innerHTML = M.MONTHS.map((name) => {
  const id = name.toLowerCase();
  return `<tr data-month-row="${id}"><th scope="row"><button class="plate-month-button" data-month="${id}" aria-pressed="false">${name}</button><span class="plate-now" data-current-label hidden>This month</span><span class="plate-viewing" data-selected-label hidden>Viewing</span></th><td class="plate-andy" data-cell="andy" data-label="Andy"></td><td class="plate-savannah" data-cell="savannah" data-label="Savannah"></td><td data-cell="result" data-label="Result"></td><td data-cell="status" data-label="Status"></td></tr>`;
}).join("");
function connection(message, retry = false) {
  text("sync-status", message);
  $("retry-scores").hidden = !retry;
}
function entryLinks() {
  const href = `plate-entry.html?month=${encodeURIComponent(selected)}`;
  $("matchup-add").href = href;
  $("matchup-add").hidden = !canEnter;
  const header = document.getElementById("add-plates-link");
  if (header) header.href = href;
}
initHeaderAuth({
  onStateChange: ({
    user,
    isAdmin,
    approvalStatus,
    approvalPerson,
    approvalSections,
  }) => {
    canEnter = Boolean(
      user &&
        hasSectionAccess(
          { isAdmin, approvalStatus, approvalSections, userEmail: user.email },
          "plates",
        ) &&
        ["andy", "savannah"].includes(
          String(
            approvalPerson || getPersonFromEmail(user.email),
          ).toLowerCase(),
        ),
    );
    entryLinks();
  },
});
function announce(message) {
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => text("score-announcement", message), 400);
}
function writeLocation(mode = "replace") {
  const url = new URL(location.href);
  url.searchParams.set("month", selected);
  history[mode === "push" ? "pushState" : "replaceState"]({}, "", url);
}
function selectMonth(value, { scroll = false, locationMode = "push" } = {}) {
  const id = M.monthId(value);
  if (!id || !loaded) return;
  selected = id;
  render();
  if (locationMode) writeLocation(locationMode);
  const month = months.find((m) => m.id === id);
  announce(
    `${month.name}. Andy ${month.andy}, Savannah ${month.savannah}. ${month.result}. ${month.status}.`,
  );
  if (scroll) {
    $("matchup-title").tabIndex = -1;
    $("matchup-title").focus({ preventScroll: true });
    $("selected-month").scrollIntoView({ block: "start" });
  }
}
function comparisonView(month) {
  text("comparison-month", month.name);
  const all = M.comparison(month),
    totalOnly = month.hasScore && all.length === 0;
  text(
    "comparison-note",
    totalOnly
      ? `Recorded totals: Andy ${month.andy}, Savannah ${month.savannah}. Detailed state logs were not recorded for this month.`
      : month.incomplete
        ? "The recorded totals and available state logs differ. These comparisons show only the available logs."
        : "Each checkmark represents a state in that player’s monthly log.",
  );
  $("comparison-tools").hidden = totalOnly;
  const rows = M.comparison(month, filter, search);
  text(
    "comparison-count",
    totalOnly
      ? ""
      : `${rows.length} ${rows.length === 1 ? "state" : "states"} shown · ${all.length} distinct in available logs`,
  );
  const mark = (logged) =>
    `<span aria-hidden="true">${logged ? "✓" : "—"}</span><span class="plate-sr-only">${logged ? "Logged" : "Not in available log"}</span>`;
  html(
    "state-comparison",
    rows
      .map(
        (row) =>
          `<tr><th scope="row">${escape(row.name)}</th><td class="${row.andy ? "plate-andy is-logged" : ""}">${mark(row.andy)}</td><td class="${row.savannah ? "plate-savannah is-logged" : ""}">${mark(row.savannah)}</td></tr>`,
      )
      .join(""),
  );
  $("comparison-table").hidden = rows.length === 0;
  $("comparison-empty").hidden = rows.length > 0;
  text(
    "comparison-empty",
    totalOnly
      ? "State details are unavailable; the recorded scores above still count."
      : all.length === 0
        ? "No state details have been logged for this month yet."
        : "No states match this filter and search.",
  );
}
function render() {
  if (!loaded) return;
  const month = months.find((m) => m.id === selected),
    stats = M.seasonStats(months);
  $("month-select").value = selected;
  text(
    "month-context",
    month.isCurrent ? "This month" : `${M.YEAR} season · Selected month`,
  );
  text("matchup-title", month.name);
  text("andy-score", month.andy);
  text("savannah-score", month.savannah);
  text("month-result", month.result);
  text("month-status", month.status);
  $("month-status").classList.toggle("is-final", month.locked);
  const current = months.find((m) => m.isCurrent);
  $("current-month").hidden = !current || current.id === selected;
  for (const m of months) {
    const row = document.querySelector(`[data-month-row="${m.id}"]`);
    row.classList.toggle("is-selected", m.id === selected);
    row.classList.toggle("is-current", m.isCurrent);
    const button = row.querySelector("[data-month]");
    button.setAttribute("aria-pressed", String(m.id === selected));
    button.setAttribute("aria-label", `View ${m.name} scores`);
    row.querySelector("[data-current-label]").hidden = !m.isCurrent;
    row.querySelector("[data-selected-label]").hidden = m.id !== selected;
    for (const key of ["andy", "savannah", "result", "status"]) {
      const cell = row.querySelector(`[data-cell="${key}"]`);
      const value =
        ["andy", "savannah"].includes(key) && !m.exists && !m.hasScore
          ? "—"
          : m[key];
      if (cell.textContent !== String(value)) cell.textContent = value;
    }
  }
  text("andy-wins", stats.wins.andy);
  text("savannah-wins", stats.wins.savannah);
  text("season-ties", stats.ties);
  text("season-lead", stats.lead);
  text(
    "season-finalized",
    `${stats.finalized} of 12 months finalized${stats.noResult ? ` · ${stats.noResult} without a result` : ""}. Only manually locked months count toward season wins.`,
  );
  $("season-empty").hidden = months.some((m) => m.hasScore);
  html(
    "state-totals",
    `<span class="plate-andy">Andy <strong>${stats.totals.andy}</strong></span><br><span class="plate-savannah">Savannah <strong>${stats.totals.savannah}</strong></span>`,
  );
  text(
    "unique-states",
    `${stats.incomplete ? "At least " : ""}${stats.unique} combined · Andy ${stats.andyUnique} · Savannah ${stats.savannahUnique}`,
  );
  text(
    "unique-note",
    stats.incomplete
      ? "Some historical totals have incomplete state logs. Distinct-state counts reflect only the available details."
      : "Distinct states across available logs, not the sum of monthly scores. Coverage includes D.C.",
  );
  text(
    "best-month",
    stats.bestMonths.length
      ? `${stats.bestMonths.join(" & ")} · ${stats.bestTotal} combined states`
      : "No scores yet.",
  );
  text(
    "current-streak",
    stats.current.count
      ? `Current: ${names[stats.current.player]} · ${stats.current.count} ${stats.current.count === 1 ? "month" : "months"}`
      : "Current: no winning streak.",
  );
  text(
    "longest-streak",
    stats.longest
      ? `Longest: ${stats.longestPlayers.map((p) => names[p]).join(" & ")} · ${stats.longest} ${stats.longest === 1 ? "month" : "months"}`
      : "Longest: no winning streak yet.",
  );
  comparisonView(month);
  entryLinks();
  signature = JSON.stringify([
    month.id,
    month.andy,
    month.savannah,
    month.status,
  ]);
}
function expandAnchor() {
  const id = location.hash.slice(1);
  if (["plate-views", "yearly-stats"].includes(id)) $(id).open = true;
}
function stop() {
  generation++;
  unsubscribe?.();
  unsubscribe = null;
  clearTimeout(slowTimer);
  clearTimeout(announceTimer);
}
function start() {
  stop();
  const token = generation;
  connection(
    loaded ? "Reconnecting · latest available scores" : "Loading scores…",
  );
  slowTimer = setTimeout(() => {
    if (token !== generation) return;
    connection(
      loaded
        ? "Updates paused · latest available scores"
        : "Scores are taking longer than expected",
      true,
    );
    if (!loaded)
      text(
        "score-loading",
        "We could not connect yet. Retry to check for scores.",
      );
  }, 12000);
  unsubscribe = watchCompetition(
    ({ records, fromCache }) => {
      if (token !== generation) return;
      if (fromCache && records.length === 0) {
        if (loaded)
          connection("Updates paused · latest available scores", true);
        return;
      }
      clearTimeout(slowTimer);
      const initial = !loaded,
        previous = signature;
      months = M.buildMonths(records);
      if (!selected)
        selected =
          M.monthId(new URL(location.href).searchParams.get("month")) ||
          M.defaultMonth(months);
      loaded = true;
      $("score-content").hidden = false;
      $("score-loading").hidden = true;
      render();
      connection(
        fromCache ? "Updates paused · showing saved scores" : "Live scores",
        fromCache,
      );
      if (initial) {
        writeLocation();
        expandAnchor();
        if (location.hash)
          requestAnimationFrame(() =>
            document
              .getElementById(location.hash.slice(1))
              ?.scrollIntoView({ block: "start" }),
          );
      } else if (previous !== signature) {
        const m = months.find((m) => m.id === selected);
        announce(
          `${m.name} scores updated. Andy ${m.andy}, Savannah ${m.savannah}. ${m.result}. ${m.status}.`,
        );
      }
    },
    () => {
      if (token !== generation) return;
      clearTimeout(slowTimer);
      connection(
        loaded
          ? "Updates paused · latest available scores"
          : "Scores unavailable",
        true,
      );
      if (!loaded)
        text("score-loading", "We couldn’t load the scores. Please retry.");
    },
  );
}
$("month-select").addEventListener("change", (event) =>
  selectMonth(event.target.value),
);
$("month-results").addEventListener("click", (event) => {
  const button = event.target.closest("[data-month]");
  if (button) selectMonth(button.dataset.month, { scroll: true });
});
$("current-month").addEventListener("click", () => {
  const current = months.find((m) => m.isCurrent);
  if (current) {
    selectMonth(current.id);
    $("month-select").focus();
  }
});
$("retry-scores").addEventListener("click", start);
document.querySelectorAll("[data-filter]").forEach((button) =>
  button.addEventListener("click", () => {
    filter = button.dataset.filter;
    document
      .querySelectorAll("[data-filter]")
      .forEach((item) =>
        item.setAttribute("aria-pressed", String(item === button)),
      );
    comparisonView(months.find((m) => m.id === selected));
  }),
);
$("state-search").addEventListener("input", (event) => {
  search = event.target.value;
  comparisonView(months.find((m) => m.id === selected));
});
window.addEventListener("hashchange", expandAnchor);
window.addEventListener("popstate", () => {
  if (loaded)
    selectMonth(
      M.monthId(new URL(location.href).searchParams.get("month")) ||
        M.defaultMonth(months),
      { locationMode: null },
    );
  expandAnchor();
});
window.addEventListener("pagehide", stop);
window.addEventListener("pageshow", (event) => {
  if (event.persisted) start();
});
start();
