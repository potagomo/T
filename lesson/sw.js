/* ============================================================
   Service Worker ของ ครูต้า — Drum Lesson Log
   ทำให้เปิดใช้ได้ตอนไม่มีเน็ต และติดตั้งลงหน้าโฮมได้

   หลักการ
     • ตัวโปรแกรม (index.html) — เอาของใหม่จากเน็ตก่อน ไม่มีเน็ตค่อยใช้สำเนา
       จึงไม่มีทางค้างอยู่กับรุ่นเก่า และไม่มีทางเปิดไม่ขึ้นตอนออฟไลน์
       ถ้าเน็ตช้า/ค้าง (สัญญาณอ่อนในห้องเรียน) รอไม่เกิน 4 วินาทีแล้วใช้สำเนาทันที
     • ไอคอน/manifest — ใช้สำเนาก่อน เพราะแทบไม่เปลี่ยน

   ข้อมูลการสอนไม่เคยผ่านตรงนี้ โปรแกรมเก็บใน localStorage + IndexedDB
   ของเครื่องเอง ไม่มีอะไรถูกส่งออกนอกเครื่อง
   ============================================================ */
"use strict";

/* ตอน deploy ด้วย GitHub Actions ค่านี้จะถูกแทนด้วยเลข commit */
const BUILD = "__BUILD_ID__";
const PREFIX = "krutah-";
const CACHE = PREFIX + (BUILD.slice(0, 2) === "__" ? "dev" : BUILD);

/* โฟลเดอร์ที่แอปวางอยู่ เช่น /T/lesson/ */
const ROOT = new URL("./", self.location).pathname;
const APP  = "./index.html";
const NET_TIMEOUT_MS = 4000;

const PRECACHE = [
  APP,
  "./manifest.webmanifest",
  "./icons/favicon-32.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // ทีละไฟล์ ไม่ใช้ addAll เพราะไฟล์เดียวพลาด addAll จะล้มทั้งชุด
    await Promise.all(PRECACHE.map((u) =>
      c.add(new Request(u, { cache: "reload" })).catch(() => {})
    ));
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    // ลบเฉพาะของแอปนี้รุ่นเก่า — อย่าไปแตะแคชของแอปอื่นในโดเมนเดียวกัน
    await Promise.all(
      keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE)
          .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

/* หน้าเว็บส่งมาเมื่อผู้ใช้กด "อัปเดตเดี๋ยวนี้" */
self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

/* เฉพาะตัวโปรแกรมเองเท่านั้น — หน้าอื่นในโฟลเดอร์ (เช่น src/original.html)
   ห้ามถูกเก็บทับเป็นตัวโปรแกรม */
function isAppDoc(url) {
  return url.pathname === ROOT || url.pathname === ROOT + "index.html";
}

function withTimeout(p, ms) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("timeout")), ms);
    p.then((v) => { clearTimeout(t); res(v); }, (err) => { clearTimeout(t); rej(err); });
  });
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(ROOT)) return;

  if (isAppDoc(url)) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const net = fetch(req, { cache: "no-store" }).then(async (res) => {
        if (res && res.ok) await c.put(APP, res.clone());
        return res;
      });
      try {
        // มีสำเนาแล้ว → รอเน็ตแค่พักเดียว ไม่มีสำเนา → รอเน็ตจนกว่าจะได้
        const hit = await c.match(APP);
        if (!hit) return await net;
        try { return await withTimeout(net, NET_TIMEOUT_MS); }
        catch (_) {
          e.waitUntil(net.catch(() => {}));   // ปล่อยให้โหลดต่อเบื้องหลัง ครั้งหน้าได้รุ่นใหม่
          return hit;
        }
      } catch (_) {
        const hit = await c.match(APP);
        if (hit) return hit;
        return new Response(
          "ตอนนี้ออฟไลน์อยู่ และยังไม่มีสำเนาของแอปเก็บไว้ในเครื่อง\n" +
          "ต่อเน็ตแล้วเปิดหน้านี้อีกครั้งหนึ่ง จากนั้นจะใช้ได้แม้ไม่มีเน็ต\n\n" +
          "(ข้อมูลที่บันทึกไว้ยังอยู่ในเครื่องครบ ไม่ได้หายไปไหน)",
          { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }
        );
      }
    })());
    return;
  }

  if (req.mode === "navigate") return;   // หน้าอื่น ๆ ปล่อยให้เบราว์เซอร์จัดการเอง

  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(req);
    if (res && res.ok && res.type === "basic") c.put(req, res.clone());
    return res;
  })());
});
