#!/usr/bin/env node
/* ทดสอบสคริปต์วิดเจ็ต iPad (widget/scriptable.js) โดยจำลอง API ของแอป Scriptable
 *
 *   node tools/test-widget-scriptable.mjs
 *
 * รันสคริปต์จริงทุกขนาด (เล็ก/กลาง/ใหญ่) กับตารางตัวอย่าง แล้วตรวจข้อความที่วิดเจ็ตจะแสดง
 * รวมถึงตอนไม่มีเน็ต (ใช้ข้อมูลที่จำไว้) และตอนรหัสผิด
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = fs.readFileSync(path.join(ROOT, "widget/scriptable.js"), "utf8")
  .replace("__KRUTA_URL__", "https://kruta-push.test").replace("__KRUTA_KEY__", "wkey123");
const fail = [];
const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail.push(m); };

function makeEnv(fam, response, files) {
  const texts = [];
  class Stack {
    constructor() { this.items = []; }
    addStack() { const s = new Stack(); this.items.push(s); return s; }
    addText(t) { texts.push(String(t)); const o = { text: t }; this.items.push(o); return o; }
    addDate(d) { texts.push("[date:" + d.toISOString() + "]"); return { applyRelativeStyle() {}, applyTimerStyle() {} }; }
    addSpacer() {} layoutVertically() {} layoutHorizontally() {} centerAlignContent() {} topAlignContent() {} setPadding() {}
  }
  class ListWidget extends Stack { presentMedium() { return Promise.resolve(); } }
  const store = files;
  const g = {
    ListWidget, Size: class { constructor(w, h) { this.w = w; this.h = h; } },
    Color: Object.assign(class { constructor(h) { this.hex = h; } }, { dynamic: (a, b) => ({ a, b }) }),
    Font: { boldSystemFont: (n) => ({ n }), systemFont: (n) => ({ n }), boldMonospacedSystemFont: (n) => ({ n }) },
    Request: class { constructor(u) { this.url = u; } async loadJSON() { if (response instanceof Error) throw response; g.__url = this.url; return response; } },
    FileManager: { local: () => ({ documentsDirectory: () => "/docs", joinPath: (a, b) => a + "/" + b,
      writeString: (p, s) => { store[p] = s; }, readString: (p) => store[p], fileExists: (p) => p in store }) },
    config: { widgetFamily: fam, runsInWidget: true },
    args: { widgetParameter: (makeEnv.param || null) },
    Script: { setWidget: (w) => { g.__widget = w; }, complete: () => {} },
    __texts: texts
  };
  return g;
}
async function run(fam, response, files = {}) {
  const env = makeEnv(fam, response, files);
  const fn = new Function(...Object.keys(env).filter((k) => !k.startsWith("__")), "return (async () => {" + SRC + "\n})();");
  await fn(...Object.keys(env).filter((k) => !k.startsWith("__")).map((k) => env[k]));
  return { texts: env.__texts, widget: env.__widget, url: env.__url };
}

const now = new Date(), iso = (d) => d.toISOString().slice(0, 10);
const local = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const at = (mins) => { const d = new Date(now.getTime() + mins * 60000); return { d: local(d), t: String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") }; };
void iso;
const L = (mins, n, s, extra) => Object.assign({ ...at(mins), m: 60, n, k: "school", p: "PlaySound Chonburi", s }, extra || {});
const data = { ok: true, at: Date.now(), lessons: [
  L(-180, "ซีริว", "present"), L(-120, "โค้ช", "sick"), L(25, "harvey", "planned"), L(90, "นามิ", "planned"), L(150, "ธาวิน", "planned", { k: "private", p: "" })
] };
// กันวันข้าม: ถ้าทดสอบใกล้เที่ยงคืน บางคาบอาจตกวันอื่น ตรวจเฉพาะสิ่งที่ไม่ขึ้นกับวัน
const sameDay = (m) => at(m).d === local(now);

console.log("วิดเจ็ต iPad (Scriptable)");
const fams = ["small", "medium", "large", "extraLarge"];
const files = {};
for (const f of fams) {
  const r = await run(f, data, files);
  const all = r.texts.join(" | ");
  ok(r.widget && /ครูต้า/.test(all) && /harvey/.test(all) && /\[date:/.test(all), "ขนาด " + f + ": แสดงคาบถัดไป harvey พร้อมนับถอยหลัง");
  if (f !== "small" && sameDay(-180) && sameDay(150)) ok(/ซีริว/.test(all) && /✓ มาแล้ว/.test(all) && /ลาป่วย/.test(all) && /รอยืนยัน/.test(all), "ขนาด " + f + ": รายการวันนี้พร้อมสถานะ");
  if (f === "small") ok(!/ซีริว/.test(all), "ขนาดเล็ก: แสดงแค่คาบถัดไป ไม่รก");
}
const r0 = await run("small", data, files);
ok(/\/widget\?k=wkey123$/.test(r0.url), "ขอข้อมูลด้วยรหัสวิดเจ็ต (ไม่ใช่รหัสเข้าใช้)");
const off = await run("medium", new Error("offline"), files);
ok(/harvey/.test(off.texts.join(" ")), "ไม่มีเน็ต: ใช้ตารางล่าสุดที่จำไว้");
const bad = await run("small", { ok: false, error: "รหัสวิดเจ็ตไม่ถูกต้อง" }, {});
ok(/รหัสวิดเจ็ตไม่ถูกต้อง/.test(bad.texts.join(" ")), "รหัสผิด: บอกชัด ๆ บนวิดเจ็ต");
const oldW = await run("small", { ok: false, error: "not found" }, {});
ok(/โหลดตารางไม่ได้/.test(oldW.texts.join(" ")) && /รุ่นเก่า/.test(oldW.texts.join(" ")) && !/ไม่มีคาบ/.test(oldW.texts.join(" ")), "ตัวส่งรุ่นเก่า: บอกให้อัปเดต ไม่ขึ้นว่าไม่มีคาบ");
const noNet = await run("small", new Error("offline"), {});
ok(/โหลดตารางไม่ได้/.test(noNet.texts.join(" ")) && !/ไม่มีคาบ/.test(noNet.texts.join(" ")), "ไม่มีเน็ตและไม่เคยโหลดได้: บอกตรง ๆ ไม่ขึ้นว่าไม่มีคาบ");
for (const name of ["ชมพู", "ดำ", "ไม่มีธีมนี้"]) {
  makeEnv.param = name;
  const t = await run("medium", data, {});
  const bg = t.widget.backgroundColor;
  ok(name === "ไม่มีธีมนี้" ? !!(bg && bg.a) : (bg && bg.hex === (name === "ชมพู" ? "#FFF0F5" : "#000000")), "ธีม " + name + (name === "ไม่มีธีมนี้" ? ": ชื่อผิดใช้สีตามเครื่อง" : ": พื้นเปลี่ยนสี"));
}
makeEnv.param = null;
const empty = await run("medium", { ok: true, lessons: [] }, {});
ok(/วันนี้ไม่มีคาบ/.test(empty.texts.join(" ")), "ไม่มีคาบ: แสดงข้อความพัก ☕");
const doneOnly = await run("small", { ok: true, lessons: [L(-200, "ซีริว", "present")] }, {});
ok(!sameDay(-200) || /สอนครบแล้ว/.test(doneOnly.texts.join(" ")), "สอนครบแล้ว: แสดง 🎉");
console.log(fail.length ? "\n✗ ไม่ผ่าน " + fail.length + " ข้อ" : "\n✓ ผ่านทั้งหมด");
process.exit(fail.length ? 1 : 0);
