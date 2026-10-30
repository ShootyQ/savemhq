// Shared policy and validation: used by browser and authoritative server commands.
(function (root, factory) {
  const model = factory();
  if (typeof module === "object" && module.exports) module.exports = model;
  else root.TeamModel = model;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const STATUSES = ["todo", "in-progress", "blocked", "done", "cancelled"];
  const LABELS = {
    todo: "To do",
    "in-progress": "In progress",
    blocked: "Blocked",
    done: "Done",
    cancelled: "Cancelled",
  };
  const manages = (role) => role === "owner" || role === "leader";
  const progress = (tasks) => {
    const included = tasks.filter((t) => t.status !== "cancelled");
    const done = included.filter((t) => t.status === "done").length;
    return {
      done,
      total: included.length,
      percent: included.length ? Math.round((done / included.length) * 100) : 0,
    };
  };
  const text = (value, max = 120, required = true) => {
    if (
      typeof value !== "string" ||
      value.trim().length > max ||
      (required && !value.trim())
    )
      throw Error("Enter valid text (up to " + max + " characters).");
    return value.trim();
  };
  const date = (value) => {
    if (value === "") return "";
    if (
      typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value + "T12:00:00Z")) ||
      new Date(value + "T12:00:00Z").toISOString().slice(0, 10) !== value
    )
      throw Error("Enter a valid date.");
    return value;
  };
  const email = (value) => {
    const normalized = text(value, 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))
      throw Error("Enter a valid email address.");
    return normalized;
  };
  const choice = (value, choices) => {
    if (!choices.includes(value)) throw Error("Choose a valid option.");
    return value;
  };
  return { STATUSES, LABELS, manages, progress, text, date, email, choice };
});
