// Paste this as the contents of the last <script> in index.html ("YOUR APP" section).
//
// Saved data looks like:
// {
//   plan:    { "2026-10-01": { lunch: {name, description, link, note}, dinner: {...} }, ... },
//   archive: { "2026-09-30": { lunch: {...}, dinner: {...} }, ... }
// }
// Days before today are moved from plan to archive whenever the app loads,
// at midnight while it's open, and when you come back to it after midnight.

const DAYS_AHEAD = 14;
const SLOTS = [["lunch", "Lunch"], ["dinner", "Dinner"]];
const ARCHIVE_PAGE = 30; // days of history shown before "Show more"

let model = null;        // normalized copy of the data we're showing
let busy = false;        // true while an edit is being saved
let editing = null;      // { date, slot } of the meal in the dialog
let archiveLimit = ARCHIVE_PAGE;
let shownDay = todayKey();

const $ = (id) => document.getElementById(id);

// ---------- dates ----------
function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function todayKey() { return dateKey(new Date()); }
function keyToDate(k) { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
}
function weekday(d, style = "short") { return d.toLocaleDateString(undefined, { weekday: style }); }
function monthDay(d) { return d.toLocaleDateString(undefined, { day: "numeric", month: "short" }); }

// ---------- data ----------
function normalize(data) {
  const d = data && typeof data === "object" && !Array.isArray(data) ? JSON.parse(JSON.stringify(data)) : {};
  if (!d.plan || typeof d.plan !== "object") d.plan = {};
  if (!d.archive || typeof d.archive !== "object") d.archive = {};
  return d;
}

// Moves every day before today from plan into archive. Returns true if anything moved.
function archivePast(d) {
  const today = todayKey();
  let changed = false;
  for (const key of Object.keys(d.plan)) {
    if (key >= today) continue;
    const day = d.plan[key];
    if (day && (day.lunch || day.dinner)) d.archive[key] = { ...(d.archive[key] || {}), ...day };
    delete d.plan[key];
    changed = true;
  }
  return changed;
}

function cleanLink(raw) {
  const s = (raw || "").trim();
  if (!s) return "";
  return /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : "https://" + s;
}
function safeHref(link) { return /^https?:\/\//i.test(link) ? link : null; }
function linkLabel(link) {
  try { return new URL(link).hostname.replace(/^www\./, ""); } catch { return link; }
}

// Called by the template whenever data is loaded.
function renderApp(data) {
  const d = normalize(data);
  if (archivePast(d) && !busy) {
    Promise.resolve(save(d)).catch(() => {});
  }
  model = d;
  draw();
}

// Fetch the latest data, apply a change, save it.
async function change(mutate) {
  busy = true;
  setStatus("Saving…");
  try { await refresh(); } catch { /* offline: work from what we have */ }
  const d = normalize(currentData);
  archivePast(d);
  mutate(d);
  model = d;
  draw();
  let ok = false;
  try { ok = await save(d); } catch { ok = false; }
  busy = false;
  if (ok) {
    setStatus("Saved");
    setTimeout(() => { if ($("mpStatus").textContent === "Saved") setStatus(""); }, 1500);
  } else {
    setStatus("Not saved to Dropbox. Check your connection, then save the meal again.", true);
  }
}

function setStatus(text, isError = false) {
  const s = $("mpStatus");
  s.textContent = text;
  s.classList.toggle("is-error", isError);
}

// ---------- drawing ----------
function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "dataset") Object.assign(e.dataset, v);
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) e.append(c);
  return e;
}

function mealContent(meal) {
  return [
    el("span", { class: "mp-name" }, meal.name),
    meal.description && el("span", { class: "mp-desc" }, meal.description),
    meal.note && el("span", { class: "mp-note" }, meal.note),
  ];
}

function mealLink(meal) {
  const href = meal.link && safeHref(meal.link);
  return href && el("a", { class: "mp-link", href, target: "_blank", rel: "noopener noreferrer" }, linkLabel(href));
}

function draw() {
  if (!model) return;
  shownDay = todayKey();
  drawPlan();
  drawArchive();
  fillSuggestions();
}

function drawPlan() {
  const box = $("mpPlan");
  box.replaceChildren();
  const today = keyToDate(todayKey());
  let lastWeek = null;

  for (let i = 0; i < DAYS_AHEAD; i++) {
    const date = addDays(today, i);
    const key = dateKey(date);
    const week = isoWeek(date);
    if (week !== lastWeek) {
      box.append(el("h3", { class: "mp-week" }, `Week ${week}`));
      lastWeek = week;
    }
    const dow = date.getDay();
    const label = i === 0 ? "Today" : i === 1 ? "Tomorrow" : weekday(date);
    const day = model.plan[key] || {};

    box.append(el("div", {
      class: ["mp-day", i === 0 && "is-today", (dow === 0 || dow === 6) && "is-weekend"].filter(Boolean).join(" "),
    },
      el("div", { class: "mp-date" }, el("b", {}, String(date.getDate())), el("span", {}, label)),
      SLOTS.map(([slot, slotLabel]) => {
        const meal = day[slot];
        return el("div", { class: "mp-slot" },
          el("span", { class: "mp-slot-label" }, slotLabel),
          el("button", {
            type: "button",
            class: meal ? "mp-meal" : "mp-meal is-empty",
            "aria-label": meal ? `Edit ${slotLabel.toLowerCase()}, ${weekday(date, "long")} ${monthDay(date)}` : null,
            onclick: () => openEditor(key, slot),
          }, meal ? mealContent(meal) : `Add ${slotLabel.toLowerCase()}`),
          meal && mealLink(meal),
        );
      }),
    ));
  }
}

function drawArchive() {
  const box = $("mpArchiveList");
  box.replaceChildren();
  const q = $("mpSearch").value.trim().toLowerCase();
  const matches = (m) => m && [m.name, m.description, m.note].some((t) => (t || "").toLowerCase().includes(q));

  const keys = Object.keys(model.archive).sort().reverse()
    .filter((k) => !q || SLOTS.some(([s]) => matches(model.archive[k][s])));

  if (!keys.length) {
    box.append(el("p", { class: "mp-empty" },
      q ? "No past meals match that search." : "Past meals appear here the day after they happen."));
    return;
  }

  let lastWeek = null;
  for (const key of keys.slice(0, archiveLimit)) {
    const date = keyToDate(key);
    const week = `Week ${isoWeek(date)}, ${date.getFullYear()}`;
    if (week !== lastWeek) { box.append(el("h3", { class: "mp-week" }, week)); lastWeek = week; }
    const day = model.archive[key];
    box.append(el("div", { class: "mp-day" },
      el("div", { class: "mp-date" }, el("b", {}, String(date.getDate())), el("span", {}, `${weekday(date)} ${date.toLocaleDateString(undefined, { month: "short" })}`)),
      SLOTS.map(([slot, slotLabel]) => {
        const meal = day[slot];
        return el("div", { class: "mp-slot" },
          el("span", { class: "mp-slot-label" }, slotLabel),
          el("div", { class: meal ? "mp-meal" : "mp-meal is-empty" }, meal ? mealContent(meal) : "Nothing planned"),
          meal && mealLink(meal),
        );
      }),
    ));
  }
  if (keys.length > archiveLimit) {
    box.append(el("button", {
      type: "button", class: "mp-more",
      onclick: () => { archiveLimit += ARCHIVE_PAGE; drawArchive(); },
    }, "Show older meals"));
  }
}

// Past meal names become suggestions; picking one fills in its description and link.
let knownMeals = new Map();
function fillSuggestions() {
  knownMeals = new Map();
  const all = [...Object.entries(model.plan), ...Object.entries(model.archive)].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  for (const [, day] of all) for (const [slot] of SLOTS) {
    const m = day && day[slot];
    if (m && m.name && !knownMeals.has(m.name.toLowerCase())) knownMeals.set(m.name.toLowerCase(), m);
  }
  $("mpPastMeals").replaceChildren(...[...knownMeals.values()].slice(0, 300).map((m) => el("option", { value: m.name })));
}

// ---------- editor ----------
function openEditor(date, slot) {
  editing = { date, slot };
  const meal = (model.plan[date] || {})[slot];
  const f = $("mpForm");
  const d = keyToDate(date);
  const slotLabel = SLOTS.find(([s]) => s === slot)[1];
  $("mpDialogTitle").textContent = `${slotLabel}, ${weekday(d, "long")} ${monthDay(d)}`;
  f.name.value = meal?.name || "";
  f.description.value = meal?.description || "";
  f.link.value = meal?.link || "";
  f.note.value = meal?.note || "";
  $("mpDelete").hidden = !meal;
  $("mpDialog").showModal();
  if (!meal) f.name.focus();
}

$("mpForm").name.addEventListener("change", (e) => {
  const f = $("mpForm");
  const past = knownMeals.get(e.target.value.trim().toLowerCase());
  if (!past) return;
  if (!f.description.value.trim() && past.description) f.description.value = past.description;
  if (!f.link.value.trim() && past.link) f.link.value = past.link;
});

$("mpForm").addEventListener("submit", (e) => {
  if (e.submitter?.value !== "save" || !editing) return;
  const f = e.target;
  const { date, slot } = editing;
  const meal = {
    name: f.name.value.trim(),
    description: f.description.value.trim(),
    link: cleanLink(f.link.value),
    note: f.note.value.trim(),
  };
  if (!meal.name) { e.preventDefault(); f.name.focus(); return; }
  change((d) => { d.plan[date] = { ...(d.plan[date] || {}), [slot]: meal }; });
});

$("mpDelete").addEventListener("click", () => {
  if (!editing || !confirm("Remove this meal?")) return;
  const { date, slot } = editing;
  $("mpDialog").close();
  change((d) => {
    if (!d.plan[date]) return;
    delete d.plan[date][slot];
    if (!d.plan[date].lunch && !d.plan[date].dinner) delete d.plan[date];
  });
});

// ---------- tabs and search ----------
function showTab(which) {
  const plan = which === "plan";
  $("mpTabPlan").setAttribute("aria-selected", String(plan));
  $("mpTabArchive").setAttribute("aria-selected", String(!plan));
  $("mpPlan").hidden = !plan;
  $("mpArchive").hidden = plan;
}
$("mpTabPlan").addEventListener("click", () => showTab("plan"));
$("mpTabArchive").addEventListener("click", () => showTab("archive"));
$("mpSearch").addEventListener("input", () => { archiveLimit = ARCHIVE_PAGE; if (model) drawArchive(); });

// ---------- midnight rollover ----------
async function checkNewDay() {
  if (todayKey() === shownDay || !model) return;
  try { await refresh(); } catch { /* offline */ }
  renderApp(currentData ?? model);
}
function scheduleMidnight() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
  setTimeout(async () => { await checkNewDay(); scheduleMidnight(); }, next - now);
}
scheduleMidnight();
// Phones pause timers while asleep, so also check when the app comes back into view.
document.addEventListener("visibilitychange", () => { if (!document.hidden) checkNewDay(); });
window.addEventListener("focus", checkNewDay);
