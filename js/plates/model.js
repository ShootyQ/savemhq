/* Pure competition rules, shared by the browser and Node tests. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PlateModel = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const YEAR = 2026;
  const MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const STATES = [
    "Alabama",
    "Alaska",
    "Arizona",
    "Arkansas",
    "California",
    "Colorado",
    "Connecticut",
    "Delaware",
    "Florida",
    "Georgia",
    "Hawaii",
    "Idaho",
    "Illinois",
    "Indiana",
    "Iowa",
    "Kansas",
    "Kentucky",
    "Louisiana",
    "Maine",
    "Maryland",
    "Massachusetts",
    "Michigan",
    "Minnesota",
    "Mississippi",
    "Missouri",
    "Montana",
    "Nebraska",
    "Nevada",
    "New Hampshire",
    "New Jersey",
    "New Mexico",
    "New York",
    "North Carolina",
    "North Dakota",
    "Ohio",
    "Oklahoma",
    "Oregon",
    "Pennsylvania",
    "Rhode Island",
    "South Carolina",
    "South Dakota",
    "Tennessee",
    "Texas",
    "Utah",
    "Vermont",
    "Virginia",
    "Washington",
    "West Virginia",
    "Wisconsin",
    "Wyoming",
    "District of Columbia",
  ];
  const monthId = (value) =>
    MONTHS.find(
      (name) =>
        name.toLowerCase() ===
        String(value || "")
          .trim()
          .toLowerCase(),
    )?.toLowerCase() || "";
  const chicagoDate = (now = new Date()) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "numeric",
    }).formatToParts(now);
    return {
      year: Number(parts.find((p) => p.type === "year").value),
      index: Number(parts.find((p) => p.type === "month").value) - 1,
    };
  };
  const manualNumber = (value) =>
    value !== null &&
    value !== undefined &&
    String(value).trim() !== "" &&
    ["number", "string"].includes(typeof value) &&
    Number.isFinite(Number(value)) &&
    Number(value) >= 0;
  const stateNames = (values) =>
    [
      ...new Set(
        values
          .filter((v) => typeof v === "string" && v.trim())
          .map(
            (value) =>
              STATES.find(
                (name) => name.toLowerCase() === value.trim().toLowerCase(),
              ) || value.trim(),
          ),
      ),
    ].sort((a, b) => a.localeCompare(b));
  function buildMonths(records, now = new Date()) {
    const byId = new Map();
    for (const record of records) {
      const key = monthId(record.id) || monthId(record.month);
      if (key) byId.set(key, record);
    }
    const calendar = chicagoDate(now);
    return MONTHS.map((name, index) => {
      const id = name.toLowerCase(),
        record = byId.get(id),
        data = record || {};
      const andyRaw = Array.isArray(data.andyStates) ? data.andyStates : [],
        savannahRaw = Array.isArray(data.savannahStates)
          ? data.savannahStates
          : [];
      const manual =
        manualNumber(data.manualCounts?.andy) &&
        manualNumber(data.manualCounts?.savannah);
      const andy = manual ? Number(data.manualCounts.andy) : andyRaw.length,
        savannah = manual
          ? Number(data.manualCounts.savannah)
          : savannahRaw.length;
      const andyStates = stateNames(andyRaw),
        savannahStates = stateNames(savannahRaw);
      const locked = data.locked === true,
        hasScore = andy + savannah > 0;
      const winner = !hasScore
        ? null
        : andy === savannah
          ? "tie"
          : andy > savannah
            ? "andy"
            : "savannah";
      const past =
        calendar.year > YEAR ||
        (calendar.year === YEAR && index < calendar.index);
      const future =
        calendar.year < YEAR ||
        (calendar.year === YEAR && index > calendar.index);
      const status = locked
        ? "Final"
        : past
          ? "Awaiting finalization"
          : future
            ? "Upcoming"
            : "In progress";
      const winnerName = winner === "andy" ? "Andy" : "Savannah",
        difference = Math.abs(andy - savannah);
      const result = !hasScore
        ? locked
          ? "No result"
          : future
            ? "Not started"
            : "No states logged yet"
        : winner === "tie"
          ? `Tied at ${andy}`
          : `${winnerName} ${locked ? "won" : "leads"} by ${difference}`;
      return {
        id,
        name,
        index,
        exists: Boolean(record),
        andy,
        savannah,
        andyStates,
        savannahStates,
        manual,
        locked,
        hasScore,
        winner,
        status,
        result,
        total: andy + savannah,
        isCurrent: calendar.year === YEAR && calendar.index === index,
        incomplete:
          andy !== andyStates.length || savannah !== savannahStates.length,
      };
    });
  }
  function defaultMonth(months, now = new Date()) {
    const date = chicagoDate(now);
    return date.year === YEAR
      ? MONTHS[date.index].toLowerCase()
      : [...months].reverse().find((m) => m.exists)?.id || "january";
  }
  function comparison(month, filter = "all", search = "") {
    const andy = new Set(month.andyStates),
      savannah = new Set(month.savannahStates);
    const names = [...new Set([...andy, ...savannah])].sort((a, b) =>
      a.localeCompare(b),
    );
    return names
      .map((name) => ({
        name,
        andy: andy.has(name),
        savannah: savannah.has(name),
      }))
      .filter(
        (row) =>
          (filter === "all" ||
            (filter === "both" && row.andy && row.savannah) ||
            (filter === "andy" && row.andy && !row.savannah) ||
            (filter === "savannah" && row.savannah && !row.andy)) &&
          row.name.toLowerCase().includes(search.trim().toLowerCase()),
      );
  }
  function seasonStats(months, now = new Date()) {
    const finalized = months.filter((m) => m.locked),
      wins = { andy: 0, savannah: 0 },
      longestByPlayer = { andy: 0, savannah: 0 };
    let ties = 0,
      run = { player: null, count: 0 };
    for (const month of months) {
      if (month.locked && month.winner && month.winner !== "tie") {
        wins[month.winner]++;
        run =
          run.player === month.winner
            ? { player: run.player, count: run.count + 1 }
            : { player: month.winner, count: 1 };
        longestByPlayer[run.player] = Math.max(
          longestByPlayer[run.player],
          run.count,
        );
      } else {
        if (month.locked && month.winner === "tie") ties++;
        run = { player: null, count: 0 };
      }
    }
    const lastFinal = months.findLastIndex((m) => m.locked);
    const current = { player: null, count: 0 };
    if (
      lastFinal >= 0 &&
      months[lastFinal].winner &&
      months[lastFinal].winner !== "tie"
    ) {
      current.player = months[lastFinal].winner;
      for (
        let i = lastFinal;
        i >= 0 && months[i].locked && months[i].winner === current.player;
        i--
      )
        current.count++;
    }
    const longest = Math.max(...Object.values(longestByPlayer));
    const longestPlayers = Object.keys(longestByPlayer).filter(
      (p) => longest > 0 && longestByPlayer[p] === longest,
    );
    const combined = new Set(
      months.flatMap((m) => [...m.andyStates, ...m.savannahStates]),
    );
    const andyUnique = new Set(months.flatMap((m) => m.andyStates)),
      savannahUnique = new Set(months.flatMap((m) => m.savannahStates));
    const totals = months.reduce(
      (sum, m) => ({
        andy: sum.andy + m.andy,
        savannah: sum.savannah + m.savannah,
      }),
      { andy: 0, savannah: 0 },
    );
    const bestTotal = Math.max(...months.map((m) => m.total));
    const bestMonths =
      bestTotal > 0
        ? months.filter((m) => m.total === bestTotal).map((m) => m.name)
        : [];
    const leader =
      wins.andy === wins.savannah
        ? null
        : wins.andy > wins.savannah
          ? "Andy"
          : "Savannah";
    const finished = finalized.length === 12 && chicagoDate(now).year > YEAR;
    const lead = leader
      ? `${leader} ${finished ? "wins the season" : "leads the season"} by ${Math.abs(wins.andy - wins.savannah)} monthly win${Math.abs(wins.andy - wins.savannah) === 1 ? "" : "s"}`
      : wins.andy + wins.savannah + ties === 0
        ? "No scored months finalized yet"
        : finished
          ? "The season finished level"
          : "Season wins are even";
    return {
      wins,
      ties,
      finalized: finalized.length,
      noResult: finalized.filter((m) => !m.hasScore).length,
      totals,
      unique: combined.size,
      andyUnique: andyUnique.size,
      savannahUnique: savannahUnique.size,
      incomplete: months.some((m) => m.incomplete),
      bestTotal,
      bestMonths,
      current,
      longest,
      longestPlayers,
      lead,
    };
  }
  return {
    YEAR,
    MONTHS,
    STATES,
    monthId,
    chicagoDate,
    buildMonths,
    defaultMonth,
    comparison,
    seasonStats,
  };
});
