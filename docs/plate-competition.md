# Plate competition: scores first

The public `states-competition.html` presents a selected-month matchup, finalized season wins, twelve compact monthly results, a searchable state comparison, and expandable season statistics. The private `plate-entry.html` retains tap-to-toggle state entry with coordinated styling and month links. The 2026 season and 50 states plus D.C. remain unchanged.

## Implementation

- Phase 1: pure scoring and month-selection rules in `js/plates/model.js`; read-only snapshot transport in `js/plates/api.js`.
- Phase 2: focused scoreboard controller in `js/plates/app.js`; page-scoped `plates.css`. Shared site styles, header modules and authentication are not modified.
- Phase 3: entry keeps its existing array-union/remove writes, recent picks, assigned player and approval checks. It carries `?month=november` between pages, waits for a live lock snapshot before allowing edits, blocks locked months, and clears its subscription on sign-out.
- Phase 4: local unit/browser verification is complete. Merge the website PR for GitHub Pages publication, then perform the real-account pilot below.

## Scores, standings and history

Data remains under `competitions/2026/months/{monthId}`. Valid paired manual counts take precedence over state-array lengths, including the historical January 28/29 example. No scores, arrays, locks or historical records are rewritten or migrated.

Only locked nonempty results award a season win or tie. A locked 0–0 month is Final / No result, with neither a win nor tie. Past unlocked months remain Awaiting finalization. A season lead is described as a lead, not a championship before the season ends.

Streaks mean consecutive finalized calendar-month wins. Ties, locked empty results and intervening unlocked/missing months break runs; trailing unfinished months do not erase the latest completed run. Equal longest streaks credit both players.

State-count totals sum monthly scores; distinct-state statistics use available state logs. Total-only or partial historical records are labeled incomplete, not presented as zero states seen. State comparisons use only logged names, and “only” means only in those available logs.

## Loading and navigation

The scoreboard does not seed or modify competition records. Empty successful server snapshots remain empty; legacy sample counts are never injected. Cached data is labeled as saved, an empty cache waits for a server result, and a failed connection retains the last available scores with Updates paused and a retry action. Shared authentication continues its existing approval-record behavior.

The current month is determined in America/Chicago while viewing the 2026 season. Outside that year, default to the latest recorded month, or January when none exist. No new season is created automatically. Valid month URLs and the existing `#monthly-scoreboard`, `#plate-views`, and `#yearly-stats` anchors work. Browser Back restores month selection. State filters, search, expanded sections and focused controls survive live updates.

## Validation

```sh
npm --prefix functions run test:plates
npm --prefix functions run test:plates:browser
npm --prefix functions run test:teams:browser
npm --prefix functions run test:admin:browser
```

The plate suite has 12 pure scoring tests. The browser workflow runs the real scoreboard/API/model and entry page with isolated Firebase transport and fixture identities. It checks live loading/cache/error/retry/empty behavior; absence of competition writes from the board; manual totals; wins, ties and streaks; navigation and browser Back; comparison/search; escaped stored text; stable live-update focus; mobile table accessibility and side-by-side scores; entry add/remove/failure recovery; fresh lock checks; sign-out cleanup; both players; and signed-out/pending/denied/unmapped access gates. It does not prove production Google sign-in or deployed network access.

Browser tests require Chromium (default `/usr/bin/chromium`; override `CHROMIUM_PATH`). Preview images use sample data and are written under `/tmp/plates-*`. Existing Desk/Teams and admin browser regressions pass. No rules, indexes, Functions or Storage deployment is required.

## Publication and real-account pilot

1. Merge the website PR and wait for GitHub Pages to publish.
2. Open the public scoreboard on desktop and a phone. Confirm the selected/current month, stored January manual totals, season standings, legacy anchors and state details against the existing records.
3. Sign in as each player and confirm month context, their own selected states, lock feedback and links back to the scoreboard. Verify a real add/remove only on an unlocked month with the owner’s intended test state, then return it to its original state.
4. Confirm unauthenticated visitors can read scores but cannot enter states. Confirm the admin lock interface still preserves scores.

Production inspection is outstanding: the cloud network did not permit access to www.savemhq.com during implementation. No production data was accessed or altered for these tests.
