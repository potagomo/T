// ครูต้า · วิดเจ็ตหน้าจอโฮม (iPad / iPhone) — ใช้กับแอปฟรี Scriptable
// แอปครูต้าใส่ที่อยู่ตัวส่งและรหัสวิดเจ็ตให้แล้ว แค่วางทั้งไฟล์ใน Scriptable
// ขนาดเล็ก = คาบถัดไป · กลาง = คาบถัดไป + วันนี้ · ใหญ่ = คาบถัดไป + วันนี้ทั้งหมด + พรุ่งนี้
const SERVER = "__KRUTA_URL__";
const KEY = "__KRUTA_KEY__";
const APP = "https://potagomo.github.io/T/lesson/";

// 🎨 สี: กดค้างวิดเจ็ต › แก้ไขวิดเจ็ต › Parameter พิมพ์ชื่อธีม
//    ครีม · กลางคืน · ชมพู · ฟ้า · มิ้นต์ · ม่วง · ดำ   (เว้นว่าง = ตามโหมดกลางวัน/กลางคืนของเครื่อง)
const THEMES = {
  "ครีม":    { bg: "#FFFDF5", ink: "#111111", muted: "#5A5A5A", acc: "#FFD93D", on: "#111111" },
  "กลางคืน": { bg: "#16140F", ink: "#F0E9DA", muted: "#B5AC9A", acc: "#FFD93D", on: "#111111", dark: true },
  "ชมพู":    { bg: "#FFF0F5", ink: "#2A1520", muted: "#7A5866", acc: "#FF8FB1", on: "#2A1520" },
  "ฟ้า":     { bg: "#EEF6FF", ink: "#0E1E33", muted: "#4A6380", acc: "#7CC4FF", on: "#0E1E33" },
  "มิ้นต์":   { bg: "#EFFBF4", ink: "#0F2A1C", muted: "#4C6E5B", acc: "#6EE7A8", on: "#0F2A1C" },
  "ม่วง":    { bg: "#F5F0FF", ink: "#1E1433", muted: "#685A80", acc: "#C4B5FD", on: "#1E1433" },
  "ดำ":      { bg: "#000000", ink: "#FFFFFF", muted: "#AAAAAA", acc: "#FF6B6B", on: "#000000", dark: true }
};
const PARAM = (typeof args !== "undefined" && args.widgetParameter ? String(args.widgetParameter) : "").trim();
const T = THEMES[PARAM] || null;
const dyn = (light, dark) => Color.dynamic(new Color(light), new Color(dark));
const fix = (h) => new Color(h);
const C = T ? {
  paper: fix(T.bg), ink: fix(T.ink), muted: fix(T.muted), line: fix(T.ink),
  yel: fix(T.acc), onYel: fix(T.on), red: fix("#FF6B6B"),
  ok: fix(T.dark ? "#5EE08F" : "#15803D"), wait: fix(T.dark ? "#F5C842" : "#8A5A00"), off: fix(T.dark ? "#8F8776" : "#8A8A8A")
} : {
  paper: dyn("#FFFDF5", "#16140F"),
  ink: dyn("#111111", "#F0E9DA"),
  muted: dyn("#5A5A5A", "#B5AC9A"),
  line: dyn("#111111", "#D8CFBC"),
  yel: new Color("#FFD93D"), onYel: new Color("#111111"),
  red: new Color("#FF6B6B"),
  ok: dyn("#15803D", "#5EE08F"),
  wait: dyn("#8A5A00", "#F5C842"),
  off: dyn("#8A8A8A", "#8F8776")
};
const ST = { present: ["✓ มาแล้ว", C.ok], planned: ["รอยืนยัน", C.wait], sick: ["ลาป่วย", C.off], lateCancel: ["ลาด่วน", C.off] };
const DOW = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];

const fm = FileManager.local();
const cachePath = fm.joinPath(fm.documentsDirectory(), "kruta-widget.json");

async function load() {
  try {
    const r = new Request(SERVER + "/widget?k=" + encodeURIComponent(KEY));
    r.timeoutInterval = 10;
    const j = await r.loadJSON();
    if (j && j.ok) { fm.writeString(cachePath, JSON.stringify(j)); return j; }
    if (j && j.error) return { error: friendly(j.error) };
  } catch (e) {}
  try { if (fm.fileExists(cachePath)) return JSON.parse(fm.readString(cachePath)); } catch (e) {}
  return null;
}
// ข้อความจากตัวส่งที่คนอ่านแล้วรู้ว่าต้องทำอะไร
function friendly(e) {
  if (e === "not found") return "ตัวส่งยังเป็นรุ่นเก่า — อัปเดตโค้ดตัวส่งเป็นรุ่น 3 (แอปครูต้า › 🧩)";
  if (/รหัสวิดเจ็ต/.test(e)) return "รหัสวิดเจ็ตไม่ถูกต้อง — คัดลอกสคริปต์ใหม่จากแอปครูต้า › 🧩";
  return e;
}
function iso(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function parse(l) {
  const [y, mo, d] = l.d.split("-").map(Number), [h, mi] = (l.t || "00:00").split(":").map(Number);
  const start = new Date(y, mo - 1, d, h, mi);
  return Object.assign({}, l, { start, end: new Date(start.getTime() + (l.m || 60) * 60000) });
}
function pick(data) {
  const now = new Date(), today = iso(now);
  const all = (data && data.lessons || []).filter((l) => l.d && l.t).map(parse).sort((a, b) => a.start - b.start);
  const live = all.filter((l) => l.s !== "sick" && l.s !== "lateCancel");
  const next = live.find((l) => l.end > now) || null;
  const todays = all.filter((l) => l.d === today);
  const tmr = iso(new Date(now.getTime() + 86400000));
  return { now, next, todays, tomorrow: all.filter((l) => l.d === tmr), done: todays.filter((l) => l.s === "present").length };
}

function text(stack, s, size, color, bold, lines) {
  const t = stack.addText(s);
  t.font = bold ? Font.boldSystemFont(size) : Font.systemFont(size);
  t.textColor = color; t.lineLimit = lines || 1; t.minimumScaleFactor = 0.7;
  return t;
}
function chip(stack) {
  const c = stack.addStack();
  c.backgroundColor = C.yel; c.borderColor = C.onYel; c.borderWidth = 2; c.cornerRadius = 4;
  c.setPadding(2, 6, 2, 6);
  text(c, "🥁 ครูต้า", 11, C.onYel, true);
}
function nextBlock(stack, p, big) {
  const b = stack.addStack(); b.layoutVertically();
  b.backgroundColor = C.yel; b.borderColor = C.onYel; b.borderWidth = 2.5; b.cornerRadius = 6;
  b.setPadding(8, 10, 8, 10);
  const n = p.next;
  if (!n) {
    text(b, p.todays.length ? "สอนครบแล้ววันนี้ 🎉" : "วันนี้ไม่มีคาบ ☕", big ? 15 : 13, C.onYel, true, 2);
    text(b, "พักผ่อนให้เต็มที่", 11, C.onYel, false);
    return;
  }
  const isToday = n.d === iso(p.now), running = n.start <= p.now;
  text(b, running ? "กำลังสอน" : isToday ? "คาบถัดไป" : (n.d === iso(new Date(p.now.getTime() + 86400000)) ? "พรุ่งนี้" : DOW[n.start.getDay()] + " " + n.start.getDate()), 11, C.onYel, true);
  const row = b.addStack(); row.centerAlignContent();
  text(row, n.t, big ? 30 : 26, C.onYel, true);
  row.addSpacer(6);
  const rel = row.addDate(running ? n.end : n.start);
  rel.applyRelativeStyle(); rel.font = Font.boldSystemFont(11); rel.textColor = C.onYel; rel.lineLimit = 1;
  text(b, n.n, big ? 17 : 15, C.onYel, true);
  if (n.p) text(b, n.p, 10, C.onYel, false);
}
function listRows(stack, items, max, p) {
  items.slice(0, max).forEach((l) => {
    const r = stack.addStack(); r.centerAlignContent(); r.setPadding(2, 0, 2, 0);
    const past = l.end <= p.now && l.s !== "planned";
    const tt = text(r, l.t, 12, past ? C.muted : C.ink, true); tt.font = Font.boldMonospacedSystemFont(12);
    r.addSpacer(6);
    text(r, l.n, 13, past ? C.muted : C.ink, l === p.next);
    r.addSpacer();
    const st = ST[l.s] || ST.planned;
    text(r, st[0], 10, st[1], true);
  });
  if (items.length > max) text(stack, "+" + (items.length - max) + " คาบ", 10, C.muted, false);
}

async function build() {
  const fam = config.widgetFamily || "medium";
  const w = new ListWidget();
  w.backgroundColor = C.paper; w.url = APP; w.setPadding(12, 12, 12, 12);
  const data = await load();
  if (!data || data.error) {
    chip(w); w.addSpacer(8);
    text(w, "⚠ โหลดตารางไม่ได้", 13, C.ink, true, 1);
    text(w, data && data.error ? data.error : "ติดต่อตัวส่งไม่ได้ (ไม่มีเน็ต?)", 11, C.muted, false, 4);
    w.refreshAfterDate = new Date(Date.now() + 15 * 60000);
    return w;
  }
  const p = pick(data);
  const head = w.addStack(); head.centerAlignContent();
  chip(head); head.addSpacer();
  if (fam !== "small") text(head, "วันนี้ " + p.done + "/" + p.todays.length + " ยืนยันแล้ว", 11, C.muted, true);
  w.addSpacer(8);

  if (fam === "small") {
    nextBlock(w, p, false);
  } else if (fam === "medium") {
    const row = w.addStack(); row.topAlignContent();
    const left = row.addStack(); left.size = new Size(150, 0); nextBlock(left, p, false);
    row.addSpacer(10);
    const right = row.addStack(); right.layoutVertically();
    if (p.todays.length) listRows(right, p.todays, 4, p); else text(right, "วันนี้ว่าง", 12, C.muted, false);
  } else {
    nextBlock(w, p, true);
    w.addSpacer(10);
    text(w, "วันนี้", 12, C.muted, true);
    const list = w.addStack(); list.layoutVertically();
    if (p.todays.length) listRows(list, p.todays, fam === "extraLarge" ? 10 : 7, p); else text(list, "ไม่มีคาบ", 12, C.muted, false);
    if (p.tomorrow.length) {
      w.addSpacer(8);
      text(w, "พรุ่งนี้ " + p.tomorrow.length + " คาบ · เริ่ม " + p.tomorrow[0].t + " " + p.tomorrow[0].n, 11, C.muted, true);
    }
  }
  w.addSpacer();
  // ระบบเป็นคนตัดสินจังหวะรีเฟรชจริง ขอไว้ที่ขอบคาบถัดไปหรือทุก 15 นาที
  const soon = p.next ? (p.next.start > p.now ? p.next.start : p.next.end) : null;
  w.refreshAfterDate = new Date(Math.min(soon ? soon.getTime() + 30000 : Infinity, Date.now() + 15 * 60000));
  return w;
}

const widget = await build();
if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentMedium();
Script.complete();
