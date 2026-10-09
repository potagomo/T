/* ชั้นเว็บแอป: เลือกภาษาไทย / English — tools/update-lesson.py ฝังไฟล์นี้ไว้ท้าย lesson/index.html
   แก้ที่ tools/lesson-layer/05-i18n.js แล้วรัน update-lesson.py อย่าแก้ใน index.html ตรง ๆ

   แอปเดิมเขียนข้อความไทยฝังในโค้ดกว่า 3,000 จุด จึงแปล "ที่หน้าจอ" แทนการแก้ทุกจุด:
   ข้อความที่วาดขึ้นจอ (และ placeholder / title / aria-label / alert / confirm) ถูกเทียบกับพจนานุกรม lesson/i18n/en.json
     1) ทั้งก้อนตรงกันพอดี → ใช้คำแปลทั้งประโยค
     2) ไม่ตรง (มีตัวเลข ชื่อ วันที่แทรก) → แปลวันที่ไทยเป็นสากล (ปี พ.ศ. → ค.ศ.) แล้วแปลทีละช่วงตัวอักษรไทย
     ช่วงที่ไม่มีในพจนานุกรม (เช่นชื่อนักเรียน โน้ตที่ครูพิมพ์) คงไว้ตามเดิม
   ไม่แปล: สิ่งที่ส่งถึงผู้ปกครอง (รูปการ์ด ข้อความ กล่องตัวอย่างข้อความ .textpreview) · ช่องกรอก · อักษรย่อในวงกลมรูปนักเรียน
   พจนานุกรม (~240 KB) โหลดผ่าน Service Worker ซึ่งเก็บไว้ในแคชของแอป (ไม่กินที่ localStorage ของข้อมูลคาบ)
   แปลเสร็จก่อนผู้ใช้ปลดล็อกเข้าแอปทัน · ไทย → อังกฤษ เปลี่ยนทันที · อังกฤษ → ไทย โหลดหน้าใหม่ */
(function () {
  "use strict";
  var KEY = "td_lang", DICT_V = "__I18N_V__";
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  var LANG = ls(KEY) === "en" ? "en" : "th";
  window.__lang = LANG;

  /* ── แถวเลือกภาษาในหน้าตั้งค่า (ทั้งสองภาษา) ── */
  function openLang() {
    if (typeof showModal !== "function") return;
    var b = function (v, label, sub) {
      return '<button class="srow" type="button" data-lang="' + v + '" data-noi18n style="margin-bottom:8px;' + (LANG === v ? "border-width:3px;" : "") + '">' +
        '<span style="font-size:20px;flex-shrink:0;">' + (LANG === v ? "✓" : "") + '</span><div style="min-width:0;"><div style="font-weight:700;">' + label + '</div>' +
        '<div style="font-size:11.5px;color:#5A5A5A;margin-top:2px;">' + sub + '</div></div></button>';
    };
    showModal('<div class="mhead" data-noi18n><div class="mtitle">🌐 ภาษา · Language</div><button class="ib" type="button" onclick="closeModal()" aria-label="Close" style="font-size:19px;">✕</button></div>' +
      b("th", "ภาษาไทย", "ค่าเริ่มต้น") + b("en", "English", "App screens in English · reports to parents stay in Thai") +
      '<div class="hint" data-noi18n style="margin-top:6px;">ตั้งทีละเครื่อง · Set per device</div>', "380px");
    Array.prototype.forEach.call(document.querySelectorAll("#modal-root [data-lang]"), function (el) {
      el.addEventListener("click", function () {
        var v = el.getAttribute("data-lang");
        if (v === LANG) { closeModal(); return; }
        ls(KEY, v === "en" ? "en" : null);
        if (v === "en") { LANG = window.__lang = "en"; closeModal(); enable(true); }   // เป็นอังกฤษได้ทันที ไม่ต้องเข้าแอปใหม่
        else location.reload();                                                     // กลับเป็นไทย: โหลดหน้าใหม่ให้ข้อความเดิมกลับมาครบ
      });
    });
  }
  window.openLang = openLang;
  if (typeof window.openMenu === "function") {
    var origMenu = window.openMenu;
    window.openMenu = function () {
      var r = origMenu.apply(this, arguments);
      var lock = document.querySelector('#modal-root button.srow[onclick="lockApp()"]');
      var anchor = document.getElementById("th-row") || lock;
      if (anchor && !document.getElementById("lang-row")) {
        var b = document.createElement("button");
        b.className = "srow"; b.type = "button"; b.id = "lang-row"; b.style.marginBottom = "8px"; b.setAttribute("data-noi18n", "");
        b.innerHTML = '<span style="font-size:18px;flex-shrink:0;">🌐</span><div style="min-width:0;"><div style="font-weight:600;">ภาษา · Language</div>' +
          '<div style="font-size:11px;color:#5A5A5A;margin-top:2px;">' + (LANG === "en" ? "English" : "ภาษาไทย") + '</div></div>';
        b.addEventListener("click", function () { closeModal(); openLang(); });
        anchor.parentNode.insertBefore(b, anchor.nextSibling);
      }
      return r;
    };
  }
  /* ── พจนานุกรม ── */
  var D = null, PRE = [], SUF = [];
  // คำที่แปลแล้วมีช่องว่างท้าย/หัว = ชิ้นที่ในภาษาไทยติดกับชื่อหรือค่าที่ต่อท้ายโดยไม่เว้นวรรค (เช่น "สอนล่าสุด" + ชื่อ)
  // ใช้แยกช่วงไทยที่ติดกันเป็นก้อนเดียวตอนแสดงผล — จำกัดเฉพาะคำพวกนี้ ไม่ตัดชื่อคนมั่ว ๆ
  function index() {
    PRE = []; SUF = [];
    Object.keys(D).forEach(function (k) {
      if (k.length < 3) return;
      if (/ $/.test(D[k])) PRE.push(k);
      if (/^ /.test(D[k])) SUF.push(k);
    });
    PRE.sort(function (a, b) { return b.length - a.length; });
    SUF.sort(function (a, b) { return b.length - a.length; });
  }

  // อักษรไทย ไม่รวม ฿ (U+0E3F อยู่ในช่วงเดียวกันแต่เป็นสัญลักษณ์เงิน)
  var THAI = /[\u0E01-\u0E3A\u0E40-\u0E5B]/, RUN = /[\u0E01-\u0E3A\u0E40-\u0E5B](?:[\u0E01-\u0E3A\u0E40-\u0E5B ]*[\u0E01-\u0E3A\u0E40-\u0E5B])?/g;
  var MON = { "ม.ค.": "Jan", "ก.พ.": "Feb", "มี.ค.": "Mar", "เม.ย.": "Apr", "พ.ค.": "May", "มิ.ย.": "Jun", "ก.ค.": "Jul", "ส.ค.": "Aug", "ก.ย.": "Sep", "ต.ค.": "Oct", "พ.ย.": "Nov", "ธ.ค.": "Dec" };
  var MONF = { "มกราคม": "January", "กุมภาพันธ์": "February", "มีนาคม": "March", "เมษายน": "April", "พฤษภาคม": "May", "มิถุนายน": "June", "กรกฎาคม": "July", "สิงหาคม": "August", "กันยายน": "September", "ตุลาคม": "October", "พฤศจิกายน": "November", "ธันวาคม": "December" };
  var DAY = { "อา": "Sun", "จ": "Mon", "อ": "Tue", "พ": "Wed", "พฤ": "Thu", "ศ": "Fri", "ส": "Sat" };
  var DAYF = { "อาทิตย์": "Sunday", "จันทร์": "Monday", "อังคาร": "Tuesday", "พุธ": "Wednesday", "พฤหัสบดี": "Thursday", "พฤหัส": "Thursday", "ศุกร์": "Friday", "เสาร์": "Saturday" };
  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  var MON_RE = new RegExp("(" + Object.keys(MON).map(esc).join("|") + ")(\\s*(25\\d\\d))?", "g");
  var MONF_RE = new RegExp("(" + Object.keys(MONF).join("|") + ")(\\s*(25\\d\\d))?", "g");
  function be(y) { return y ? " " + (Number(y) - 543) : ""; }
  function dates(s) {
    return s.replace(/พ\.ศ\.\s*/g, "")
      .replace(MON_RE, function (m, mo, sp, y) { return MON[mo] + be(y); })
      .replace(MONF_RE, function (m, mo, sp, y) { return MONF[mo] + be(y); });
  }
  function word(r) {
    if (D && D[r] != null) return D[r];
    var x = r.replace(/^วัน(?=\S)/, "");
    if (DAYF[x]) return DAYF[x];
    if (DAY[r]) return DAY[r];
    return null;
  }
  function piece(x, depth) { var w = word(x); if (w == null && depth < 3) w = glued(x, depth + 1); return w; }
  function glued(r, depth) {
    depth = depth || 0;
    for (var i = 0; i < PRE.length; i++) if (r.length > PRE[i].length && r.indexOf(PRE[i]) === 0) {
      var rest = r.slice(PRE[i].length), w = piece(rest, depth);
      return D[PRE[i]] + (w == null ? rest : w);
    }
    for (var j = 0; j < SUF.length; j++) if (r.length > SUF[j].length && r.slice(-SUF[j].length) === SUF[j]) {
      var head = r.slice(0, -SUF[j].length), w2 = piece(head, depth);
      return (w2 == null ? head : w2) + D[SUF[j]];
    }
    // สองคำที่รู้จักทั้งคู่ติดกัน (เช่น "จันทร์" + "บ่อยสุด") — ต้องรู้จักทั้งสองฝั่ง จึงไม่ตัดชื่อคน
    for (var k = r.length - 2; k >= 2; k--) {
      var a = word(r.slice(0, k)); if (a == null) continue;
      var b = word(r.slice(k)); if (b == null) continue;
      return (a + " " + b).replace(/\s+/g, " ");
    }
    return null;
  }
  // ประโยคที่เจอบ่อยและเรียงคำต่างจากอังกฤษ — แปลทั้งประโยค (มาก่อนการแปลทีละคำ)
  var TPL = [
    [/^พบ (\d+) คาบที่ประเภทโรงเรียน\/ส่วนตัวอาจไม่ถูก$/, "$1 lessons may be marked School/Private wrongly"],
    [/^(\d+) คาบที่ประเภทโรงเรียน\/ส่วนตัวอาจไม่ถูก$/, "$1 lessons may be marked School/Private wrongly"],
    [/^พบ (\d+) คาบที่ควรตรวจ/, "$1 lessons to check"],
    [/^เหลือ (\d+) คาบรอยืนยัน$/, "$1 lessons still pending"],
    [/^● กำลังสอน · เหลือ (\d+) นาที$/, "● Teaching now · $1 min left"],
    [/^เหลืออีก (\d+) ครั้ง$/, "$1 sessions left"],
    [/^เหลืออีก (\d+) ครั้ง · ถึงเวลาคุยต่อคอร์ส$/, "$1 sessions left · time to talk about renewing"],
    [/^มาเรียน (\d+) ครั้ง(?= ·|$)/, "Attended $1 times"],
    [/^สอนแล้ว (\d+) คาบ(?= ·|$)/, "Taught $1 lessons"],
    [/^ลงคาบให้ (\d+) คน$/, "Log lessons for $1 students"],
    [/^ลงคาบให้ (\d+) คนแล้ว — อย่าลืมกดยืนยันสถานะ$/, "Logged lessons for $1 students — remember to confirm attendance"],
    [/^(\d+) คาบ · รอยืนยัน (\d+)$/, "$1 lessons · $2 pending"],
    [/^(\d+) คาบ · ยืนยันครบ$/, "$1 lessons · all confirmed"],
    [/^(\d+) คาบวันนี้$/, "$1 lessons today"],
    [/^มีชื่อนี้ (\d+) คน — ตรวจว่าเลือกถูกคน$/, "$1 students share this name — check you picked the right one"]
  ];
  // "1 lessons" → "1 lesson"
  var PLURAL = /\b1 (lessons|sessions|days|times|students|people|hours|minutes|weeks|months|items|courses|entries|devices|photos|clips)\b/g;
  var SING = { lessons: "lesson", sessions: "session", days: "day", times: "time", students: "student", people: "person", hours: "hour", minutes: "minute", weeks: "week", months: "month", items: "item", courses: "course", entries: "entry", devices: "device", photos: "photo", clips: "clip" };
  function plural(s) { return s.replace(PLURAL, function (m, w) { return "1 " + SING[w]; }); }
  function tr(s) {
    if (!s || !THAI.test(s)) return s;
    var lead = s.match(/^\s*/)[0], trail = s.match(/\s*$/)[0], core = s.trim().replace(/\s+/g, " ");
    if (D && D[core] != null) return lead + plural(D[core]) + trail;
    for (var t = 0; t < TPL.length; t++) if (TPL[t][0].test(core)) { core = core.replace(TPL[t][0], TPL[t][1]); if (!THAI.test(core)) return lead + plural(core) + trail; break; }
    // {ครู} {ชื่อ} คือคำที่ครูพิมพ์ใส่แม่แบบ ต้องคงเป็นไทย
    var keep = [];
    var out = core.replace(/\{[^}]*\}/g, function (m) { keep.push(m); return "\u0001" + (keep.length - 1) + "\u0001"; });
    out = dates(out).replace(/(\d{1,2}[:.]\d{2})\s*น\.(?=\s|$|[)·,—])/g, "$1");   // "16:00 น." → "16:00"
    if (D && D[out] != null) return lead + D[out] + trail;
    out = out.replace(RUN, function (r, at, all) {
      var h = word(r);
      if (h == null) h = glued(r);
      if (h == null) {                                   // ลองตัดช่วงยาวเป็นคำ ๆ ตามช่องว่าง
        if (r.indexOf(" ") < 0) return r;
        h = r.split(" ").map(function (p) { var w = word(p); if (w == null) w = glued(p); return w == null ? p : w; }).join(" ");
        if (h === r) return r;
      }
      var before = all.charAt(at - 1), after = all.charAt(at + r.length);
      if (h && /[0-9A-Za-z฿%)]/.test(before) && !/^\s/.test(h)) h = " " + h;
      if (h && /[0-9A-Za-z(]/.test(after) && !/\s$/.test(h)) h = h + " ";
      return h;
    });
    out = out.replace(/\u0001(\d+)\u0001/g, function (m, i) { return keep[+i]; });
    return lead + plural(out) + trail;
  }
  window.__tr = tr;

  /* ── แปลบนหน้าจอ ── */
  var SKIP_TAG = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, NOSCRIPT: 1, CANVAS: 1 };
  var SKIP_SEL = "[data-noi18n], .textpreview, [contenteditable=''], [contenteditable='true'], .rc-preview, #rc-preview";
  // รีเซ็ตแอปต้องพิมพ์ "ลบทั้งหมด" — ภาษาอังกฤษพิมพ์ "Delete all" ได้ด้วย
  document.addEventListener("input", function (e) {
    var t = e.target;
    if (window.__lang !== "en" || !t || t.id !== "rst-word" || typeof RST !== "object") return;
    if (t.value.trim().toLowerCase() === "delete all") {
      RST.typed = "ลบทั้งหมด";
      var b = document.getElementById("rst-go"); if (b) b.disabled = false;
    }
  });
  var ATTRS = ["placeholder", "title", "aria-label", "alt"];
  function skipEl(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (SKIP_TAG[n.tagName]) return true;
      if (n.matches && n.matches(SKIP_SEL)) return true;
    }
    return false;
  }
  var SEG = { "สัปดาห์": "Week", "บันทึก": "Log", "เดือน": "Month", "ปี": "Year", "วัน": "Day", "รายคน": "By student" };
  function initials(t) {                                  // อักษรย่อชื่อในวงกลมรูปนักเรียน
    var p = t.parentElement;
    return t.nodeValue.trim().length <= 2 && p && /border-radius:\s*50%/.test(p.getAttribute("style") || "");
  }
  function doText(t) {
    var v = t.nodeValue;
    if (!v || !THAI.test(v) || initials(t)) return;
    if (v.trim() === "ยืนยัน" && t.parentElement.closest("svg")) { t.nodeValue = "done"; return; }   // ป้ายเล็กในวงกลมความคืบหน้า
    if (SEG[v.trim()] && t.parentElement.closest(".segbtn")) { t.nodeValue = SEG[v.trim()]; return; }   // แท็บย่อย: คำเดียวกันแต่ความหมายต่าง
    var n = tr(v); if (n !== v) t.nodeValue = n;
  }
  function doAttrs(el) {
    for (var i = 0; i < ATTRS.length; i++) {
      var a = el.getAttribute && el.getAttribute(ATTRS[i]);
      if (a && THAI.test(a)) { var n = tr(a); if (n !== a) el.setAttribute(ATTRS[i], n); }
    }
  }
  function walk(root) {
    if (root.nodeType === 3) { if (root.parentElement && !skipEl(root.parentElement)) doText(root); return; }
    if (root.nodeType !== 1 || skipEl(root)) return;
    doAttrs(root);
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (n.nodeType === 1) return SKIP_TAG[n.tagName] || (n.matches && n.matches(SKIP_SEL)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var n;
    while ((n = tw.nextNode())) { if (n.nodeType === 3) doText(n); else doAttrs(n); }
  }
  var mo = null;
  function run(list) {
    mo.disconnect();
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (m.type === "childList") for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]);
      else if (m.type === "characterData") { if (m.target.parentElement && !skipEl(m.target.parentElement)) doText(m.target); }
      else if (m.type === "attributes" && !skipEl(m.target)) doAttrs(m.target);
    }
    if (THAI.test(document.title)) document.title = tr(document.title);
    observe();
  }
  function observe() { mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS }); }
  function start() {
    mo = new MutationObserver(run);
    walk(document.body);
    document.title = tr(document.title);
    observe();
  }
  function enable(fresh) {
    document.documentElement.lang = "en";
    ["alert", "confirm", "prompt"].forEach(function (k) {
      var o = window[k]; if (typeof o !== "function") return;
      window[k] = function (msg) { var a = Array.prototype.slice.call(arguments); if (typeof msg === "string") a[0] = tr(msg); return o.apply(window, a); };
    });
    try { localStorage.removeItem("td_i18n_en"); } catch (e) {}
    fetch("i18n/en.json?v=" + DICT_V).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d) { if (typeof toast === "function") toast("โหลดภาษาอังกฤษไม่ได้ — ต่อเน็ตแล้วลองใหม่"); return; }
      D = d; index(); start();
      if (fresh && typeof toast === "function") toast("Switched to English");
    }).catch(function () { if (typeof toast === "function") toast("โหลดภาษาอังกฤษไม่ได้ — ต่อเน็ตแล้วลองใหม่"); });
    window.__i18n = "en";
  }
  if (LANG === "en") enable(false); else window.__i18n = "th";
})();
