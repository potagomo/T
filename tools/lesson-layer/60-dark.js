/* ชั้นเว็บแอป: โหมดกลางคืน — tools/update-lesson.py ฝังไฟล์นี้ไว้ท้าย lesson/index.html (คู่กับ 60-dark.head.html)

   แอปเขียนสีตายตัวไว้ในแต่ละหน้าเกือบพันจุด (พื้นขาว เส้นดำ ตัวหนังสือเทา) แทนที่จะใช้ตัวแปรกลาง
   จึงแปลงสีตอนหน้าถูกวาด ทีละชิ้น จากค่าสีที่เบราว์เซอร์คำนวณได้จริง:
     • พื้นขาว/ครีม → พื้นการ์ดเข้ม · พื้นพาสเทลอ่อน → โทนเดียวกันแบบเข้ม · พื้นดำทึบ → กลับเป็นสีครีม
     • พื้นสีสด (เหลือง แดง เขียว ฟ้า ม่วง) คงไว้ — ตัวหนังสือบนนั้นยังเข้มเหมือนเดิม
     • ตัวหนังสือทุกชิ้นตรวจความต่างของสีกับพื้นจริง (WCAG 4.5:1) ไม่ผ่านก็ปรับความสว่างโดยคงเฉดสีไว้
     • เส้นขอบดำบนพื้นเข้ม → เส้นสีครีม · เงาดำแข็ง → เงาสีเข้มที่ยังมองเห็นบนพื้นเข้ม
   ค่าเดิมเก็บไว้ใน data-dk ของแต่ละชิ้น สลับกลับเป็นกลางวันได้ทันทีไม่ต้องโหลดใหม่
   รูป วิดีโอ canvas และตัวอย่างรูปส่งออก ไม่ถูกแตะ — รูปที่ส่งผู้ปกครองหน้าตาเหมือนเดิมทุกอย่าง */
(function () {
  "use strict";
  var KEY = "td_theme", ROOT = document.documentElement;
  var C = {
    paper: [22, 20, 15], card: [33, 30, 24], field: [42, 38, 31],
    ink: [240, 233, 218], muted: [181, 172, 154], line: [216, 207, 188], dark: [22, 20, 15],
    shadow: "rgb(0, 0, 0)", shadowOn: "rgb(74, 68, 54)"
  };
  var SKIP = { CANVAS: 1, IMG: 1, VIDEO: 1, AUDIO: 1, IFRAME: 1, SCRIPT: 1, STYLE: 1, LINK: 1, META: 1, BR: 1, OPTION: 1, SOURCE: 1, PICTURE: 1, TEMPLATE: 1, NOSCRIPT: 1 };
  var SKIP_SEL = ".rc-preview, .rcframe, .sw, [data-dk-skip], #print-area";

  function pref() { try { return localStorage.getItem(KEY) || "light"; } catch (e) { return "light"; } }
  function sysDark() { return !!(window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches); }
  function wantDark() { var p = pref(); return p === "dark" || (p === "auto" && sysDark()); }

  /* ── สี ── */
  function rgb(s) {
    var m = /rgba?\(([^)]+)\)/.exec(s || ""); if (!m) return null;
    var p = m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  }
  function css(c, a) { return "rgb(" + Math.round(c[0]) + ", " + Math.round(c[1]) + ", " + Math.round(c[2]) + (a != null && a < 1 ? ", " + a : "") + ")"; }
  function lin(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function chroma(c) { return (Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2])) / 255; }
  function over(top, base) { var a = top[3] == null ? 1 : top[3]; return [top[0] * a + base[0] * (1 - a), top[1] * a + base[1] * (1 - a), top[2] * a + base[2] * (1 - a), 1]; }
  function toHsl(c) {
    var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, s = 0, d = mx - mn;
    if (d) { s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; }
    return [h, s, l];
  }
  function fromHsl(h, s, l) {
    function f(p, q, t) { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; }
    if (!s) return [l * 255, l * 255, l * 255, 1];
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    return [f(p, q, h + 1 / 3) * 255, f(p, q, h) * 255, f(p, q, h - 1 / 3) * 255, 1];
  }
  // เลื่อนความสว่างของสีเดิม (คงเฉด) จนอ่านออกบนพื้นนั้น
  function readable(fg, bg) {
    var darkBg = lum(bg) < 0.18;
    if (chroma(fg) < 0.12) {
      if (darkBg) return lum(fg) < 0.05 ? C.ink : C.muted;
      return C.dark;
    }
    var h = toHsl(fg), l = h[2], c = fg;
    for (var i = 0; i < 20 && contrast(c, bg) < 4.5; i++) { l = darkBg ? Math.min(0.95, l + 0.04) : Math.max(0.05, l - 0.04); c = fromHsl(h[0], h[1], l); }
    return c;
  }

  /* ── จดค่าเดิม แล้วทับด้วย !important ──
     อ่านทั้งหน้าก่อน แล้วค่อยเขียนทีเดียว: ถ้าอ่าน-เขียนสลับกันทีละชิ้น เบราว์เซอร์ต้องคำนวณสไตล์ใหม่ทุกชิ้น
     (layout thrashing) — หน้าที่มีหลายร้อยชิ้นช้าลงหลายเท่า โดยเฉพาะบนมือถือ */
  var WRITES = null;
  function set(el, prop, val) { WRITES.push(el, prop, val); }
  function commit(list) {
    var touched = [];
    for (var i = 0; i < list.length; i += 3) {
      var el = list[i], prop = list[i + 1], val = list[i + 2];
      var rec = el.__dk || (el.__dk = el.dataset.dk ? JSON.parse(el.dataset.dk) : {});
      if (!(prop in rec)) rec[prop] = [el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)];
      el.style.setProperty(prop, val, "important");
      if (!el.__dkDirty) { el.__dkDirty = true; touched.push(el); }
    }
    for (var j = 0; j < touched.length; j++) { touched[j].dataset.dk = JSON.stringify(touched[j].__dk); touched[j].__dkDirty = false; }
  }
  function restore(el) {
    if (!el.dataset || !el.dataset.dk) return;
    var rec = el.__dk || JSON.parse(el.dataset.dk);
    Object.keys(rec).forEach(function (p) { if (rec[p][0]) el.style.setProperty(p, rec[p][0], rec[p][1]); else el.style.removeProperty(p); });
    delete el.dataset.dk; el.__dk = null;
  }
  function restoreAll(root) {
    if (root.dataset && root.dataset.dk) restore(root);
    Array.prototype.forEach.call(root.querySelectorAll("[data-dk]"), restore);
  }

  /* ── แปลงหนึ่งชิ้น (เรียงตามลำดับเอกสาร พ่อก่อนลูก) ── */
  function effBg(el, cache) {
    if (!el || el.nodeType !== 1) return C.paper;
    if (cache.has(el)) return cache.get(el);
    var own = rgb(getComputedStyle(el).backgroundColor), v;
    if (own && own[3] >= 0.99) v = own;
    else { var base = el === document.body || el === ROOT ? C.paper : effBg(el.parentElement, cache); v = own && own[3] > 0 ? over(own, base) : base; }
    cache.set(el, v);
    return v;
  }
  function fix(el, cache) {
    var cs = getComputedStyle(el);
    if (cs.display === "none") { cache.set(el, effBg(el.parentElement, cache)); return; }
    var bg = rgb(cs.backgroundColor);
    if (bg && bg[3] >= 0.5) {
      var L = lum(bg), ch = chroma(bg), nb = null;
      if (L > 0.80 && ch < 0.12) nb = /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) ? C.field : C.card;     // ขาว/ครีม
      else if (L > 0.80) nb = over([bg[0], bg[1], bg[2], 0.16], C.card);                                       // พาสเทลอ่อน → โทนเดียวกันแบบเข้ม
      else if (Math.max(bg[0], bg[1], bg[2]) <= 12 && el !== document.body && el !== ROOT) nb = C.ink;           // ดำสนิท → กลับด้าน
      if (nb) { set(el, "background-color", css(nb, bg[3] < 0.99 ? bg[3] : null)); bg = [nb[0], nb[1], nb[2], bg[3]]; }
    }
    // ใช้สีที่เพิ่งตั้งเอง ไม่อ่านกลับจากเบราว์เซอร์ (ถ้ามี transition ค่าที่อ่านได้ยังเป็นสีเก่าอยู่)
    var parentBg = el === document.body || el === ROOT ? C.paper : effBg(el.parentElement, cache);
    var eb = bg && bg[3] >= 0.99 ? bg : bg && bg[3] > 0 ? over(bg, parentBg) : parentBg, darkHere = lum(eb) < 0.18;
    cache.set(el, eb);

    var fg = rgb(cs.color);
    if (fg && fg[3] > 0.2 && contrast(fg, eb) < 4.5) set(el, "color", css(readable(fg, eb)));
    if (el instanceof SVGElement) {
      ["fill", "stroke"].forEach(function (p) {
        var v = rgb(cs[p]); if (v && v[3] > 0.2 && contrast(v, eb) < 2.2 && Math.max(v[0], v[1], v[2]) < 70) set(el, p, css(C.line));
      });
    }
    if (darkHere) {
      ["top", "right", "bottom", "left"].forEach(function (side) {
        if (parseFloat(cs["border-" + side + "-width"]) > 0 && cs["border-" + side + "-style"] !== "none") {
          var b = rgb(cs["border-" + side + "-color"]);
          if (b && b[3] > 0.15 && Math.max(b[0], b[1], b[2]) < 70) set(el, "border-" + side + "-color", css(C.line, b[3] < 0.99 ? Math.max(0.55, b[3]) : null));
        }
      });
      var oc = rgb(cs.outlineColor);
      if (parseFloat(cs.outlineWidth) > 0 && cs.outlineStyle !== "none" && oc && Math.max(oc[0], oc[1], oc[2]) < 70) set(el, "outline-color", css(C.line));
    }
    // เงาแข็งสีดำ → เงาสีที่ยังมองเห็นบนพื้นเข้ม
    if (cs.boxShadow && cs.boxShadow !== "none" && /rgba?\(0, 0, 0/.test(cs.boxShadow) && lum(parentBg) < 0.18) {
      set(el, "box-shadow", cs.boxShadow.replace(/rgba?\(0, 0, 0(, [\d.]+)?\)/g, function (m, a) { return a && parseFloat(a.slice(2)) < 0.3 ? m : C.shadowOn; }));
    }
  }
  function walk(root, cache) {
    if (root.nodeType !== 1 || SKIP[root.tagName] || (root.closest && root.closest(SKIP_SEL))) return;
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode: function (n) { return SKIP[n.tagName] || (n.matches && n.matches(SKIP_SEL)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; }
    });
    var n = root, own = !WRITES;
    if (own) WRITES = [];
    while (n) { try { fix(n, cache); } catch (e) {} n = tw.nextNode(); }
    if (own) { var w = WRITES; WRITES = null; commit(w); }
  }

  /* ── ตามดูหน้าที่วาดใหม่ ── */
  var mo = null, queue = [], raf = 0, on = false;
  function flush() {
    raf = 0;
    if (!on) { queue = []; return; }
    mo.disconnect();
    ROOT.classList.add("dk-fixing");                 // ปิด transition ระหว่างแปลง ไม่ให้เห็นพื้นขาวค่อย ๆ จางเป็นเข้ม
    var cache = new Map(), roots = queue; queue = [];
    roots = roots.filter(function (r, i) {
      if (!r.isConnected) return false;
      for (var j = 0; j < roots.length; j++) if (j !== i && roots[j] !== r && roots[j].contains(r) && roots[j].isConnected) return false;
      return roots.indexOf(r) === i;
    });
    WRITES = [];                                      // ทุกส่วนที่เปลี่ยนในเฟรมนี้: อ่านให้ครบก่อน แล้วเขียนรวดเดียว
    roots.forEach(function (r) { walk(r, cache); });
    var w = WRITES; WRITES = null; commit(w);
    void document.body.offsetWidth;                   // ให้สีใหม่มีผลก่อนเปิด transition กลับ
    ROOT.classList.remove("dk-fixing");
    mo.takeRecords();
    observe();
  }
  function schedule(n) { queue.push(n); if (!raf) raf = requestAnimationFrame(flush); }
  function observe() { mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] }); }
  function onMut(list) {
    list.forEach(function (m) {
      if (m.type === "childList") { m.addedNodes.forEach(function (n) { if (n.nodeType === 1) schedule(n); }); }
      else if (m.attributeName === "class") { restoreAll(m.target); schedule(m.target); }
      else schedule(m.target);
    });
  }

  function meta(c) { var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute("content", c); }
  function apply() {
    var d = wantDark();
    if (d === on && (d ? ROOT.getAttribute("data-theme") === "dark" : true)) return;
    on = d;
    if (d) {
      ROOT.setAttribute("data-theme", "dark"); meta("#16140F");
      if (!mo) mo = new MutationObserver(onMut);
      schedule(document.body);
    } else {
      if (mo) mo.disconnect();
      queue = [];
      ROOT.removeAttribute("data-theme"); meta("#FFFDF5");
      restoreAll(document.body);
    }
  }
  window.addEventListener("beforeprint", function () { if (on) { if (mo) mo.disconnect(); restoreAll(document.body); ROOT.removeAttribute("data-theme"); } });
  window.addEventListener("afterprint", function () { if (on) { on = false; apply(); } });
  if (window.matchMedia) {
    var mq = matchMedia("(prefers-color-scheme: dark)");
    (mq.addEventListener ? mq.addEventListener.bind(mq, "change") : mq.addListener.bind(mq))(function () { if (pref() === "auto") apply(); });
  }

  /* ── ตั้งค่า (แยกต่อเครื่อง ไม่ซิงค์ — iPad กับมือถืออาจอยากต่างกัน) ── */
  var LABEL = { auto: "ตามเครื่อง", light: "กลางวัน", dark: "กลางคืน" };
  window.setThemePref = function (v) {
    try { localStorage.setItem(KEY, v); } catch (e) {}
    apply(); openTheme();
  };
  function openTheme() {
    showModal('<div class="mhead"><div class="mtitle">🌙 โหมดกลางคืน</div><button class="ib" type="button" onclick="closeModal()" aria-label="ปิด" style="font-size:19px;">✕</button></div>' +
      '<div class="rc-group"><label>สีหน้าจอ</label>' + seg([["auto", "ตามเครื่อง"], ["light", "☀ กลางวัน"], ["dark", "🌙 กลางคืน"]], pref(), "setThemePref") +
      '<div class="hint" style="margin-top:8px;">“ตามเครื่อง” สลับเองตามการตั้งค่าของ iPad/มือถือ · ตั้งแยกกันได้ในแต่ละเครื่อง<br>' +
      'รูปและข้อความที่ส่งผู้ปกครองหน้าตาเหมือนเดิมทุกโหมด</div></div>' +
      '<button class="btn-g" type="button" style="width:100%;margin-top:6px;" onclick="closeModal()">ปิด</button>', "420px");
  }
  window.openTheme = openTheme;
  if (typeof window.openMenu === "function") {
    var origMenu = window.openMenu;
    window.openMenu = function () {
      origMenu.apply(this, arguments);
      var rows = document.querySelectorAll("#modal-root .srow"), after = document.getElementById("pu-row");
      for (var i = 0; !after && i < rows.length; i++) if (/ลูกเล่นและความรู้สึก/.test(rows[i].textContent)) after = rows[i];
      if (!after) return;
      var b = document.createElement("button");
      b.className = "srow"; b.type = "button"; b.id = "th-row"; b.style.marginBottom = "8px";
      b.innerHTML = '<span style="font-size:18px;flex-shrink:0;">🌙</span><div style="min-width:0;"><div style="font-weight:600;">โหมดกลางคืน</div>' +
        '<div style="font-size:11px;color:#5A5A5A;margin-top:2px;">' + LABEL[pref()] + (pref() === "auto" ? " (ตอนนี้" + (sysDark() ? "กลางคืน" : "กลางวัน") + ")" : "") + '</div></div>';
      b.addEventListener("click", function () { closeModal(); openTheme(); });
      after.parentNode.insertBefore(b, after.nextSibling);
    };
  }

  window.__dark = { apply: apply, on: function () { return on; } };
  apply();
})();
