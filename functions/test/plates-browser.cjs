/* Actual scoreboard/API/model and existing entry flow. Only Firebase transport and
   Google identity are replaced by a local fixture; no production requests. */
const { chromium } = require("playwright");
const fs = require("node:fs"),
  http = require("node:http"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, "../..");
let mode = "normal",
  failNextWrite = false;
const records = new Map(),
  writes = [],
  reads = [];
const seed = () => {
  records.clear();
  for (const row of [
    {
      id: "january",
      month: "January",
      order: 0,
      locked: true,
      andyStates: [],
      savannahStates: [],
      manualCounts: { andy: 28, savannah: 29 },
    },
    {
      id: "february",
      month: "February",
      order: 1,
      locked: true,
      andyStates: ["Minnesota", "Iowa"],
      savannahStates: ["Minnesota", "Ohio"],
    },
    {
      id: "march",
      month: "March",
      order: 2,
      locked: true,
      andyStates: ["Minnesota", "Iowa", "Wisconsin"],
      savannahStates: ["Minnesota"],
    },
    {
      id: "april",
      month: "April",
      order: 3,
      locked: true,
      andyStates: ["Minnesota", "Iowa"],
      savannahStates: ["Minnesota"],
    },
    {
      id: "may",
      month: "May",
      order: 4,
      locked: false,
      andyStates: [],
      savannahStates: ["Minnesota", "Iowa", "Wisconsin", "Ohio"],
    },
    {
      id: "october",
      month: "October",
      order: 9,
      locked: true,
      andyStates: ["Minnesota", "Iowa", "Wisconsin", "Ohio", "Florida"],
      savannahStates: ["Minnesota", "Iowa", "Wisconsin", "Ohio"],
    },
    {
      id: "november",
      month: "November",
      order: 10,
      locked: false,
      andyStates: ["Minnesota", "Wisconsin", "Iowa"],
      savannahStates: ["Minnesota", "Iowa", "Ohio", "District of Columbia"],
    },
  ])
    records.set(row.id, row);
};
seed();
const shared = `export const app={};export const db={};export const ADMIN_EMAIL='andrewpcarlson85@gmail.com';export const SAVANNAH_EMAIL='savannahbcarlson@gmail.com';let role=new URLSearchParams(location.search).get('as')||sessionStorage.getItem('plate-role')||'guest';sessionStorage.setItem('plate-role',role);const profiles={owner:{uid:'owner',email:ADMIN_EMAIL},savannah:{uid:'savannah',email:SAVANNAH_EMAIL},pending:{uid:'pending',email:'pending@example.test'},denied:{uid:'denied',email:'denied@example.test'},other:{uid:'other',email:'other@example.test'}};export const auth={currentUser:profiles[role]||null};globalThis.__plateUid=auth.currentUser?.uid||'';export const getPersonFromEmail=email=>email===ADMIN_EMAIL?'andy':email===SAVANNAH_EMAIL?'savannah':'';export const hasSectionAccess=(session,section)=>session.isAdmin||(session.approvalStatus==='approved'&&session.approvalSections?.includes(section));let callback=null;function emit(){const user=auth.currentUser,isAdmin=user?.uid==='owner',approvalStatus=!user?'signed-out':['pending','denied'].includes(user.uid)?user.uid:'approved',approvalSections=['plates'];for(const id of ['add-plates-link','header-admin-link','header-sign-in','header-sign-out']){const el=document.getElementById(id);if(el)el.classList.toggle('hidden',id==='header-sign-in'?Boolean(user):id==='header-admin-link'?!isAdmin:id==='header-sign-out'?!user:!user||!hasSectionAccess({isAdmin,approvalStatus,approvalSections},'plates'));}document.getElementById('header-auth-status').textContent=user?'Signed in as '+user.uid:'Signed out';callback?.({user,isAdmin,approvalStatus,approvalSections,approvalPerson:getPersonFromEmail(user?.email)});}export const initHeaderAuth=options=>{callback=options?.onStateChange;queueMicrotask(emit);};globalThis.__plateIdentity=next=>{role=next;sessionStorage.setItem('plate-role',role);auth.currentUser=profiles[role]||null;globalThis.__plateUid=auth.currentUser?.uid||'';emit();};document.addEventListener('click',event=>{if(event.target.id==='header-sign-out')globalThis.__plateIdentity('guest');});`;
const sdk = `const watchers=new Set();export const collection=(db,...parts)=>({path:[db?.path,...parts].filter(Boolean).join('/')});export const doc=collection;async function call(action,p){const response=await fetch('/_plates/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});const data=await response.json();if(!response.ok)throw Error(data.error);return data;}export function onSnapshot(ref,options,next,error){if(typeof options==='function'){error=next;next=options;}let stopped=false,previous;const watcher={};watchers.add(watcher);let timer;async function refresh(){try{const data=await call('snapshot',ref);const serialized=JSON.stringify(data);if(stopped||serialized===previous)return;previous=serialized;next({empty:!data.records.length,metadata:{fromCache:data.fromCache},docs:data.records.map(record=>({id:record.id,data:()=>record}))});}catch(err){if(stopped)return;stopped=true;clearInterval(timer);watchers.delete(watcher);error?.(err);}}timer=setInterval(refresh,120);refresh();return()=>{stopped=true;clearInterval(timer);watchers.delete(watcher);};}export const arrayUnion=(...values)=>({op:'union',values});export const arrayRemove=(...values)=>({op:'remove',values});export const serverTimestamp=()=>({op:'timestamp'});export const setDoc=(ref,data,options)=>call('write',{path:ref.path,data,options,uid:globalThis.__plateUid});globalThis.__plateWatcherCount=()=>watchers.size;`;
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://local");
    if (url.pathname.startsWith("/_plates/")) {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const p = JSON.parse(raw || "{}");
      let data;
      if (url.pathname === "/_plates/snapshot") {
        reads.push(p.path);
        if (p.path !== "competitions/2026/months")
          throw Error("Unexpected collection");
        if (mode === "error") throw Error("Simulated unavailable connection");
        data = {
          records: mode === "cache-empty" ? [] : [...records.values()],
          fromCache: mode === "cached" || mode === "cache-empty",
        };
      }
      if (url.pathname === "/_plates/write") {
        if (failNextWrite) {
          failNextWrite = false;
          throw Error("Temporary write failure");
        }
        if (!["owner", "savannah"].includes(p.uid))
          throw Error("Unauthorized test write");
        const id = p.path.split("/").at(-1),
          existing = records.get(id) || {
            id,
            andyStates: [],
            savannahStates: [],
          };
        if (existing.locked) throw Error("Month is locked");
        const expected = p.uid === "owner" ? "andyStates" : "savannahStates";
        for (const key of Object.keys(p.data))
          if (!["month", "order", "updatedAt", expected].includes(key))
            throw Error("Unexpected field");
        const updated = { ...existing };
        for (const [key, value] of Object.entries(p.data)) {
          if (value?.op === "union")
            updated[key] = [
              ...new Set([...(updated[key] || []), ...value.values]),
            ];
          else if (value?.op === "remove")
            updated[key] = (updated[key] || []).filter(
              (name) => !value.values.includes(name),
            );
          else updated[key] = value;
        }
        records.set(id, updated);
        writes.push(structuredClone(p));
        data = { ok: true };
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(data));
      return;
    }
    if (url.pathname === "/js/auth-shared.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(shared);
      return;
    }
    const file = path.resolve(root, "." + url.pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader(
      "Content-Type",
      file.endsWith(".css")
        ? "text/css"
        : file.endsWith(".js")
          ? "text/javascript"
          : "text/html",
    );
    res.end(fs.readFileSync(file));
  } catch (error) {
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: error.message }));
  }
});
(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const errors = [];
  const base = "http://127.0.0.1:" + server.address().port;
  const pageFor = async (role = "guest", url = "states-competition.html") => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      timezoneId: "Pacific/Auckland",
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.setFixedTime(new Date("2026-11-10T18:00:00Z"));
    await page.route("https://fonts.googleapis.com/**", (route) =>
      route.fulfill({ contentType: "text/css", body: "" }),
    );
    await page.route(
      "https://www.gstatic.com/firebasejs/**/firebase-firestore.js",
      (route) => route.fulfill({ contentType: "text/javascript", body: sdk }),
    );
    await page.goto(
      base + "/" + url + (url.includes("?") ? "&" : "?") + "as=" + role,
    );
    return page;
  };
  let page;
  try {
    mode = "error";
    page = await pageFor();
    await page.waitForFunction(
      () =>
        document.querySelector("#sync-status").textContent ===
        "Scores unavailable",
    );
    assert.equal(await page.locator("#score-content").isVisible(), false);
    assert.ok(!(await page.locator("body").innerText()).includes("28"));
    mode = "cache-empty";
    await page.locator("#retry-scores").click();
    await page.waitForTimeout(300);
    assert.equal(
      await page.locator("#score-content").isVisible(),
      false,
      "empty local cache is not an authoritative empty season",
    );
    mode = "normal";
    await page.locator("#score-content").waitFor({ state: "visible" });
    assert.equal(await page.locator("#matchup-title").innerText(), "November");
    assert.equal(await page.locator("#andy-score").innerText(), "3");
    assert.equal(await page.locator("#savannah-score").innerText(), "4");
    assert.equal(await page.locator("#andy-wins").innerText(), "3");
    assert.equal(await page.locator("#savannah-wins").innerText(), "1");
    assert.equal(await page.locator("#season-ties").innerText(), "1");
    assert.equal(await page.locator("#month-results tr").count(), 12);
    assert.equal(await page.locator("#matchup-add").isVisible(), false);
    assert.equal(writes.length, 0);
    assert.equal(
      await page
        .locator('[data-month-row="january"] [data-cell="andy"]')
        .innerText(),
      "28",
    );
    assert.equal(
      await page
        .locator('[data-month-row="may"] [data-cell="status"]')
        .innerText(),
      "Awaiting finalization",
    );
    assert.equal(
      await page
        .locator('[data-month-row="december"] [data-cell="status"]')
        .innerText(),
      "Upcoming",
    );
    await page.screenshot({
      path: "/tmp/plates-scoreboard-desktop.png",
      fullPage: true,
    });
    await page.locator("#month-select").selectOption("january");
    assert.equal(await page.locator("#andy-score").innerText(), "28");
    assert.equal(await page.locator("#savannah-score").innerText(), "29");
    await page.locator("#plate-views summary").click();
    assert.ok(
      (await page.locator("#comparison-note").innerText()).includes(
        "were not recorded",
      ),
    );
    assert.equal(await page.locator("#comparison-table").isVisible(), false);
    await page.locator("#month-select").selectOption("november");
    await page.locator('[data-filter="both"]').click();
    assert.equal(await page.locator("#state-comparison tr").count(), 2);
    await page.locator('[data-filter="savannah"]').click();
    assert.equal(await page.locator("#state-comparison tr").count(), 2);
    await page.locator('[data-filter="andy"]').click();
    assert.equal(await page.locator("#state-comparison tr").count(), 1);
    assert.ok(
      (await page.locator("#state-comparison").innerText()).includes(
        "Wisconsin",
      ),
    );
    await page.locator("#state-search").fill("wis");
    await page.locator("#state-search").focus();
    const input = await page.locator("#state-search").elementHandle();
    records.set("november", {
      ...records.get("november"),
      andyStates: [...records.get("november").andyStates, "Arizona"],
    });
    await page.waitForFunction(
      () => document.querySelector("#andy-score").textContent === "4",
    );
    assert.equal(await page.locator("#state-search").inputValue(), "wis");
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "state-search",
    );
    assert.equal(
      await page.locator("#plate-views").evaluate((el) => el.open),
      true,
    );
    assert.equal(
      await page.locator('[data-filter="andy"]').getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(
      await input.evaluate(
        (el) => el === document.getElementById("state-search"),
      ),
      true,
    );
    assert.equal(await page.locator("#month-select").inputValue(), "november");
    const rowButton = page.locator('[data-month="march"]');
    await rowButton.focus();
    const buttonHandle = await rowButton.elementHandle();
    records.set("may", {
      ...records.get("may"),
      savannahStates: [...records.get("may").savannahStates, "Texas"],
    });
    await page.waitForFunction(
      () =>
        document.querySelector('[data-month-row="may"] [data-cell="savannah"]')
          .textContent === "5",
    );
    assert.equal(
      await page.evaluate(() => document.activeElement.dataset.month),
      "march",
    );
    assert.equal(
      await buttonHandle.evaluate(
        (el) => el === document.querySelector('[data-month="march"]'),
      ),
      true,
    );
    await rowButton.press("Enter");
    assert.equal(await page.locator("#matchup-title").innerText(), "March");
    assert.ok(page.url().includes("month=march"));
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "matchup-title",
    );
    await page.goBack();
    await page.waitForFunction(
      () => document.querySelector("#matchup-title").textContent === "November",
    );
    await page.locator("#month-select").selectOption("march");
    await page.locator("#current-month").click();
    assert.equal(await page.locator("#matchup-title").innerText(), "November");
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "month-select",
    );
    await page.locator("#yearly-stats summary").press("Enter");
    assert.ok(
      (await page.locator("#unique-note").innerText()).includes("incomplete"),
    );
    assert.ok(
      (await page.locator("#longest-streak").innerText()).includes("2 months"),
    );
    assert.ok(
      (await page.locator("#current-streak").innerText()).includes("1 month"),
    );
    await page.locator('[data-filter="all"]').click();
    await page.locator("#state-search").fill("");
    records.set("november", {
      ...records.get("november"),
      andyStates: [
        ...records.get("november").andyStates,
        "<img src=x onerror=alert(1)>",
      ],
    });
    await page.waitForFunction(() =>
      document.querySelector("#state-comparison").textContent.includes("<img"),
    );
    assert.equal(await page.locator("#state-comparison img").count(), 0);
    records.set("november", {
      ...records.get("november"),
      andyStates: records
        .get("november")
        .andyStates.filter((value) => !value.startsWith("<")),
    });
    await page.waitForFunction(
      () =>
        !document
          .querySelector("#state-comparison")
          .textContent.includes("<img"),
    );
    mode = "error";
    await page.waitForFunction(() =>
      document
        .querySelector("#sync-status")
        .textContent.includes("Updates paused"),
    );
    assert.equal(await page.locator("#andy-score").innerText(), "4");
    mode = "cached";
    await page.locator("#retry-scores").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#sync-status")
        .textContent.includes("showing saved"),
    );
    mode = "normal";
    await page.waitForFunction(
      () =>
        document.querySelector("#sync-status").textContent === "Live scores",
    );
    assert.equal(
      await page.locator("#yearly-stats").evaluate((el) => el.open),
      true,
    );
    records.set("january", {
      id: "january",
      month: "January",
      locked: true,
      andyStates: [],
      savannahStates: [],
      manualCounts: null,
    });
    await page.waitForFunction(
      () =>
        document.querySelector('[data-month-row="january"] [data-cell="andy"]')
          .textContent === "0",
    );
    assert.equal(
      await page
        .locator('[data-month-row="january"] [data-cell="result"]')
        .innerText(),
      "No result",
    );
    assert.equal(writes.length, 0, "scoreboard never writes competition data");
    records.clear();
    await page.waitForFunction(
      () => !document.querySelector("#season-empty").hidden,
    );
    assert.equal(await page.locator("#andy-score").innerText(), "0");
    assert.equal(await page.locator("#andy-wins").innerText(), "0");
    seed();
    await page.waitForFunction(
      () => document.querySelector("#andy-score").textContent === "3",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#plate-views").evaluate((el) => (el.open = false));
    await page.locator("#yearly-stats").evaluate((el) => (el.open = false));
    await page.evaluate(() => scrollTo(0, 0));
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    const accessibleResults = page.getByRole("table", {
      name: "2026 monthly results. Choose a month to view its scores and state comparison.",
    });
    assert.equal(
      await accessibleResults
        .getByRole("columnheader", { name: "Andy", exact: true })
        .count(),
      1,
    );
    assert.equal(
      await accessibleResults
        .getByRole("columnheader", { name: "Savannah", exact: true })
        .count(),
      1,
    );
    assert.equal(await accessibleResults.getByRole("row").count(), 13);
    const a = await page.locator(".plate-player.plate-andy").boundingBox(),
      s = await page.locator(".plate-player.plate-savannah").boundingBox();
    assert.equal(a.y, s.y);
    assert.ok(a.x < s.x);
    assert.ok(a.y + a.height < 844 && s.y + s.height < 844);
    await page.screenshot({
      path: "/tmp/plates-scoreboard-mobile.png",
      fullPage: true,
    });
    await page.locator("#plate-views summary").click();
    await page.screenshot({
      path: "/tmp/plates-comparison-mobile.png",
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.goto(
      base + "/states-competition.html?month=february#plate-views",
    );
    await page.locator("#score-content").waitFor({ state: "visible" });
    assert.equal(await page.locator("#matchup-title").innerText(), "February");
    assert.equal(
      await page.locator("#plate-views").evaluate((el) => el.open),
      true,
    );
    await page.goto(base + "/states-competition.html?month=invalid");
    await page.locator("#score-content").waitFor({ state: "visible" });
    assert.equal(await page.locator("#matchup-title").innerText(), "November");
    mode = "cache-empty";
    const warming = await pageFor("owner", "plate-entry.html?month=november");
    await warming.locator("#entry-panel:not(.hidden)").waitFor();
    await warming.waitForFunction(
      () => document.querySelectorAll("#state-results button").length === 51,
    );
    assert.equal(
      await warming.locator("#state-results button:not(:disabled)").count(),
      0,
      "wait for live lock information before enabling entry",
    );
    mode = "normal";
    await warming.waitForFunction(
      () => !document.querySelector("#state-results button").disabled,
    );
    await warming.close();
    const owner = await pageFor("owner");
    await owner.locator("#score-content").waitFor({ state: "visible" });
    assert.equal(await owner.locator("#matchup-add").isVisible(), true);
    await owner.locator("#month-select").selectOption("january");
    await owner.locator("#matchup-add").click();
    await owner.locator("#entry-panel:not(.hidden)").waitFor();
    assert.equal(await owner.locator("#month-select").inputValue(), "january");
    await owner.locator(".state-option").first().waitFor();
    assert.equal(
      await owner.locator(".state-option:not(:disabled)").count(),
      0,
    );
    assert.ok(
      (await owner.locator("#selected-state").innerText()).includes(
        "entry is locked",
      ),
    );
    assert.ok(
      (
        await owner.locator("#entry-scoreboard-link").getAttribute("href")
      ).includes("month=january"),
    );
    await owner.locator("#month-select").selectOption("november");
    assert.equal(await owner.locator(".state-option").count(), 51);
    await owner.locator('[data-state="Alabama"]').last().click();
    await owner.waitForFunction(() =>
      document
        .querySelector("#plate-status")
        .textContent.startsWith("Added Alabama"),
    );
    assert.ok(records.get("november").andyStates.includes("Alabama"));
    await owner.locator('#state-results [data-state="Alabama"]').click();
    await owner.waitForFunction(() =>
      document
        .querySelector("#plate-status")
        .textContent.startsWith("Removed Alabama"),
    );
    assert.ok(!records.get("november").andyStates.includes("Alabama"));
    failNextWrite = true;
    await owner.locator('#state-results [data-state="Alaska"]').click();
    await owner.waitForFunction(() =>
      document
        .querySelector("#plate-status")
        .textContent.includes("Could not update state"),
    );
    assert.equal(
      await owner
        .locator('#state-results [data-state="Alaska"]')
        .evaluate((el) => el.classList.contains("is-selected")),
      false,
    );
    assert.ok(!records.get("november").andyStates.includes("Alaska"));
    await owner.screenshot({
      path: "/tmp/plates-entry-desktop.png",
      fullPage: true,
    });
    await owner.setViewportSize({ width: 390, height: 844 });
    await owner.locator("body").screenshot({
      path: "/tmp/plates-entry-mobile.png",
      animations: "disabled",
    });
    assert.equal(
      await owner.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    const countBeforeLock = writes.length;
    records.set("november", { ...records.get("november"), locked: true });
    await owner.waitForFunction(() =>
      [...document.querySelectorAll("#state-results button")].every(
        (button) => button.disabled,
      ),
    );
    assert.equal(writes.length, countBeforeLock);
    records.set("november", { ...records.get("november"), locked: false });
    await owner.waitForFunction(
      () => !document.querySelector("#state-results button").disabled,
    );
    await owner.evaluate(() => globalThis.__plateIdentity("guest"));
    assert.equal(await owner.locator("#entry-panel").isVisible(), false);
    assert.equal(
      await owner.evaluate(() => globalThis.__plateWatcherCount()),
      0,
    );
    await owner.evaluate(() => globalThis.__plateIdentity("savannah"));
    await owner.locator("#entry-panel:not(.hidden)").waitFor();
    await owner.waitForFunction(
      () => !document.querySelector("#state-results button").disabled,
    );
    const andyBefore = [...records.get("november").andyStates];
    await owner.locator('#state-results [data-state="Alaska"]').click();
    await owner.waitForFunction(() =>
      document
        .querySelector("#plate-status")
        .textContent.startsWith("Added Alaska"),
    );
    assert.deepEqual(records.get("november").andyStates, andyBefore);
    assert.ok(records.get("november").savannahStates.includes("Alaska"));
    await owner.locator("#entry-scoreboard-link").click();
    await owner.locator("#score-content").waitFor({ state: "visible" });
    assert.equal(await owner.locator("#matchup-title").innerText(), "November");
    for (const role of ["guest", "pending", "denied", "other"]) {
      const denied = await pageFor(role, "plate-entry.html?month=november");
      await denied.waitForFunction(
        () =>
          !document.querySelector("#entry-locked").classList.contains("hidden"),
      );
      assert.equal(await denied.locator("#entry-panel").isVisible(), false);
      assert.equal(
        await denied.evaluate(() => globalThis.__plateWatcherCount()),
        0,
      );
      await denied.close();
    }
    assert.ok(reads.every((value) => value === "competitions/2026/months"));
    assert.deepEqual(errors, []);
    console.log(
      "PASS: read-only live board, loading/cache/error/retry/empty states, historical manual totals, finalized wins/ties/streaks, month links, comparison/search, XSS escaping, stable focus/filter/details during live changes, phone scores side-by-side, entry add/remove/failure/lock/auth cleanup and both player identities.",
    );
  } catch (error) {
    if (page) {
      await page.screenshot({
        path: "/tmp/plates-browser-failure.png",
        fullPage: true,
      });
      console.error(await page.locator("body").innerText());
    }
    throw error;
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
