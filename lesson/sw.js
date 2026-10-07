/* ============================================================
   Service Worker ของ "ครูต้า — บันทึกการสอน" (/lesson/)
   ทำให้เปิดใช้ได้ตอนไม่มีเน็ต · แยกขาดจาก sw.js ของกลอง → MIDI

     • ตัวโปรแกรม (index.html) — เอาของใหม่จากเน็ตก่อน ไม่มีเน็ตค่อยใช้สำเนา
     • ไอคอน/manifest — ใช้สำเนาก่อน
     • ฟอนต์ Google กับชุดโค้ด Firebase (gstatic) — ใช้สำเนาก่อน
       เพื่อให้เปิดแอปตอนออฟไลน์แล้วยังหน้าตาครบและซิงค์ต่อได้เมื่อเน็ตกลับมา

   ไม่ยุ่งกับการคุยกับ Firestore เลย (firestore.googleapis.com ฯลฯ)
   ข้อมูลบันทึกการสอนไม่เคยผ่านตรงนี้
   ============================================================ */
"use strict";

const BUILD = "__BUILD_ID__";
const CACHE = "kruta-" + (BUILD.slice(0, 2) === "__" ? "dev" : BUILD);
const ROOT  = new URL("./", self.location).pathname;   // เช่น /T/lesson/
const APP   = "./index.html";

const PRECACHE = [
  APP,
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png"
];

/* ของจากข้างนอกที่เก็บสำเนาได้ — เปลี่ยนตามรุ่นใน URL จึงไม่มีวันค้างรุ่นเก่า */
const CDN = ["fonts.googleapis.com", "fonts.gstatic.com", "www.gstatic.com"];

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
    // เก็บสำเนา CDN ไว้ข้ามรุ่น ลบเฉพาะสำเนาโปรแกรมรุ่นเก่า
    await Promise.all(
      keys.filter((k) => k.startsWith("kruta-") && k !== CACHE && k !== "kruta-cdn")
          .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

/* หน้าเว็บส่ง "skipWaiting" มาเมื่อผู้ใช้กดปุ่ม "อัปเดต" */
self.addEventListener("message", (e) => {
  const d = e.data;
  if (d === "skipWaiting" || (d && d.type === "SKIP_WAITING")) self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }

  if (url.origin !== self.location.origin) {
    if (url.protocol !== "https:" || CDN.indexOf(url.hostname) < 0) return;
    if (url.hostname === "www.gstatic.com" && !url.pathname.startsWith("/firebasejs/")) return;
    e.respondWith((async () => {
      const c = await caches.open("kruta-cdn");
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res && (res.ok || res.type === "opaque")) c.put(req, res.clone());
      return res;
    })());
    return;
  }

  if (!url.pathname.startsWith(ROOT)) return;

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
          "ตอนนี้ออฟไลน์อยู่ และยังไม่มีสำเนาของโปรแกรมเก็บไว้ในเครื่อง\n" +
          "ต่อเน็ตแล้วเปิดหน้านี้อีกครั้งหนึ่ง จากนั้นจะใช้ได้แม้ไม่มีเน็ต",
          { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }
        );
      }
    })());
    return;
  }

  // sw.js เองต้องสดเสมอ ไม่งั้นหน้า "ตรวจเว็บไซต์" จะเห็นของเก่า
  if (url.pathname === ROOT + "sw.js") return;

  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(req);
    if (res && res.ok && res.type === "basic") c.put(req, res.clone());
    return res;
  })());
});

/* ── แจ้งเตือนคาบถัดไป (ข้อความมาจากตัวส่งบน Cloudflare — push-worker/worker.js) ── */
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "ครูต้า", {
    body: d.body || "",
    tag: d.tag || "kruta",
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-192.png",
    data: { url: "./" }
  }));
});

/* แตะแจ้งเตือน → เปิดแอป (ถ้าเปิดค้างอยู่แล้วก็สลับไปหน้านั้น) */
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of list) if (c.url.startsWith(self.registration.scope) && "focus" in c) return c.focus();
    return self.clients.openWindow(self.registration.scope);
  })());
});
