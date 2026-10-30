/* ============================================================
   Service Worker ของ "อัดโชว์" (/show/)
   ทำให้เปิดแอปได้ตอนไม่มีเน็ต (เช่นในร้านที่สัญญาณแย่) · แยกขาดจาก sw.js ของกลอง → MIDI และ /lesson/

     • ตัวโปรแกรม (index.html) — เอาของใหม่จากเน็ตก่อน ไม่มีเน็ตค่อยใช้สำเนา
     • ไอคอน / manifest / ฟอนต์ — เก็บสำเนาไว้ตั้งแต่ติดตั้ง ใช้สำเนาก่อน
     • ตัวอ่านนิ้ว (vendor/mediapipe ราว 17 MB) — เก็บสำเนาตอนใช้ครั้งแรก ไม่โหลดล่วงหน้าให้เปลืองเน็ต
       ชื่อโฟลเดอร์มีเลขรุ่นอยู่แล้ว จึงเก็บข้ามรุ่นแอปได้ ไม่มีวันค้างรุ่นเก่า

   ไม่ยุ่งกับการคุยกับ Google (Drive, ล็อกอิน) และไม่แตะคำขอที่ไม่ใช่ GET เลย
   วิดีโอที่อัดอยู่ใน IndexedDB ของหน้าแอป ไม่เคยผ่านตรงนี้
   ============================================================ */
"use strict";

const BUILD = "__BUILD_ID__";
const CACHE = "atshow-" + (BUILD.slice(0, 2) === "__" ? "dev" : BUILD);
const VENDOR = "atshow-vendor";
const ROOT  = new URL("./", self.location).pathname;   // เช่น /T/show/
const APP   = "./index.html";

const FONTS = ["thai", "latin", "latin-ext", "vietnamese"].flatMap((s) =>
  [400, 500, 600, 700].map((w) => "./fonts/chakra-petch-" + s + "-" + w + ".woff2"));
const PRECACHE = [
  APP,
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./fonts/chakra-petch.css"
].concat(FONTS);

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(PRECACHE.map((u) =>
      c.add(new Request(u, { cache: "reload" })).catch(() => {})
    ));
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    // เก็บตัวอ่านนิ้วไว้ข้ามรุ่น ลบเฉพาะสำเนาโปรแกรมรุ่นเก่า
    await Promise.all(
      keys.filter((k) => k.startsWith("atshow-") && k !== CACHE && k !== VENDOR)
          .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

/* หน้าเว็บส่ง "skipWaiting" มาเมื่อผู้ใช้กดปุ่ม "อัปเดต" (และไม่ได้อัดอยู่) */
self.addEventListener("message", (e) => {
  if (e.data === "skipWaiting") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== self.location.origin || !url.pathname.startsWith(ROOT)) return;

  if (req.mode === "navigate" || url.pathname === ROOT || url.pathname === ROOT + "index.html") {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          const c = await caches.open(CACHE);
          await c.put(APP, res.clone());
        }
        return res;
      } catch (_) {
        const c = await caches.open(CACHE);
        const hit = await c.match(APP);
        if (hit) return hit;
        return new Response(
          "ตอนนี้ออฟไลน์อยู่ และยังไม่มีสำเนาของแอปเก็บไว้ในเครื่อง\n" +
          "ต่อเน็ตแล้วเปิดหน้านี้อีกครั้งหนึ่ง จากนั้นจะใช้ได้แม้ไม่มีเน็ต",
          { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }
        );
      }
    })());
    return;
  }

  // sw.js เองต้องสดเสมอ
  if (url.pathname === ROOT + "sw.js") return;

  const vendor = url.pathname.startsWith(ROOT + "vendor/");
  e.respondWith((async () => {
    const c = await caches.open(vendor ? VENDOR : CACHE);
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(req);
    if (res && res.ok && res.type === "basic") c.put(req, res.clone());
    return res;
  })());
});
