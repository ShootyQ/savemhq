export const DESK_MODULES = [
  { id: "tasks", label: "Tasks", description: "Capture and complete the next useful actions.", required: true },
  { id: "projects", label: "Projects", description: "Group tasks around larger outcomes.", dependsOn: ["tasks"] },
  { id: "ideas", label: "Ideas & Notes", description: "Develop thoughts, notes, and sermon ideas with tags." },
  { id: "follow-ups", label: "Follow-ups", description: "Remember conversations and people to contact." },
  { id: "finance", label: "Finance Reminders", description: "Track financial commitments and deadlines." },
  { id: "ach", label: "ACH", description: "Track upcoming electronic withdrawals." },
  { id: "monthly-bills", label: "Monthly Bills", description: "Track recurring bill entry and payment." },
  { id: "payment-entries", label: "Payment Entries", description: "Track recurring payment-entry work." },
  { id: "google", label: "Google Calendar & Gmail", description: "Bring calendar events and unread mail into the dashboard." },
  { id: "guest-display", label: "Guest Display", description: "Show a private welcome screen on the TV display." },
];

export const OWNER_MODULES = ["ai-briefing", "source-copilot", "automation-inbox", "gpt-actions"];

export const DESK_PRESETS = {
  full: {
    id: "full",
    label: "Full Desk",
    description: "The complete operations setup.",
    modules: DESK_MODULES.map((module) => module.id),
  },
  pastor: {
    id: "pastor",
    label: "Pastor",
    description: "Tasks, ideas, people, and connected calendar context.",
    modules: ["tasks", "projects", "ideas", "follow-ups", "google", "guest-display"],
  },
  simple: {
    id: "simple",
    label: "Simple Desk",
    description: "A quiet place for tasks and ideas.",
    modules: ["tasks", "ideas"],
  },
};

const MODULE_IDS = new Set(DESK_MODULES.map((module) => module.id));

export const modulesForPreset = (presetId = "simple") => [
  ...(DESK_PRESETS[presetId] || DESK_PRESETS.simple).modules,
];

export const normalizeDeskModules = (value, presetId = "simple") => {
  const requested = Array.isArray(value) ? value : modulesForPreset(presetId);
  const enabled = new Set(requested.map((id) => String(id || "").trim()).filter((id) => MODULE_IDS.has(id)));

  DESK_MODULES.forEach((module) => {
    if (module.required) enabled.add(module.id);
    if (enabled.has(module.id)) (module.dependsOn || []).forEach((dependency) => enabled.add(dependency));
  });

  return DESK_MODULES.map((module) => module.id).filter((id) => enabled.has(id));
};

export const deskModuleEnabled = (modules, moduleId) => normalizeDeskModules(modules).includes(moduleId);

export const deskProfileForUser = (user, data = null, { isAdmin = false } = {}) => {
  const presetId = data?.presetId in DESK_PRESETS ? data.presetId : isAdmin ? "full" : "simple";
  return {
    ownerUid: user?.uid || "",
    email: String(data?.email || user?.email || ""),
    displayName: String(data?.displayName || user?.displayName || user?.email || "Your Desk"),
    workspaceName: String(data?.workspaceName || (isAdmin ? "Daily command desk" : "My Desk")),
    presetId,
    enabledModules: normalizeDeskModules(data?.enabledModules, presetId),
    onboardingComplete: isAdmin || data?.onboardingComplete === true,
    schemaVersion: Number(data?.schemaVersion || 1),
    createdAt: data?.createdAt || null,
    updatedAt: data?.updatedAt || null,
  };
};