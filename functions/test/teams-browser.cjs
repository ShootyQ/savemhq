// Real Teams UI/API and server service; isolated auth/Firestore network transport.
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
const { TeamsStore } = require("./helpers/teams-store");
const { createService } = require("../teams/service");
const root = path.resolve(__dirname, "../.."),
  db = new TeamsStore(),
  service = createService(db);
let failNext = false,
  lostResponse = false;
const reads = [];
for (const uid of ["owner", "member", "outsider"]) {
  db.seed("loginApprovals/" + uid, {
    email: uid + "@example.test",
    status: "approved",
    accessSections: ["desk"],
  });
  db.seed("workrooms/" + uid, {
    ownerUid: uid,
    email: uid + "@example.test",
    displayName: uid,
    workspaceName: uid + " Desk",
    presetId: "simple",
    enabledModules: ["tasks", "projects"],
    onboardingComplete: true,
    schemaVersion: 1,
  });
  db.seed("workrooms/" + uid + "/tasks/personal", {
    title: uid + " PERSONAL SECRET",
    status: "next",
    priority: "low",
    projectId: "",
    notes: "Private",
  });
}
const auth = (uid) => ({
  uid,
  token: {
    email: uid + "@example.test",
    email_verified: true,
    name: uid.toUpperCase(),
  },
});
const shared = `export const ADMIN_EMAIL='andrewpcarlson85@gmail.com';export const db={};const params=new URLSearchParams(location.search);const uid=params.get('as')||sessionStorage.getItem('testUid')||'owner';sessionStorage.setItem('testUid',uid);export const auth={currentUser:{uid,email:uid+'@example.test',displayName:uid.toUpperCase(),emailVerified:true}};globalThis.__uid=uid;const callbacks=new Set();export const __on=cb=>{callbacks.add(cb);queueMicrotask(()=>cb(auth.currentUser));return()=>callbacks.delete(cb);};export function __emit(){for(const cb of callbacks)cb(auth.currentUser);}export async function ensureApprovalRecord(user){const r=await fetch('/_get',{method:'POST',body:JSON.stringify({path:'loginApprovals/'+user.uid})});return await r.json();}export const initHeaderAuth=({onStateChange})=>__on(user=>{document.querySelector('#header-sign-out').classList.toggle('hidden',!user);document.querySelector('#header-auth-status').textContent=user?user.email:'Signed out';onStateChange({user,isAdmin:false});});export function __signout(){auth.currentUser=null;__emit();}document.addEventListener('click',event=>{if(event.target.id==='header-sign-out')__signout();});`;
const sdk = `const watchers=new Set();async function call(action,p){const r=await fetch('/_'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});const d=await r.json();if(!r.ok)throw Error(d.error);return d;}export const collection=(db,...parts)=>({path:[db?.path,...parts].filter(Boolean).join('/')});export const doc=collection;export const where=(field,op,value)=>({field,op,value});export const limit=value=>({limit:value});export const orderBy=(field,order)=>({orderBy:field,order});export const query=(ref,...filters)=>({...ref,filters});export const Timestamp={fromDate:d=>({toDate:()=>d,toMillis:()=>d.getTime()})};const documentSnap=(path,data)=>({id:path.split('/').at(-1),exists:()=>data!==null,data:()=>data});export async function getDoc(ref){return documentSnap(ref.path,await call('get',ref));}export function onSnapshot(ref,next,error){let stopped=false,previous;const watcher={};watchers.add(watcher);const refresh=async()=>{try{const data=await call(ref.path.split('/').length%2===0?'get':'list',ref);const json=JSON.stringify(data);if(!stopped&&json!==previous){previous=json;next(Array.isArray(data)?{docs:data.map(d=>documentSnap(ref.path+'/'+d.id,d))}:documentSnap(ref.path,data));}}catch(err){if(!stopped)error?.(err);}};refresh();const timer=setInterval(refresh,150);return()=>{stopped=true;clearInterval(timer);watchers.delete(watcher);};}export const serverTimestamp=()=>new Date().toISOString();export async function setDoc(ref,data){return call('write',{path:ref.path,data});}export const updateDoc=setDoc;export const deleteDoc=ref=>call('delete',ref);export const addDoc=async(ref,data)=>{const id=crypto.randomUUID();await setDoc({path:ref.path+'/'+id},data);return{id};};globalThis.__watcherCount=()=>watchers.size;`;
const functionsSdk = `export const getFunctions=()=>({});export const httpsCallable=(functions,name)=>async input=>{const r=await fetch('/_command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid:globalThis.__uid,input})});const data=await r.json();if(!r.ok)throw Error(data.error);return {data};};`;
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://local");
    if (url.pathname.startsWith("/_")) {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const p = JSON.parse(raw || "{}");
      let data;
      if (url.pathname === "/_command") {
        if (failNext) {
          failNext = false;
          throw Error("Temporary save failure");
        }
        data = await service(auth(p.uid), p.input);
        if (lostResponse) {
          lostResponse = false;
          throw Error("Response lost; retry this save");
        }
      }
      if (url.pathname === "/_get") {
        reads.push(p.path);
        data = db.read(p.path) || null;
      }
      if (url.pathname === "/_list") {
        reads.push(p.path);
        data = [...db.rows]
          .filter(
            ([key, value]) =>
              key.startsWith(p.path + "/") &&
              key.split("/").length === p.path.split("/").length + 1 &&
              (p.filters || []).every(
                (f) => !f.field || value[f.field] === f.value,
              ),
          )
          .map(([key, value]) => ({ ...value, id: key.split("/").at(-1) }));
        for (const filter of p.filters || []) {
          if (filter.orderBy)
            data.sort(
              (a, b) =>
                String(a[filter.orderBy]).localeCompare(
                  String(b[filter.orderBy]),
                ) * (filter.order === "desc" ? -1 : 1),
            );
          if (filter.limit) data = data.slice(0, filter.limit);
        }
      }
      if (url.pathname === "/_write") {
        db.seed(p.path, { ...db.read(p.path), ...p.data });
        data = {};
      }
      if (url.pathname === "/_delete") {
        db.rows.delete(p.path);
        data = {};
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
      res.end("Not found");
      return;
    }
    res.setHeader(
      "Content-Type",
      file.endsWith(".js")
        ? "text/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : "text/html",
    );
    res.end(fs.readFileSync(file));
  } catch (err) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: err.message }));
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
  async function pageFor(uid) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      timezoneId: "America/Chicago",
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => {
      errors.push(err.message);
      console.error("Browser error:", err.message);
    });
    page.on("dialog", (d) => d.accept());
    page.on("requestfailed", (r) =>
      console.error("Request failed:", r.url(), r.failure()?.errorText),
    );
    page.on("console", (m) => {
      if (m.type() === "error") console.error("Console:", m.text());
    });
    await page.route("https://fonts.googleapis.com/**", (r) =>
      r.fulfill({ contentType: "text/css", body: "" }),
    );
    await page.route(
      "https://www.gstatic.com/firebasejs/**/firebase-firestore.js",
      (r) => r.fulfill({ contentType: "text/javascript", body: sdk }),
    );
    await page.route(
      "https://www.gstatic.com/firebasejs/**/firebase-functions.js",
      (r) => r.fulfill({ contentType: "text/javascript", body: functionsSdk }),
    );
    await page.route(
      "https://www.gstatic.com/firebasejs/**/firebase-auth.js",
      (r) =>
        r.fulfill({
          contentType: "text/javascript",
          body: `import {__on,__signout} from '${base}/js/auth-shared.js';export const onAuthStateChanged=(a,cb)=>__on(cb);export class GoogleAuthProvider{};export const signInWithPopup=async()=>{};export const signOut=async()=>__signout();`,
        }),
    );
    await page.goto(base + "/teams.html?as=" + uid);
    await page.locator("#teams-app").waitFor({ state: "visible" });
    return page;
  }
  const owner = await pageFor("owner");
  const save = async (page) => {
    await page.locator("#save-editor").click();
    await page.waitForFunction(() => !document.querySelector("#editor").open);
  };
  try {
    await owner.locator("#create-room").click();
    await owner.getByLabel("Room name", { exact: true }).fill("Launch crew");
    await owner
      .getByLabel("What is this room for?")
      .fill("Build and ship useful things.");
    await save(owner);
    await owner.locator("#create-project").waitFor({ state: "visible" });
    const roomId = [...db.rows.keys()]
      .find((k) => k.startsWith("teamRooms/") && k.split("/").length === 2)
      .split("/")[1];
    await owner.locator("#members-toggle").click();
    await owner
      .locator('#invite-form input[name="email"]')
      .fill("member@example.test");
    await owner.locator("#invite-form button").click();
    await owner.locator("[data-copy-invite]").waitFor();
    const invitation = [...db.rows]
      .find(([k]) => k.startsWith("teamInvites/"))[0]
      .split("/")[1];
    assert.equal(
      db.read("teamRooms/" + roomId).memberCount,
      1,
      "invite alone does not grant membership",
    );
    await owner.locator("#close-people").click();
    const member = await pageFor("member");
    await member.locator("[data-accept]").click();
    await member.locator("#room-work").waitFor({ state: "visible" });
    await member.waitForFunction(() =>
      document.querySelector("#my-role").textContent.includes("member"),
    );
    assert.equal(await member.locator("#create-project").isVisible(), false);
    await owner.locator("#create-project").click();
    await owner
      .getByLabel("Project name", { exact: true })
      .fill("Website launch");
    await owner.getByLabel("Project description").fill("A shared project.");
    await owner.getByLabel("Target date (optional)").fill("2026-11-15");
    await save(owner);
    await owner.locator("#create-task").waitFor({ state: "visible" });
    await owner.locator("#create-task").click();
    await owner
      .getByLabel("Task title", { exact: true })
      .fill("Build landing page");
    await owner
      .getByLabel("Details", { exact: true })
      .fill("Polish the layout and check mobile.");
    await owner
      .getByLabel("Assigned to", { exact: true })
      .selectOption("member");
    await owner.getByLabel("Due date (optional)").fill("2026-11-01");
    lostResponse = true;
    await owner.locator("#save-editor").click();
    await owner.waitForFunction(() =>
      document
        .querySelector("#editor-error")
        .textContent.includes("Response lost"),
    );
    assert.equal(
      await owner.getByLabel("Task title", { exact: true }).inputValue(),
      "Build landing page",
    );
    await save(owner);
    assert.equal(
      [...db.rows.keys()].filter((k) =>
        k.startsWith("teamRooms/" + roomId + "/tasks/"),
      ).length,
      1,
      "uncertain-response retry creates one task",
    );
    await member.locator("[data-open-task]").waitFor();
    assert.equal(await member.locator("[data-edit-task]").count(), 0);
    await member.locator("[data-task-status]").selectOption("in-progress");
    await member.waitForFunction(
      () => document.querySelector("#notice").textContent === "Saved.",
    );
    await member
      .locator('[data-task-status] option[value="in-progress"][selected]')
      .waitFor({ state: "attached" });
    await member.locator("[data-open-task]").click();
    await member
      .locator("#comment-body")
      .fill("Ready for review <img src=x onerror=alert(1)>");
    failNext = true;
    await member.locator("#comment-form button").click();
    await member.waitForFunction(() =>
      document
        .querySelector("#comment-status")
        .textContent.includes("Temporary save failure"),
    );
    assert.ok(
      (await member.locator("#comment-body").inputValue()).includes(
        "Ready for review",
      ),
    );
    lostResponse = true;
    await member.locator("#comment-form button").click();
    await member.waitForFunction(() =>
      document
        .querySelector("#comment-status")
        .textContent.includes("Response lost"),
    );
    await member.locator("#comment-form button").click();
    await member.waitForFunction(
      () => document.querySelector("#comment-body").value === "",
    );
    await member.locator(".comment").waitFor();
    assert.equal(
      [...db.rows.keys()].filter((key) => key.includes("/comments/")).length,
      1,
      "retry after lost comment response does not duplicate",
    );
    assert.equal(await member.locator("#comments img").count(), 0);
    await member.locator("#close-task").click();
    // An open edit draft survives live updates; stale version is rejected without losing it.
    await owner.locator("[data-edit-task]").click();
    await owner
      .getByLabel("Task title", { exact: true })
      .fill("My unsaved draft");
    await member.locator("[data-task-status]").selectOption("blocked");
    await member.waitForFunction(
      () => document.querySelector("#notice").textContent === "Saved.",
    );
    await owner.waitForTimeout(350);
    assert.equal(
      await owner.getByLabel("Task title", { exact: true }).inputValue(),
      "My unsaved draft",
    );
    await owner.locator("#save-editor").click();
    await owner.waitForFunction(() =>
      document
        .querySelector("#editor-error")
        .textContent.includes("record changed"),
    );
    await owner.locator("#cancel-editor").click();
    await member.locator('[data-filter="mine"]').click();
    assert.equal(await member.locator(".task").count(), 1);
    await member.locator('[data-filter="people"]').click();
    assert.ok(
      (await member.locator("#task-list").innerText()).includes("MEMBER"),
    );
    await owner.screenshot({
      path: "/tmp/teams-project-desktop.png",
      fullPage: true,
    });
    await member.setViewportSize({ width: 390, height: 844 });
    await member.screenshot({
      path: "/tmp/teams-project-mobile.png",
      fullPage: true,
    });
    assert.equal(
      await member.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    // Both existing Desk entry points read the same task and write through teamCommand.
    await member.goto(base + "/workroom-control.html");
    await member
      .waitForFunction(
        () =>
          !document
            .querySelector("#workroom-control")
            .classList.contains("hidden"),
        {},
        { timeout: 5000 },
      )
      .catch(async (err) => {
        console.error(
          "Control gate:",
          await member.locator("#workroom-gate-message").innerText(),
        );
        console.error(
          "Scripts",
          await member.evaluate(() =>
            performance.getEntriesByType("resource").map((r) => r.name),
          ),
        );
        throw err;
      });
    await member.locator('[data-workroom-view="work"]').click();
    await member.locator('#workroom-tasks a[href^="teams.html?"]').waitFor();
    assert.ok(
      (await member.locator("#workroom-tasks").innerText()).includes(
        "member PERSONAL SECRET",
      ),
    );
    assert.ok(
      !(await member.locator("body").innerText()).includes(
        "owner PERSONAL SECRET",
      ),
    );
    assert.equal(
      await member
        .locator('#workroom-tasks [data-delete-task^="team_"]')
        .count(),
      0,
    );
    await member
      .locator('#workroom-tasks [data-complete-task^="team_"]')
      .click();
    await owner.waitForFunction(() =>
      document
        .querySelector("#project-heading")
        .textContent.includes("100% complete"),
    );
    await member.goto(base + "/workroom.html");
    await member.waitForFunction(
      () =>
        document.querySelector("#workroom-completed-count").textContent === "1",
    );
    assert.ok((await member.locator('a[href="teams.html"]').count()) > 0);
    await member.goto(base + "/teams.html");
    await member.locator("[data-task-status]").waitFor();
    await member.locator("[data-task-status]").selectOption("todo");
    await member.waitForFunction(
      () => document.querySelector("#notice").textContent === "Saved.",
    );
    await member.goto(base + "/workroom.html");
    await member.locator("#workroom-open-all").click();
    await member
      .locator('#workroom-all-groups a[href^="teams.html?"]')
      .waitFor();
    await member
      .locator('#workroom-all-groups [data-complete-task^="team_"]')
      .click();
    await owner.waitForFunction(() =>
      document
        .querySelector("#project-heading")
        .textContent.includes("100% complete"),
    );
    await member.goto(base + "/teams.html");
    await member.locator("#room-work").waitFor({ state: "visible" });
    await owner.locator("#members-toggle").click();
    await owner.locator('[data-remove-member="member"]').click();
    await member.waitForFunction(
      () => document.querySelector("#room-work").hidden,
    );
    assert.equal(await member.locator("#task-list").innerText(), "");
    await owner.locator("#close-people").click();
    await owner.locator("#header-sign-out").click();
    await owner.waitForFunction(
      () => document.querySelector("#teams-app").hidden,
    );
    assert.equal(await owner.evaluate(() => globalThis.__watcherCount()), 0);
    assert.equal(await owner.locator("#project-list").innerText(), "");
    // A delayed access check must not restart private subscriptions after sign-out.
    await member.route("**/_get", async (route) => {
      const body = route.request().postDataJSON();
      if (body.path === "loginApprovals/member")
        await new Promise((resolve) => setTimeout(resolve, 250));
      await route.continue();
    });
    await member.goto(base + "/workroom-control.html", {
      waitUntil: "domcontentloaded",
    });
    await member.evaluate(async () => {
      const auth = await import("/js/auth-shared.js");
      auth.__signout();
    });
    await member.waitForTimeout(500);
    assert.equal(await member.locator("#workroom-control").isVisible(), false);
    assert.equal(await member.evaluate(() => globalThis.__watcherCount()), 0);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: real team service + UI create/invite/accept/project/assignment/comments, uncertain retry deduplication, failed saves, XSS escape, live draft conflict, My/By-person views, desktop/mobile, canonical completion from both Desk views, removal and sign-out cleanup.",
    );
  } catch (err) {
    await owner.screenshot({
      path: "/tmp/teams-browser-failure.png",
      fullPage: true,
    });
    console.error(await owner.locator("body").innerText());
    throw err;
  } finally {
    await browser.close();
    server.close();
  }
})().catch((err) => {
  console.error(err);
  server.close();
  process.exitCode = 1;
});
