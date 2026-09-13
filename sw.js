/* ============================================================
   Service Worker — ทำให้เว็บแอปนี้เปิดใช้ได้ตอนไม่มีเน็ต

   หลักการที่ใช้ มีสองแบบตามชนิดไฟล์
     • ตัวโปรแกรม (index.html) — เอาของใหม่จากเน็ตก่อนเสมอ
       ไม่มีเน็ตค่อยใช้สำเนา วิธีนี้ทำให้ไม่มีทางค้างอยู่กับรุ่นเก่า
     • ฟอนต์กับไอคอน — ใช้สำเนาก่อน เพราะไม่เคยเปลี่ยน และทำให้เปิดไว

   ไม่มีการส่งอะไรออกนอกเครื่อง ไฟล์เสียงกับงานที่บันทึกไม่เคยผ่านตรงนี้
   เพราะโปรแกรมอ่านไฟล์ด้วย File API และเก็บงานไว้ใน localStorage
   ============================================================ */
"use strict";

/* ตอน deploy ด้วย GitHub Actions ค่านี้จะถูกแทนด้วยเลข commit
   ถ้า deploy แบบ "จากแบรนช์" ค่าจะคาไว้แบบนี้ ก็ยังทำงานถูก
   เพราะตัวโปรแกรมใช้วิธีเอาของใหม่จากเน็ตก่อนอยู่แล้ว */
const BUILD = "__BUILD_ID__";
const CACHE = "klong-" + (BUILD.slice(0, 2) === "__" ? "dev" : BUILD);

/* ที่อยู่ของโฟลเดอร์ที่เว็บแอปวางอยู่ เช่น /T/ */
const ROOT = new URL("./", self.location).pathname;
const APP  = "./index.html";

const PRECACHE = [
  APP,
  "./manifest.webmanifest",
  "./icons/favicon-32.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./fonts/ibm-plex-sans-thai.css",
  "./fonts/ibm-plex-sans-thai-thai-300.woff2",
  "./fonts/ibm-plex-sans-thai-thai-400.woff2",
  "./fonts/ibm-plex-sans-thai-thai-500.woff2",
  "./fonts/ibm-plex-sans-thai-thai-600.woff2",
  "./fonts/ibm-plex-sans-thai-latin-300.woff2",
  "./fonts/ibm-plex-sans-thai-latin-400.woff2",
  "./fonts/ibm-plex-sans-thai-latin-500.woff2",
  "./fonts/ibm-plex-sans-thai-latin-600.woff2",
  "./fonts/ibm-plex-sans-thai-latin-ext-300.woff2",
  "./fonts/ibm-plex-sans-thai-latin-ext-400.woff2",
  "./fonts/ibm-plex-sans-thai-latin-ext-500.woff2",
  "./fonts/ibm-plex-sans-thai-latin-ext-600.woff2"
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // เก็บทีละไฟล์ ไม่ใช้ addAll เพราะถ้าไฟล์เดียวพลาด addAll จะล้มทั้งชุด
    await Promise.all(PRECACHE.map((u) =>
      c.add(new Request(u, { cache: "reload" })).catch(() => {})
    ));
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith("klong-") && k !== CACHE)
          .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

/* หน้าเว็บจะส่งข้อความนี้มาเมื่อผู้ใช้กดปุ่ม "อัปเดตเดี๋ยวนี้" */
self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

/* คำขอนี้คือตัวโปรแกรมเองหรือเปล่า
   เผื่อกรณีที่โปรแกรมอ่านไฟล์ตัวเองด้วย fetch() ตอนสร้างไฟล์ล็อก
   ซึ่งไม่ใช่ navigation จึงเช็คที่ path ด้วย ไม่ได้ดูแค่ mode */
function isAppDoc(req, url) {
  return req.mode === "navigate"
      || req.destination === "document"
      || url.pathname === ROOT
      || url.pathname === ROOT + "index.html";
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return;
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  if (isAppDoc(req, url)) {
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
          "ตอนนี้ออฟไลน์อยู่ และยังไม่มีสำเนาของโปรแกรมเก็บไว้ในเครื่อง\n" +
          "ต่อเน็ตแล้วเปิดหน้านี้อีกครั้งหนึ่ง จากนั้นจะใช้ได้แม้ไม่มีเน็ต",
          { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }
        );
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(req);
    if (res && res.ok && res.type === "basic") c.put(req, res.clone());
    return res;
  })());
});
