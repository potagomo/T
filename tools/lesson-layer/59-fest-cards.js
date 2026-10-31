/* ชั้นเว็บแอป: รูปส่งผู้ปกครองตามเทศกาล / ฤดู — tools/update-lesson.py ฝังไฟล์นี้ไว้ท้าย lesson/index.html

   แอปมีปฏิทินเทศกาลจริงอยู่แล้ว (festivalNear · FEST_THEMES: ปีใหม่ วันเด็ก วันครู ตรุษจีน วาเลนไทน์ สงกรานต์ วันแม่
   ฮาโลวีน ลอยกระทง วันพ่อ คริสต์มาส) แต่ใช้แค่ตกแต่งหน้าแอปกับการ์ดแจ้งวันหยุด ชั้นนี้ทำเป็น "หน้าตา" ของรูปส่งผู้ปกครอง:
     • ธีมเทศกาล (t-<id>) สีของเทศกาล + อิโมจิหัวการ์ด + แถบสี + จุดสีกระจายขอบบน + คำอวยพรท้ายรูป
     • ธีมฤดู ช่วงที่ไม่มีเทศกาล: ☀️ หน้าร้อน · ปิดเทอม (15 ก.พ.–15 พ.ค.) · 🌧️ หน้าฝน (16 พ.ค.–15 ต.ค.) · ❄️ หน้าหนาว (16 ต.ค.–14 ก.พ.)
     • ยึดวันที่ของคาบ (คาบ 28 ต.ค. = ฮาโลวีน แม้เปิดส่งวันที่ 2 พ.ย.)
     • อัตโนมัติ (ตั้งที่ ⚙ › ส่งผู้ปกครองและหน้าตา › การ์ดตามเทศกาล/ฤดู · S.settings.festCards):
         "all" (ค่าเริ่มต้น) เทศกาลแทนทุกแบบ · ฤดูแทนเฉพาะ "ค่าเริ่มต้นของทุกคน" (ที่ตั้งไว้รายคน/รายโรงเรียนยังใช้ตามเดิม)
         "fest" เฉพาะเทศกาล · "off" ไม่เปลี่ยนเอง
       แบบทางการ (tone formal) ไม่ถูกแทน · คาบที่ส่งการ์ดไปแล้วคงหน้าตาเดิม (รหัสตรวจไม่เพี้ยน)
     • ธีมของช่วงนั้นขึ้นเป็นรูปเล็กแรก ๆ ในแกลเลอรีเสมอ เลือกใช้เองได้ทุกโหมด */
(function () {
  "use strict";
  var NEED = ["festivalNear", "festivalsForYear", "allPresets", "presetById", "resolvePreset", "withDefaults", "contrast", "shade", "layoutCard"];
  var miss = NEED.filter(function (n) { return typeof window[n] !== "function"; });
  if (miss.length || typeof FEST_THEMES !== "object") { window.__festCards = "missing: " + miss.join(","); return; }

  var SEASONS = {
    summer: { emoji: "☀️", name: "หน้าร้อน · ปิดเทอม", accent: "#EA580C", bg: "#FFF7E8", ink: "#2A1606", sub: "#5C3A1A", band: "#FDBA74", bandInk: "#2A1606",
      dots: ["#FDBA74", "#FACC15", "#38BDF8"], greeting: "ปิดเทอมนี้ ซ้อมกลองให้มันส์เลย!" },
    rainy: { emoji: "🌧️", name: "หน้าฝน", accent: "#0F766E", bg: "#EEFBF8", ink: "#062A26", sub: "#24514B", band: "#5EEAD4", bandInk: "#062A26",
      dots: ["#5EEAD4", "#7DD3FC", "#A7F3D0"], greeting: "ฝนตกก็ไม่หยุดซ้อม 🥁" },
    cool: { emoji: "❄️", name: "หน้าหนาว", accent: "#1D4ED8", bg: "#F1F6FF", ink: "#0B1B3F", sub: "#334A73", band: "#93C5FD", bandInk: "#0B1B3F",
      dots: ["#93C5FD", "#C4B5FD", "#FFFFFF"], greeting: "อากาศเย็น ๆ ซ้อมกลองให้อุ่นมือ" }
  };
  function seasonOf(iso) {
    var md = String(iso).slice(5, 10);
    return md >= "02-15" && md < "05-16" ? "summer" : md >= "05-16" && md < "10-16" ? "rainy" : "cool";
  }
  function mode() { var m = S.settings && S.settings.festCards; return m === "fest" || m === "off" ? m : "all"; }
  function greetingOf(id) {
    var y = new Date().getFullYear(), f = festivalsForYear(y).concat(festivalsForYear(y + 1)).filter(function (x) { return x.id === id; })[0];
    return f ? f.greeting : "";
  }

  /* ── สร้างพรีเซ็ตจากธีม (สีอ่านออกตามเกณฑ์เดียวกับตัวเตือนคอนทราสต์ของแอป) ── */
  function readable(c, bg, min) {
    var dark = contrast("#000000", bg) > contrast("#FFFFFF", bg), x = c;
    for (var i = 0; i < 12 && contrast(x, bg) < min; i++) x = shade(x, dark ? -0.12 : 0.12);
    return x;
  }
  function mix(a, b, t) {
    var A = hexRgb(a), B = hexRgb(b);
    return "#" + A.map(function (v, i) { return Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0"); }).join("");
  }
  var CACHE = {};
  function themePreset(key) {
    if (CACHE[key]) return CACHE[key];
    var season = key.indexOf("season-") === 0, id = season ? key.slice(7) : key, th = season ? SEASONS[id] : FEST_THEMES[id];
    if (!th || id === "custom") return null;
    var accent = readable(th.accent, th.bg, 3), ink = readable(th.ink, th.bg, 7);
    var on = contrast(th.bandInk, accent) >= 4.5 ? th.bandInk : contrast("#FFFFFF", accent) > contrast("#000000", accent) ? "#FFFFFF" : "#000000";
    var p = { id: "t-" + key, name: th.emoji + " " + th.name, builtin: true, theme: season ? "season" : "festival",
      concept: (season ? "ธีมฤดู" : "ธีมเทศกาล") + " · เปลี่ยนเองตามวันที่ของคาบ",
      style: withDefaults({ tone: "friendly", emoji: true, mono: false,
        bg: th.bg, surface: mix(th.bg, th.accent, 0.14), line: mix(th.bg, th.ink, 0.16), title: ink, text: ink,
        body: readable(th.sub, th.bg, 4.5), muted: readable(mix(th.sub, th.bg, 0.25), th.bg, 4.5),
        accent: accent, onAccent: on, headerEmoji: th.emoji, radius: 18, stripe: th.band, stripeH: 14, mediaFrame: accent,
        footerText: season ? th.greeting : greetingOf(id), fest: { key: key, emoji: th.emoji, dots: th.dots || [th.accent] } }) };
    CACHE[key] = p;
    return p;
  }
  // ธีมของวันที่หนึ่ง: เทศกาลที่ใกล้ (ถ้ามี) และฤดู
  function themesOn(iso) {
    var out = [], f = festivalNear(iso);
    if (f && FEST_THEMES[f.id] && f.id !== "custom") out.push(themePreset(f.id));
    out.push(themePreset("season-" + seasonOf(iso)));
    return out.filter(Boolean);
  }
  window.__festCardThemes = function (iso) { return themesOn(iso || todayStr()).map(function (p) { return p.id; }); };

  /* ── พรีเซ็ต: ธีมของช่วงนั้นอยู่หน้าแกลเลอรี · หา id ธีมได้ทุกเทศกาล ── */
  function contextDate() {
    var l = typeof RC === "object" && RC && typeof rcLesson === "function" ? rcLesson() : null;
    return l && l.date ? l.date : todayStr();
  }
  var origAll = window.allPresets;
  window.allPresets = function () { return themesOn(contextDate()).concat(origAll.apply(this, arguments)); };
  var origById = window.presetById;
  window.presetById = function (id) {
    if (typeof id === "string" && id.indexOf("t-") === 0) return themePreset(id.slice(2));
    return origById.apply(this, arguments);
  };

  /* ── เลือกอัตโนมัติ ── */
  var origResolve = window.resolvePreset;
  window.resolvePreset = function (l) {
    var r = origResolve.apply(this, arguments), m = mode();
    if (!l || !l.date) return r;
    var sent = l.sentCard && l.sentCard.preset;
    if (sent && String(sent).indexOf("t-") === 0 && themePreset(String(sent).slice(2))) return { id: sent, src: "theme" };
    if (sent || m === "off") return r;                                   // ส่งไปแล้ว: หน้าตาเดิม
    var base = origById(r.id);
    if (base && withDefaults(base.style).tone === "formal") return r;   // ทางการคงทางการ
    var th = themesOn(l.date), fest = th.filter(function (p) { return p.theme === "festival"; })[0];
    if (fest) return { id: fest.id, src: "festival", base: r };
    if (m === "all" && r.src === "default") return { id: th[th.length - 1].id, src: "season", base: r };
    return r;
  };
  if (typeof window.rcPresetsHtml === "function") {
    var origPresets = window.rcPresetsHtml;
    window.rcPresetsHtml = function () {
      var out = origPresets.apply(this, arguments);
      var src = document.getElementById("rc-src"), l = typeof rcLesson === "function" ? rcLesson() : null;
      if (src && l) {
        var res = resolvePreset(l), p = presetById(res.id);
        if (p && p.theme) src.textContent = "อัตโนมัติ: " + p.name + " (" + (res.src === "festival" ? "ช่วงเทศกาล" : res.src === "season" ? "ธีมฤดู" : "ใช้ตอนส่งครั้งก่อน") +
          " · เปลี่ยนได้ที่ ⚙ › การ์ดตามเทศกาล/ฤดู)" + (RC.presetId !== res.id || RC.dirty ? " · ตอนนี้กำลังใช้แบบอื่นเฉพาะครั้งนี้" : "");
      }
      return out;
    };
  }

  /* ── ลวดลาย: จุดสีขอบบน + อิโมจิจาง ๆ มุมล่าง (สุ่มแบบคงที่ต่อธีม → รูปเดิมทุกครั้ง รหัสตรวจไม่เปลี่ยน) ── */
  function rng(seed) { var x = 0; for (var i = 0; i < seed.length; i++) x = (x * 31 + seed.charCodeAt(i)) >>> 0; return function () { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; }; }
  var origLayout = window.layoutCard;
  window.layoutCard = function (ctx, W, l, imgs, draw, textScale, ST) {
    var f = ST && ST.fest;
    if (draw && ctx && f && f.dots) {
      var r = rng(f.key), H = ctx.canvas.height / (ctx.getTransform ? ctx.getTransform().d || 1 : 1), top = ST.stripe ? (ST.stripeH || 14) : 0;
      ctx.save();
      for (var i = 0; i < 22; i++) {
        ctx.globalAlpha = 0.35 + r() * 0.35;
        ctx.fillStyle = f.dots[i % f.dots.length];
        ctx.beginPath(); ctx.arc(r() * W, top + 7 + r() * 16, 2.5 + r() * 4.5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 0.09; ctx.font = "150px sans-serif"; ctx.textAlign = "right"; ctx.textBaseline = "bottom";
      ctx.fillText(f.emoji, W - 14, H - 8);
      ctx.restore();
    }
    return origLayout.apply(this, arguments);
  };

  /* ── ตั้งค่า: ⚙ › ส่งผู้ปกครองและหน้าตา ── */
  var LABEL = { all: "อัตโนมัติ — เทศกาล + ธีมฤดู", fest: "อัตโนมัติ — เฉพาะช่วงเทศกาล", off: "ไม่เปลี่ยนเอง (เลือกในแกลเลอรีได้)" };
  if (typeof window.openMenu === "function") {
    var origMenu = window.openMenu;
    window.openMenu = function () {
      var r = origMenu.apply(this, arguments);
      var anchor = document.getElementById("nong-row") || document.getElementById("lang-row");
      if (anchor && !document.getElementById("festcard-row")) {
        var b = document.createElement("button");
        b.className = "srow"; b.type = "button"; b.id = "festcard-row"; b.style.marginBottom = "8px";
        var paint = function () {
          var now = themesOn(todayStr()), cur = now[0];
          b.innerHTML = '<span style="font-size:18px;flex-shrink:0;">' + (cur ? cur.style.headerEmoji : "🎉") + '</span><div style="min-width:0;"><div style="font-weight:600;">การ์ดตามเทศกาล / ฤดู</div>' +
            '<div style="font-size:11px;color:#5A5A5A;margin-top:2px;">' + esc(LABEL[mode()]) + (cur ? ' · ช่วงนี้: ' + esc(cur.name) : '') + '</div></div>';
        };
        paint();
        b.addEventListener("click", function () {
          var order = ["all", "fest", "off"], next = order[(order.indexOf(mode()) + 1) % order.length];
          S.settings.festCards = next;
          save({ noSnap: true, noCount: true });
          if (window.RC) RC.cache = {};
          paint();
          toast("การ์ดผู้ปกครอง: " + LABEL[next]);
        });
        anchor.parentNode.insertBefore(b, anchor.nextSibling);
      }
      return r;
    };
  }
  window.__festCards = "on";
})();
