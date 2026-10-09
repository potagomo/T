/* ชั้นเว็บแอป: แจ้งเตือนก่อนถึงคาบ — tools/update-lesson.py ฝังไฟล์นี้ไว้ท้าย lesson/index.html

   เว็บแอปตั้งเวลาแจ้งเตือนตอนปิดแอปอยู่เองไม่ได้ จึงใช้ตัวส่ง (push-worker/worker.js)
   ที่ครูวางไว้ใน Cloudflare ของตัวเอง:
     • แอปคำนวณ "รายการเตือน" 3 สัปดาห์ข้างหน้า (คาบที่วางแผนไว้ + ตารางประจำ ลบด้วยเวลาเตือนล่วงหน้า)
       แล้วส่งไปเก็บที่ตัวส่งทุกครั้งที่ข้อมูลเปลี่ยน
     • ตัวส่งตื่นทุกนาที ถึงเวลาก็ยิง Web Push ไปทุกเครื่องที่เปิดแจ้งเตือนไว้
     • ที่อยู่ตัวส่ง รหัสเข้าใช้ และเวลาเตือนล่วงหน้า เก็บใน S.settings จึงซิงค์ไปอีกเครื่องเอง
       แต่ละเครื่องแค่กด "เปิดแจ้งเตือนบนเครื่องนี้" ครั้งเดียว (ระบบบังคับให้ขออนุญาตทีละเครื่อง) */
(function () {
  "use strict";
  var NEED = ["save", "openMenu", "startApp", "showModal", "closeModal", "toast", "esc", "jsArg", "seg", "todayStr", "addDays",
              "rosterForDate", "rosterSkipped", "isClosedDate", "rosterEntryExists", "displayName", "getPlace", "copyText", "isStandalone", "isIOS"];
  for (var i = 0; i < NEED.length; i++) if (typeof window[NEED[i]] !== "function") {
    window.__push = "missing:" + NEED[i];
    return;
  }

  var DAYS = 21, LEADS = [10, 15, 30, 45, 60, 90, 120];
  var WORKER_CODE = null;          // โหลดไว้ก่อน เพื่อให้ปุ่มคัดลอกทำงานบน iPad (ต้องคัดลอกทันทีที่แตะ)

  function cfg() { var p = S.settings && S.settings.push; return p && p.url && p.token ? p : null; }
  function lead() { var n = parseInt(S.settings.pushLead, 10); return LEADS.indexOf(n) >= 0 ? n : 30; }
  function lsj(k, v) {
    try {
      if (v === undefined) return JSON.parse(localStorage.getItem(k) || "null");
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v));
    } catch (e) { return null; }
  }
  function dev() { return lsj("td_push_dev"); }
  function deviceId() {
    var d = lsj("td_push_id");
    if (!d) { d = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); lsj("td_push_id", d); }
    return d;
  }
  function supported() { return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window; }
  var WORKER_VERSION = 2;          // ตรงกับ VERSION ใน push-worker/worker.js
  function api(path, body, keepalive) {
    var c = cfg(); if (!c) return Promise.reject(new Error("ยังไม่ได้ตั้งค่าตัวส่ง"));
    body = body || {}; body.token = c.token;
    // ส่งเป็น text/plain เพื่อไม่ต้องมีคำขอ preflight · keepalive = ส่งต่อให้จบแม้ปิดแอปไปแล้ว
    var init = { method: "POST", body: JSON.stringify(body) };
    if (keepalive && init.body.length < 60000) init.keepalive = true;
    return fetch(c.url + path, init).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: "ตัวส่งตอบกลับไม่ถูกต้อง (" + r.status + ")" }; });
    }).then(function (j) { if (!j.ok) throw new Error(j.error || "ตัวส่งปฏิเสธ"); return j; });
  }
  function b64uToBytes(s) {
    s = String(s).replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "=";
    var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u;
  }
  function randToken() {
    var u = crypto.getRandomValues(new Uint8Array(32)), s = "";
    for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function hhmm(t) { var m = String(t || "").match(/^(\d{1,2})[:.](\d{2})/); return m ? ("0" + parseInt(m[1], 10)).slice(-2) + ":" + m[2] : ""; }
  function leadText(n) { return n >= 60 && n % 60 === 0 ? "อีก " + (n / 60) + " ชั่วโมง" : "อีก " + n + " นาที"; }

  /* ── รายการเตือน: คาบที่วางแผนไว้ + ตารางประจำที่ยังไม่ได้ลงเป็นคาบ ── */
  function upcoming() {
    var slots = {}, t = todayStr();
    function add(d, time, student, kind, placeId) {
      time = hhmm(time); if (!time || !student) return;
      var k = d + " " + time, s = slots[k] = slots[k] || { date: d, time: time, people: [] };
      if (!s.people.some(function (p) { return p.student === student; })) s.people.push({ student: student, kind: kind, placeId: placeId });
    }
    for (var i = 0; i < DAYS; i++) {
      var d = addDays(t, i);
      S.lessons.forEach(function (l) { if (l.date === d && l.attendance === "planned") add(d, l.time, l.student, l.kind, l.placeId); });
      rosterForDate(d).forEach(function (e) {
        if (e.paused || (e.from && d < e.from) || rosterSkipped(e.id, d) || isClosedDate(d, e.kind) || rosterEntryExists(e, d)) return;
        add(d, e.time, e.student, e.kind, e.placeId);
      });
    }
    return Object.keys(slots).sort().map(function (k) { return slots[k]; });
  }
  function reminders() {
    var n = lead(), now = Date.now();
    return upcoming().map(function (s) {
      var start = new Date(s.date + "T" + s.time + ":00").getTime();
      var names = s.people.map(function (p) { return displayName(p.student); });
      var p0 = s.people[0], place = p0.placeId != null && getPlace(p0.placeId);
      var kind = (KIND[p0.kind] || KIND.school).label;
      return {
        id: s.date + "T" + s.time,
        at: start - n * 60000,
        start: start,
        title: "🥁 " + leadText(n) + " · " + s.time + " " + names.join(", "),
        body: kind + (place && place.name ? " · " + place.name : "") + (names.length > 1 ? " · " + names.length + " คน" : "")
      };
    }).filter(function (r) { return r.at > now - 30000; });
  }

  /* ── ส่งรายการขึ้นตัวส่ง (เฉพาะเมื่อเปลี่ยน หรือทุก 6 ชั่วโมงเพื่อเลื่อนหน้าต่างเวลา) ── */
  var syncT = null, syncing = false, again = false;
  function pushSyncSoon(ms) { clearTimeout(syncT); syncT = setTimeout(function () { pushSync(false); }, ms == null ? 4000 : ms); }
  function pushSync(force, keepalive) {
    // กำลังส่งอยู่: จำไว้ แล้วส่งรายการล่าสุดซ้ำเมื่อรอบนี้จบ (ไม่ทิ้ง ไม่งั้นตัวส่งค้างรายการเก่า)
    if (syncing && !keepalive) { again = true; return Promise.resolve(false); }
    if (!cfg() || !navigator.onLine) return Promise.resolve(false);
    var list = reminders().map(function (r) { return { id: r.id, at: r.at, title: r.title, body: r.body }; });
    var h = JSON.stringify(list), last = lsj("td_push_last") || {};
    if (!force && last.h === h && Date.now() - (last.at || 0) < 6 * 3600 * 1000) return Promise.resolve(false);
    syncing = true; clearTimeout(syncT); syncT = null;
    var done = function (ok) { syncing = false; if (again) { again = false; pushSyncSoon(300); } return ok; };
    return api("/schedule", { reminders: list }, keepalive).then(function () {
      lsj("td_push_last", { h: h, at: Date.now() }); return done(true);
    }, function (e) { window.__pushErr = e.message; return done(false); });
  }

  /* ── ลงทะเบียนเครื่องนี้ ── */
  function subscribe() {
    var c = cfg();
    return navigator.serviceWorker.ready.then(function (reg) {
      return reg.pushManager.getSubscription().then(function (old) {
        var d = dev();
        if (old && d && d.key === c.key) return old;
        return (old ? old.unsubscribe() : Promise.resolve()).then(function () {
          return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(c.key) });
        });
      });
    }).then(function (sub) {
      var j = sub.toJSON ? sub.toJSON() : sub;
      return api("/subscribe", { sub: { endpoint: j.endpoint, keys: j.keys }, device: deviceId() }).then(function () {
        lsj("td_push_dev", { endpoint: j.endpoint, key: c.key, at: Date.now() });
        return pushSync(true);
      });
    });
  }
  window.pushEnableHere = function () {
    if (!supported()) { toast(isIOS() && !isStandalone() ? "เปิดแอปจากไอคอนบนหน้าโฮมก่อน" : "เครื่องนี้ไม่รองรับการแจ้งเตือน"); return; }
    var btn = document.getElementById("pu-enable"); if (btn) { btn.disabled = true; btn.textContent = "กำลังเปิด…"; }
    // iPad/iPhone ต้องขออนุญาตทันทีที่แตะ ห้ามมีงานอื่นคั่นก่อน
    Notification.requestPermission().then(function (perm) {
      if (perm !== "granted") throw new Error(perm === "denied" ? "ไม่ได้รับอนุญาต — เปิดได้ที่ การตั้งค่าเครื่อง › การแจ้งเตือน › ครูต้า" : "ยังไม่ได้อนุญาต");
      return subscribe();
    }).then(function () { toast("เปิดแจ้งเตือนบนเครื่องนี้แล้ว"); openPush(); },
      function (e) { toast(e.message || "เปิดไม่สำเร็จ"); openPush(); });
  };
  window.pushDisableHere = function () {
    var d = dev();
    navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); })
      .then(function (s) { return s && s.unsubscribe(); })
      .catch(function () {})
      .then(function () { return api("/unsubscribe", { endpoint: d && d.endpoint, device: deviceId() }).catch(function () {}); })
      .then(function () { lsj("td_push_dev", null); toast("ปิดแจ้งเตือนบนเครื่องนี้แล้ว"); openPush(); });
  };
  window.pushTest = function () {
    api("/test").then(function (j) {
      toast(j.sent ? "ส่งทดสอบแล้ว " + j.sent + " เครื่อง" : "ยังไม่มีเครื่องไหนเปิดแจ้งเตือน");
    }, function (e) { toast(e.message); });
  };
  window.pushSetLead = function (v) {
    S.settings.pushLead = parseInt(v, 10); save({ noSnap: true, noCount: true });
    pushSync(true).then(function (ok) { if (ok) toast("เตือนก่อน " + leadText(lead()).replace("อีก ", "")); }); openPush();
  };
  window.pushConnect = function () {
    var inp = document.getElementById("pu-url"), box = document.getElementById("pu-err");
    var err = box && { set textContent(t) { box.textContent = t; box.style.display = t ? "block" : "none"; } };
    var url = String(inp && inp.value || "").trim().replace(/\/+$/, "");
    // https เท่านั้น (ยกเว้น localhost ไว้ให้ชุดทดสอบ)
    if (!/^https:\/\/[^\s/]+/.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(url)) { if (err) err.textContent = "ใส่ที่อยู่ที่ขึ้นต้นด้วย https:// เช่น https://kruta-push.ชื่อคุณ.workers.dev"; return; }
    if (err) err.textContent = "กำลังเชื่อมต่อ…";
    fetch(url + "/").then(function (r) { return r.json(); }).then(function (j) {
      if (!j || j.app !== "kruta-push") throw new Error(j && j.error ? j.error : "ที่อยู่นี้ไม่ใช่ตัวส่งของครูต้า");
      var old = S.settings.push && S.settings.push.token;
      var token = old || randToken();
      return fetch(url + "/claim", { method: "POST", body: JSON.stringify({ token: token }) }).then(function (r) { return r.json(); }).then(function (c) {
        if (!c.ok) throw new Error(c.error || "เชื่อมต่อไม่สำเร็จ");
        S.settings.push = Object.assign({}, S.settings.push || {}, { url: url, token: token, key: c.publicKey });
        delete S.settings.pushOff;
        save({ noSnap: true, noCount: true });
        lsj("td_push_last", null);
        return pushSync(true);
      });
    }).then(function () { toast("เชื่อมต่อตัวส่งแล้ว"); openPush(); }, function (e) {
      if (err) err.textContent = /Failed to fetch|NetworkError|Load failed/i.test(e.message) ? "ติดต่อที่อยู่นี้ไม่ได้ — ตรวจที่อยู่ หรือยังไม่ได้กด Deploy" : e.message;
    });
  };
  window.pushForget = function () {
    var b = document.getElementById("pu-forget");
    if (b && !b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "แตะอีกครั้งเพื่อยืนยัน"; return; }
    var go = dev() ? window.pushDisableHere : function () {};
    go();
    delete S.settings.push; S.settings.pushOff = Date.now(); lsj("td_push_cfg", null); save({ noSnap: true, noCount: true });
    lsj("td_push_dev", null); lsj("td_push_last", null);
    toast("เลิกใช้แจ้งเตือนแล้ว"); openPush();
  };
  // โหลดโค้ดตัวส่งไว้ก่อน (ทั้งหน้าแจ้งเตือนและหน้าวิดเจ็ต) — บน iPad ต้องคัดลอกทันทีที่แตะ
  function loadWorker() {
    if (WORKER_CODE) return Promise.resolve(WORKER_CODE);
    return fetch("push-worker.js", { cache: "no-store" }).then(function (r) { return r.ok ? r.text() : null; })
      .then(function (t) { if (t) WORKER_CODE = t; return WORKER_CODE; }).catch(function () { return null; });
  }
  window.pushCopyWorker = function () {
    if (WORKER_CODE) { copyText(WORKER_CODE); return; }
    toast("กำลังโหลดโค้ด…");
    loadWorker().then(function (t) {
      // ยังอยู่ในจังหวะแตะ (Android/Chrome คัดลอกได้) · ถ้าเครื่องไม่ยอม แตะปุ่มอีกครั้งจะคัดลอกทันที
      if (t) copyText(t);
      else toast("โหลดโค้ดไม่ได้ — เช็กเน็ต หรือเปิดไฟล์โค้ดแล้วเลือกทั้งหมด");
    });
  };
  window.__pushLoadWorker = loadWorker;

  /* ── หน้าตั้งค่าแจ้งเตือน ── */
  function steps() {
    return '<details class="more"' + (cfg() ? '' : ' open') + '><summary>ตั้งตัวส่งบน Cloudflare (ครั้งเดียว · ฟรี · ประมาณ 15 นาที)</summary><ol class="syguide">' +
      '<li>เปิด <b>dash.cloudflare.com</b> › <b>Sign up</b> ด้วยอีเมล (ไม่ต้องผูกบัตร) › ยืนยันอีเมล</li>' +
      '<li>เมนู <b>Workers &amp; Pages</b> › <b>Create</b> › เลือก <b>Start with Hello World</b> › ตั้งชื่อ <b>kruta-push</b> › <b>Deploy</b></li>' +
      '<li>กด <b>Edit code</b> › ลบโค้ดเดิมทั้งหมด › วางโค้ดตัวส่ง › <b>Deploy</b>' +
        '<button class="btn-g" type="button" style="min-height:40px;margin-top:6px;width:100%;" onclick="pushCopyWorker()">📋 คัดลอกโค้ดตัวส่ง</button>' +
        '<div class="hint">หรือเปิด <a href="push-worker.js" target="_blank" rel="noopener">ไฟล์โค้ด</a> แล้วเลือกทั้งหมด</div></li>' +
      '<li>เมนู <b>Storage &amp; Databases</b> › <b>KV</b> › <b>Create</b> › ตั้งชื่อ <b>kruta</b></li>' +
      '<li>กลับไปที่ Worker <b>kruta-push</b> › <b>Settings</b> › <b>Bindings</b> › <b>Add</b> › <b>KV namespace</b> › ชื่อตัวแปร <b>KV</b> (ตัวใหญ่) › เลือก <b>kruta</b> › Deploy</li>' +
      '<li><b>Settings</b> › <b>Trigger Events</b> › <b>Add</b> › <b>Cron Triggers</b> › <b>Every minute</b> (<code>* * * * *</code>) › Add</li>' +
      '<li>คัดลอกที่อยู่ของ Worker (ลงท้าย <b>.workers.dev</b>) มาวางด้านล่าง</li>' +
      '</ol><div class="hint">ชื่อเมนูของ Cloudflare อาจต่างไปเล็กน้อย ทำตามความหมายได้เลย</div></details>';
  }
  function deviceState() {
    if (!supported()) {
      return '<div class="warnline">' + (isIOS() && !isStandalone()
        ? "บน iPad/iPhone ต้องเปิดแอปจาก <b>ไอคอนบนหน้าโฮม</b> ถึงจะแจ้งเตือนได้ (iPadOS 16.4 ขึ้นไป)"
        : "เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน") + "</div>";
    }
    var d = dev(), perm = Notification.permission;
    if (d && perm === "granted") {
      return '<div class="vline ok" style="margin-bottom:10px;">🔔 เปิดแจ้งเตือนบนเครื่องนี้แล้ว</div>' +
        '<div style="display:flex;gap:8px;"><button class="btn-brass" type="button" style="flex:2;" onclick="pushTest()">ส่งทดสอบ</button>' +
        '<button class="btn-g" type="button" style="flex:1;" onclick="pushDisableHere()">ปิดบนเครื่องนี้</button></div>';
    }
    if (perm === "denied") {
      return '<div class="warnline">เครื่องนี้ปิดการแจ้งเตือนของแอปไว้ — เปิดได้ที่ <b>การตั้งค่าเครื่อง › การแจ้งเตือน › ครูต้า</b> แล้วกลับมากดอีกครั้ง</div>' +
        '<button class="btn-g" id="pu-enable" type="button" style="width:100%;margin-top:8px;" onclick="pushEnableHere()">ลองอีกครั้ง</button>';
    }
    return '<div class="hint" style="margin-bottom:8px;">ต้องกดเปิดทีละเครื่อง (ทั้ง iPad และมือถือ)</div>' +
      '<button class="btn-brass" id="pu-enable" type="button" style="width:100%;" onclick="pushEnableHere()">🔔 เปิดแจ้งเตือนบนเครื่องนี้</button>';
  }
  function preview() {
    var list = reminders().slice(0, 3);
    if (!list.length) return '<div class="hint">ยังไม่มีคาบใน 3 สัปดาห์ข้างหน้า (ใส่เวลาให้คาบหรือตารางประจำ แล้วจะเตือนให้)</div>';
    return list.map(function (r) {
      var at = new Date(r.at), when = at.toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short" }) + " " +
        ("0" + at.getHours()).slice(-2) + ":" + ("0" + at.getMinutes()).slice(-2);
      return '<div style="padding:8px 0;border-bottom:1px solid #0002;"><div class="mono" style="font-size:12px;">' + esc(when) + '</div>' +
        '<div style="font-weight:700;">' + esc(r.title) + '</div><div class="hint">' + esc(r.body) + '</div></div>';
    }).join("");
  }
  function openPush() {
    loadWorker();
    var c = cfg(), body;
    if (!c) {
      body = '<div class="hint" style="margin-bottom:12px;">เตือนก่อนถึงคาบแม้ปิดแอปอยู่ ทั้ง iPad และมือถือ ต้องมีตัวส่งบน Cloudflare ของคุณเอง (ฟรี) ตั้งครั้งเดียวบนเครื่องไหนก็ได้ อีกเครื่องจะได้ค่าตามการซิงค์</div>' +
        steps() +
        '<div class="rc-group" style="margin-top:12px;"><label>ที่อยู่ตัวส่ง</label><input id="pu-url" type="url" inputmode="url" autocomplete="off" placeholder="https://kruta-push.xxxx.workers.dev"></div>' +
        '<div id="pu-err" class="warnline" style="margin-bottom:8px;display:none;"></div>' +
        '<button class="btn-brass" type="button" style="width:100%;" onclick="pushConnect()">เชื่อมต่อ</button>';
    } else {
      body = '<div class="vline ok" style="margin-bottom:12px;">☁ เชื่อมต่อตัวส่งแล้ว · <span class="mono" style="font-size:11px;">' + esc(c.url.replace(/^https:\/\//, "")) + '</span></div>' +
        '<div class="rc-group"><label>เตือนก่อนคาบเริ่ม</label>' +
          seg(LEADS.map(function (n) { return [n, n >= 60 ? (n / 60) + " ชม." : n + " นาที"]; }), lead(), "pushSetLead") +
          '<div class="hint" style="margin-top:6px;">ใช้ค่าเดียวกันทุกเครื่อง</div></div>' +
        '<div class="rc-group"><label>เครื่องนี้</label>' + deviceState() + '</div>' +
        '<div class="rc-group"><label>เตือนครั้งถัดไป</label>' + preview() + '</div>' +
        '<div class="rc-group"><label>ตรวจตัวส่ง</label><div id="pu-status"><div class="hint">กำลังตรวจ…</div></div></div>' +
        '<div class="hint" style="margin:10px 0;">ชื่อนักเรียนและเวลาคาบ 3 สัปดาห์ข้างหน้าจะถูกส่งไปเก็บใน Cloudflare ของคุณเอง เพื่อใช้ทำข้อความแจ้งเตือน</div>' +
        '<button class="linkbtn" id="pu-forget" type="button" onclick="pushForget()">เลิกใช้แจ้งเตือน</button>';
    }
    showModal('<div class="mhead"><div class="mtitle">🔔 แจ้งเตือนคาบถัดไป</div><button class="ib" type="button" onclick="closeModal()" aria-label="ปิด" style="font-size:19px;">✕</button></div>' + body, "460px");
    if (c) checkWorker();
  }

  /* ── ตรวจว่าตัวส่งพร้อมจริง: รุ่นโค้ด · Cron ทำงานไหม · รายการบนตัวส่งตรงกับในแอปไหม ── */
  function hm(t) { var d = new Date(t); return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2); }
  function checkWorker(retried) {
    var c = cfg(), box = function () { return document.getElementById("pu-status"); };
    function show(lines) { var b = box(); if (b) b.innerHTML = lines.join(""); }
    function ok(t) { return '<div class="vline ok" style="margin-bottom:6px;">✓ ' + t + '</div>'; }
    function warn(t) { return '<div class="warnline" style="margin-bottom:6px;">' + t + '</div>'; }
    fetch(c.url + "/").then(function (r) { return r.json(); }).then(function (info) {
      if (!info || !(info.version >= WORKER_VERSION)) {
        show([warn("<b>โค้ดตัวส่งเป็นรุ่นเก่า</b> — รุ่นนี้อาจพลาดแจ้งเตือนที่ตั้งไว้กระชั้นชิด<br>" +
          "Cloudflare › Workers &amp; Pages › <b>kruta-push</b> › <b>Edit code</b> › ลบโค้ดเดิม › วางโค้ดใหม่ › <b>Deploy</b>"),
          '<button class="btn-g" type="button" style="width:100%;min-height:40px;" onclick="pushCopyWorker()">📋 คัดลอกโค้ดตัวส่งรุ่นใหม่</button>']);
        return;
      }
      return api("/status").then(function (st) {
        var out = [], local = reminders(), lnext = local.length ? local[0].at : null, now = st.now || Date.now();
        if (!st.beat || now - st.beat > 12 * 60000) {
          out.push(warn("<b>ตัวส่งยังไม่ทำงานตามเวลา</b> — แจ้งเตือนจะไม่เด้งเอง (ปุ่มส่งทดสอบยังใช้ได้)<br>" +
            "Cloudflare › <b>kruta-push</b> › <b>Settings</b> › <b>Trigger Events</b> ต้องมี Cron <b>* * * * *</b><br>" +
            "ถ้าเพิ่งตั้ง/เพิ่งวางโค้ดใหม่ รอ 5 นาทีแล้วเปิดหน้านี้อีกครั้ง"));
        } else out.push(ok("ตัวส่งทำงานตามเวลา · ตรวจล่าสุด " + hm(st.beat)));
        if (lnext && st.next !== lnext) {
          if (!retried) {
            out.push('<div class="hint">กำลังส่งรายการเตือนล่าสุดขึ้นตัวส่ง…</div>'); show(out);
            pushSync(true).then(function () { setTimeout(function () { checkWorker(true); }, 1500); });
            return;
          }
          out.push(warn("รายการเตือนบนตัวส่งยังไม่ตรงกับในแอป — ตรวจเน็ตแล้วเปิดหน้านี้อีกครั้ง"));
        } else out.push(ok("รายการเตือนบนตัวส่งตรงกับในแอป (" + st.reminders + " รายการ" + (st.next ? " · ครั้งถัดไป " + hm(st.next) : "") + ")"));
        out.push('<div class="hint">เครื่องที่เปิดแจ้งเตือน ' + st.devices + ' เครื่อง' + (st.lastSent ? " · ส่งแจ้งเตือนล่าสุด " + hm(st.lastSent) : "") + '</div>');
        show(out);
      });
    }).catch(function (e) { show([warn("ติดต่อตัวส่งไม่ได้ — " + esc(e.message || "ไม่มีเน็ต?"))]); });
  }
  window.openPush = openPush;

  function statusLine() {
    if (!cfg()) return "ยังไม่ได้ตั้งค่า · เตือนแม้ปิดแอปอยู่";
    var on = supported() && dev() && Notification.permission === "granted";
    return (on ? "เปิดบนเครื่องนี้" : "ยังไม่ได้เปิดบนเครื่องนี้") + " · เตือนก่อน " + leadText(lead()).replace("อีก ", "");
  }

  /* เพิ่มแถวในหน้าตั้งค่า ต่อจาก "ซิงค์ iPad ↔ มือถือ" */
  var origMenu = window.openMenu;
  window.openMenu = function () {
    origMenu.apply(this, arguments);
    var rows = document.querySelectorAll("#modal-root .srow"), after = null;
    for (var i = 0; i < rows.length; i++) if (/ซิงค์ iPad/.test(rows[i].textContent)) { after = rows[i]; break; }
    if (!after) after = rows[rows.length - 1];
    if (!after) return;
    var b = document.createElement("button");
    b.className = "srow"; b.type = "button"; b.id = "pu-row"; b.style.marginBottom = "8px";
    b.innerHTML = '<span style="font-size:18px;flex-shrink:0;">🔔</span><div style="min-width:0;"><div style="font-weight:600;">แจ้งเตือนคาบถัดไป</div>' +
      '<div style="font-size:11px;color:#5A5A5A;margin-top:2px;">' + esc(statusLine()) + '</div></div>';
    b.addEventListener("click", function () { closeModal(); openPush(); });
    after.parentNode.insertBefore(b, after.nextSibling);
  };

  /* ข้อมูลเปลี่ยน (ทั้งจากเครื่องนี้และที่ซิงค์มา) → ส่งรายการเตือนใหม่ */
  /* ค่าตัวส่งอยู่ใน S.settings ซึ่งซิงค์ทั้งก้อน ถ้าอีกเครื่องส่ง settings รุ่นที่ยังไม่มีค่าล่าสุดมาทับ
     (เช่นรหัสวิดเจ็ตที่เพิ่งสร้าง) ค่าจะหายทั้งสองเครื่อง — จึงจำไว้ในเครื่องด้วย แล้วเติมส่วนที่หายกลับก่อนบันทึก */
  function keepCfg() {
    var cur = S.settings && S.settings.push, mem = lsj("td_push_cfg");
    if (S.settings && S.settings.pushOff) { lsj("td_push_cfg", null); return; }
    if (!cur || !cur.url || !cur.token) { if (mem && mem.url && mem.token && S.settings) S.settings.push = mem; return; }
    if (mem && mem.token === cur.token) Object.keys(mem).forEach(function (k) { if (cur[k] == null) cur[k] = mem[k]; });
    lsj("td_push_cfg", cur);
  }
  var origSave = window.save;
  window.save = function () {
    try { keepCfg(); } catch (e) {}
    var r = origSave.apply(this, arguments);
    // ข้อมูลที่เพิ่งรับมาจากอีกเครื่อง: เครื่องนั้นส่งรายการขึ้นตัวส่งไปแล้ว ไม่ต้องส่งซ้ำ (ประหยัดโควตาเขียน KV ฟรีวันละ 1,000 ครั้ง)
    if (cfg() && !(window.SY && SY.applying)) pushSyncSoon();
    return r;
  };

  /* ดูแลตัวเองตอนเปิดแอป: ลงทะเบียนใหม่ถ้าหลุด แล้วส่งรายการเตือนให้สด */
  function maintain() {
    if (!cfg()) return;
    var d = dev();
    if (d && supported() && Notification.permission === "granted" && (d.key !== cfg().key || Date.now() - (d.at || 0) > 3 * 86400000)) {
      subscribe().catch(function () {});
    } else if (d && supported() && Notification.permission === "granted") {
      navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); })
        .then(function (s) { if (!s) return subscribe(); }).catch(function () {});
    }
    pushSync(false);
  }
  var origStart = window.startApp;
  window.startApp = function () {
    var r = origStart.apply(this, arguments);
    setTimeout(maintain, 3000);
    return r;
  };
  document.addEventListener("visibilitychange", function () {
    var inApp = document.getElementById("app") && document.getElementById("app").style.display === "block";
    if (document.visibilityState === "visible" && inApp) pushSync(false);
    // ออกจากแอป (สลับแอป/ปิด) → ส่งรายการที่ค้างอยู่ทันที ไม่รอ 4 วินาที ซึ่งตอนนั้นแอปอาจถูกพักไปแล้ว
    if (document.visibilityState === "hidden" && syncT) pushSync(false, true);
  });
  window.addEventListener("pagehide", function () { if (syncT) pushSync(false, true); });

  window.__pushApi = api;            // ใช้ร่วมกับ 70-widget.js
  window.__pushCfg = cfg;
  window.__pushReminders = reminders;
  window.__pushSync = pushSync;
  window.__push = "on";
})();
