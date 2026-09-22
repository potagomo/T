#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""เติมชั้นเว็บแอปลงไฟล์ ครูต้า — Drum Lesson Log แล้วเขียนเป็น lesson/index.html

วิธีใช้
    python3 tools/apply-lesson-layer.py                      # สร้างใหม่จาก lesson/src/original.html
    python3 tools/apply-lesson-layer.py ~/Downloads/ครูต้า.html  # ได้ไฟล์รุ่นใหม่มา

    ถ้าส่งไฟล์รุ่นใหม่มา สคริปต์จะเก็บไว้เป็น lesson/src/original.html ให้ด้วย
    (ต้นฉบับอยู่ใน git เสมอ จึงสร้าง index.html ซ้ำได้ทุกเมื่อ)

ทำอะไรบ้าง — ตรรกะของโปรแกรมไม่ถูกแตะเลย แทรกเพิ่มแค่ใน <head>, ท้าย <style>, ก่อน </body>
    • manifest + ไอคอนเป็นไฟล์จริง  → ติดตั้งลงหน้าโฮม iPad / Android ได้
    • Service Worker               → เปิดได้แม้ไม่มีเน็ต
    • CSP                          → หน้านี้โหลดโค้ด/รูปจากที่อื่นไม่ได้เลย
    • color-scheme: dark           → ปฏิทินเลือกวันที่/ช่องเลือกบน Android เป็นธีมมืด
                                     (ไม่งั้นไอคอนปฏิทินสีดำจมหายในช่องสีดำ)
    • interactive-widget           → คีย์บอร์ด Android ไม่บังช่องกรอกและปุ่มบันทึก
    • แก้คีย์บอร์ด iPad บังปุ่มบันทึกในหน้าต่างกรอกข้อมูล
    • ซ่อนแถบเมนูล่างระหว่างพิมพ์ · เผื่อขอบกล้องเจาะรูตอนจอแนวนอน
    • แถบ "มีรุ่นใหม่" ให้กดอัปเดตเอง ไม่รีโหลดกลางคันระหว่างกรอกข้อมูล

ถ้าหาที่แทรกไม่เจอ สคริปต์จะหยุดพร้อมบอกเหตุผล ไม่เติมผิดที่แล้วเงียบ
"""
import io, os, re, shutil, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APPDIR = os.path.join(ROOT, "lesson")
SRC = os.path.join(APPDIR, "src", "original.html")
DST = os.path.join(APPDIR, "index.html")
MARKER = "ชั้นเว็บแอป"

CSP = " ".join([
    "default-src 'self';",
    "script-src 'self' 'unsafe-inline';",
    "style-src 'self' 'unsafe-inline';",
    "img-src 'self' data: blob:;",
    "media-src 'self' data: blob:;",
    "font-src 'self' data:;",
    "connect-src 'self' data: blob:;",
    "worker-src 'self';",
    "manifest-src 'self';",
    "object-src 'none';",
    "base-uri 'self';",
    "form-action 'none'",
])

HEAD_BLOCK = u'''
<!-- ==================== ชั้นเว็บแอป ====================
     ทำให้ไฟล์เดียวนี้ติดตั้งลงหน้าโฮม iPad / Android ได้ ใช้ตอนไม่มีเน็ตได้
     และปิดทางไม่ให้หน้านี้โหลดของจากที่อื่น — ตรรกะของโปรแกรมไม่ถูกแตะ

     สร้างโดย tools/apply-lesson-layer.py — อย่าแก้ตรงนี้ด้วยมือ
     ==================================================== -->
<script>/* กันเอาหน้านี้ไปฝังใน iframe ของเว็บอื่น (clickjacking) */
if(self!==top){try{top.location=self.location}catch(e){document.documentElement.innerHTML=""}}</script>
<meta http-equiv="Content-Security-Policy" content="__CSP__">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow">
<meta name="description" content="บันทึกคาบสอนกลอง นักเรียน คอร์ส และรายได้ — เก็บข้อมูลในเครื่อง ใช้ได้แม้ไม่มีเน็ต">
<meta name="color-scheme" content="dark">
<meta name="mobile-web-app-capable" content="yes">
<meta name="format-detection" content="telephone=no">
<link rel="manifest" href="./manifest.webmanifest">
<link rel="icon" type="image/png" sizes="32x32" href="./icons/favicon-32.png">
<link rel="icon" type="image/png" sizes="192x192" href="./icons/icon-192.png">
<link rel="apple-touch-icon" sizes="180x180" href="./icons/apple-touch-icon.png">'''.replace("__CSP__", CSP)

CSS_BLOCK = u'''
/* ==================== ชั้นเว็บแอป: iPad / Android ====================
   สร้างโดย tools/apply-lesson-layer.py — อย่าแก้ตรงนี้ด้วยมือ
   ==================================================================== */
:root{color-scheme:dark;
  --sal:env(safe-area-inset-left,0px); --sar:env(safe-area-inset-right,0px);}
/* จอแนวนอน: กล้องเจาะรูของ Galaxy / ขอบมนของจอ ไม่ทับเนื้อหา */
.wrap{padding-left:max(16px,var(--sal)); padding-right:max(16px,var(--sar));}
.hdr{padding-left:max(16px,var(--sal)); padding-right:max(16px,var(--sar));}
.botnav{padding-left:var(--sal); padding-right:var(--sar);}
@media(min-width:768px){.wrap{padding-left:max(20px,var(--sal)); padding-right:max(20px,var(--sar));}}
/* หน้าต่างกรอกข้อมูลยกขึ้นพ้นคีย์บอร์ดบนจอ iPad (ค่า --kb ตั้งจากสคริปต์ท้ายไฟล์)
   ปุ่มบันทึกที่ติดท้ายหน้าต่างจึงยังกดได้ขณะพิมพ์อยู่ */
.overlay{bottom:var(--kb,0px);}
@media (pointer:coarse){
  /* ระหว่างพิมพ์ ซ่อนแถบเมนูล่าง ไม่ให้ลอยขึ้นมาทับบนคีย์บอร์ด */
  body:has(input:focus,textarea:focus) .botnav{display:none;}
  /* กดค้างที่ปุ่มแล้วไม่มีเมนูคัดลอก/เลือกข้อความเด้งขึ้นมา */
  button,.navbtn,.seg{-webkit-touch-callout:none; -webkit-user-select:none; user-select:none;}
}
/* แถบแจ้งว่ามีรุ่นใหม่ — ขึ้นเฉพาะตอนมีรุ่นใหม่ให้อัปเดตจริงเท่านั้น */
#swbar{position:fixed; left:0; right:0; top:0; z-index:5000; display:flex; gap:10px;
  align-items:center; justify-content:center; flex-wrap:wrap; font-size:13.5px; color:#f0eeea;
  padding:calc(10px + env(safe-area-inset-top,0px)) 14px 10px; background:#16140f;
  border-bottom:1px solid rgba(209,160,90,.5); box-shadow:0 6px 20px rgba(0,0,0,.5);
  animation:fadeIn .2s ease both;}
#swbar button{border:0; border-radius:8px; font-weight:700; font-size:13.5px; min-height:40px; padding:8px 14px;}
#swbar .go{background:#d1a05a; color:#12100c;}
#swbar .x{background:transparent; color:#a09c95; font-weight:500;}'''

TAIL_BLOCK = u'''<script>
/* ==================== ชั้นเว็บแอป: Service Worker + คีย์บอร์ด ====================
   สร้างโดย tools/apply-lesson-layer.py — อย่าแก้ตรงนี้ด้วยมือ
   ================================================================================ */
(function(){
"use strict";

/* ── คีย์บอร์ดบนจอ iPad/iPhone ไม่ย่อหน้าจอให้ หน้าต่างกรอกข้อมูลจึงจมใต้คีย์บอร์ด
   วัดความสูงที่ถูกบังจริงจาก visualViewport แล้วยกหน้าต่างขึ้นเท่านั้น
   (Android ย่อหน้าจอให้เองจาก interactive-widget ค่าที่วัดได้จึงเป็น 0 ไม่มีผล)
   ต่ำกว่า 80px ไม่นับ — เป็นแค่แถบทางลัดของคีย์บอร์ดตัวจริงที่ต่อกับ iPad */
var vv = window.visualViewport, rootEl = document.documentElement;
if (vv) {
  var last = -1;
  var fit = function(){
    var kb = Math.round(window.innerHeight - vv.height - vv.offsetTop);
    if (!(kb > 80)) kb = 0;
    if (kb === last) return;
    last = kb;
    rootEl.style.setProperty("--kb", kb + "px");
  };
  vv.addEventListener("resize", fit);
  vv.addEventListener("scroll", fit);
  window.addEventListener("orientationchange", function(){ setTimeout(fit, 350); });
  fit();
}

/* ── Service Worker ─────────────────────────────────────────────────────────
   ตั้งใจ "ไม่" รีโหลดเองเมื่อมีรุ่นใหม่ เพราะอาจกำลังกรอกบันทึกการสอนอยู่
   จึงขึ้นแถบให้กดเองแทน */
if (location.protocol !== "https:" && location.protocol !== "http:") return;
if (!("serviceWorker" in navigator)) return;

/* ครั้งแรกที่เปิด หน้านี้อาจถูกคุมโดย Service Worker ของแอปหน้าแรก (/T/) อยู่
   จึงต้องดูว่า controller เป็น "ของเราเอง" ไม่ใช่แค่มีหรือไม่มี
   ไม่งั้นแถบอัปเดตจะขึ้นมั่วตั้งแต่เปิดครั้งแรก */
var MY_SW = new URL("./sw.js", location.href).href;
function oursControls(){
  var c = navigator.serviceWorker.controller;
  return !!c && c.scriptURL === MY_SW;
}

function showBar(waiting){
  if (document.getElementById("swbar")) return;
  var bar = document.createElement("div");
  bar.id = "swbar";
  bar.setAttribute("role", "status");
  bar.innerHTML = '<span>มีแอปรุ่นใหม่แล้ว</span>' +
    '<button type="button" class="go" id="swgo">อัปเดตเดี๋ยวนี้</button>' +
    '<button type="button" class="x" id="swno">ไว้ก่อน</button>';
  document.body.appendChild(bar);
  document.getElementById("swno").onclick = function(){ bar.remove(); };
  document.getElementById("swgo").onclick = function(){
    bar.remove();
    var done = false;
    navigator.serviceWorker.addEventListener("controllerchange", function(){
      if (done) return; done = true; location.reload();
    });
    waiting.postMessage({ type: "SKIP_WAITING" });
  };
}

window.addEventListener("load", function(){
  navigator.serviceWorker.register("./sw.js", { scope: "./" }).then(function(reg){
    if (reg.waiting && oursControls()) showBar(reg.waiting);
    reg.addEventListener("updatefound", function(){
      var sw = reg.installing;
      if (!sw) return;
      sw.addEventListener("statechange", function(){
        // มี controller อยู่แล้ว = เป็นการอัปเดต ไม่ใช่การติดตั้งครั้งแรก
        if (sw.state === "installed" && oursControls()) showBar(sw);
      });
    });
    // เปิดแอปค้างไว้ข้ามวันได้ เช็ครุ่นใหม่ทุกครั้งที่กลับมาที่แอป
    document.addEventListener("visibilitychange", function(){
      if (!document.hidden) reg.update().catch(function(){});
    });
  }).catch(function(){ /* ไม่มีโหมดออฟไลน์ ก็ยังใช้งานได้ตามปกติ */ });
});
})();
</script>
</body>'''


def die(msg):
    sys.stderr.write(u"\n❌  %s\n\n" % msg)
    sys.exit(1)


def patch(src):
    steps = []

    # 1) viewport: viewport-fit=cover (ให้ safe-area ทำงาน) + interactive-widget (คีย์บอร์ด Android)
    m = re.search(r'<meta\s+name=["\']viewport["\'][^>]*>', src, re.I)
    if not m:
        die(u"หา <meta name=viewport> ไม่เจอ — ไฟล์ต้นฉบับเปลี่ยนโครงไปแล้ว")
    tag = m.group(0)
    cm = re.search(r'content=(["\'])(.*?)\1', tag)
    if not cm:
        die(u"<meta name=viewport> ไม่มี content")
    parts = [p.strip() for p in cm.group(2).split(",") if p.strip()]
    keys = [p.split("=")[0].strip().lower() for p in parts]
    for k, v in [("viewport-fit", "cover"), ("interactive-widget", "resizes-content")]:
        if k not in keys:
            parts.append("%s=%s" % (k, v))
            steps.append(u"viewport: เติม %s=%s" % (k, v))
    newtag = tag[:cm.start(2)] + ", ".join(parts) + tag[cm.end(2):]
    src = src[:m.start()] + newtag + src[m.end():]

    # 2) ไอคอนที่ฝังเป็น base64 → ใช้ไฟล์จริงแทน (Android ต้องการ 192/512 ใน manifest,
    #    และตัดทิ้งเพื่อไม่ให้ Safari สับสนว่าจะใช้อันไหน — ไฟล์เล็กลง ~50 KB ด้วย)
    n = 0
    def drop(mm):
        nonlocal n
        n += 1
        return ""
    src = re.sub(r'^[ \t]*<link\s+rel=["\'](?:apple-touch-icon|icon|shortcut icon)["\'][^>]*href=["\']data:[^"\']*["\'][^>]*>[ \t]*\r?\n?',
                 drop, src, flags=re.I | re.M)
    steps.append(u"ไอคอน: ตัดไอคอน base64 ที่ฝังไว้ออก %d อัน ใช้ไฟล์ใน lesson/icons แทน" % n)

    # 3) head
    m = re.search(r'</title\s*>', src, re.I)
    if not m:
        die(u"หา </title> ไม่เจอ — แทรกบล็อก head ไม่ได้")
    src = src[:m.end()] + HEAD_BLOCK + src[m.end():]
    steps.append(u"head: แทรก manifest / CSP / ไอคอน / color-scheme ต่อจาก </title>")

    # 4) css ท้าย <style> ก้อนสุดท้ายใน <head>
    head_end = re.search(r'</head\s*>', src, re.I)
    if not head_end:
        die(u"หา </head> ไม่เจอ")
    styles = list(re.finditer(r'</style\s*>', src[:head_end.start()], re.I))
    if not styles:
        die(u"ไม่เจอ </style> ใน <head>")
    at = styles[-1].start()
    src = src[:at] + CSS_BLOCK + "\n" + src[at:]
    steps.append(u"css: แทรก safe-area / คีย์บอร์ด / แถบอัปเดต ท้าย <style>")

    # 5) ก่อน </body> ตัวสุดท้าย
    m = None
    for m in re.finditer(r'</body\s*>', src, re.I):
        pass
    if not m:
        die(u"หา </body> ไม่เจอ")
    src = src[:m.start()] + TAIL_BLOCK + src[m.end():]
    steps.append(u"body: แทรกตัวลงทะเบียน Service Worker + ตัวจัดคีย์บอร์ด ก่อน </body>")
    return src, steps


def audit(src):
    problems = []
    for what, pat in [
        (u"CSP", r'http-equiv=["\']Content-Security-Policy'),
        (u"manifest", r'rel=["\']manifest'),
        (u"apple-touch-icon", r'rel=["\']apple-touch-icon'),
        (u"ตัวลงทะเบียน Service Worker", r'serviceWorker\.register'),
        (u"color-scheme", r'name=["\']color-scheme'),
        (u"interactive-widget", r'interactive-widget=resizes-content'),
        (u"viewport-fit", r'viewport-fit=cover'),
    ]:
        if not re.search(pat, src, re.I):
            problems.append(u"ผลลัพธ์ไม่มี %s" % what)

    if re.search(r'href=["\']data:image', src, re.I):
        problems.append(u"ยังเหลือไอคอน base64 อยู่")

    # ของที่โหลดจากข้างนอกจะถูก CSP บล็อกเงียบ ๆ ต้องเตือนก่อน
    ext = sorted(set(mm.group(1) for mm in re.finditer(
        r'(?:src|href)\s*=\s*["\'](https?://[^"\']+)["\']', src, re.I)))
    if ext:
        problems.append(u"ไฟล์ดึงของจากข้างนอก %d รายการ CSP จะบล็อกทิ้ง:\n     " % len(ext) +
                        u"\n     ".join(ext) + u"\n     → ย้ายมาเก็บในโปรเจกต์ หรือผ่อน CSP อย่างจงใจ")
    if re.search(r'\bnew Function\s*\(|\beval\s*\(', src):
        problems.append(u"โค้ดรุ่นนี้ใช้ eval/new Function — ต้องเติม 'unsafe-eval' ใน CSP ก่อน ไม่งั้นแอปพัง")

    for f in ["manifest.webmanifest", "sw.js", "icons/icon-192.png", "icons/icon-512.png",
              "icons/icon-maskable-512.png", "icons/apple-touch-icon.png", "icons/favicon-32.png"]:
        if not os.path.exists(os.path.join(APPDIR, f)):
            problems.append(u"ไฟล์ประกอบหาย: lesson/%s" % f)
    return problems


def main():
    if len(sys.argv) > 2:
        sys.stderr.write(__doc__); sys.exit(2)
    srcpath = sys.argv[1] if len(sys.argv) == 2 else SRC
    if not os.path.isfile(srcpath):
        die(u"ไม่พบไฟล์: %s" % srcpath)
    raw = io.open(srcpath, encoding="utf-8").read()
    if MARKER in raw:
        die(u"ไฟล์นี้ถูกเติมชั้นเว็บแอปไปแล้ว — ต้องใช้ไฟล์ต้นฉบับที่ยังไม่ถูกเติม")
    if u"Drum Lesson Log" not in raw:
        die(u"ไฟล์นี้ไม่ใช่ ครูต้า — Drum Lesson Log (ไม่เจอคำว่า Drum Lesson Log)\n"
            u"    ถ้าเป็นไฟล์ กลอง → MIDI ให้ใช้ tools/apply-webapp-layer.py แทน")

    out, steps = patch(raw)
    print(u"ขั้นตอนที่ทำ")
    for s in steps:
        print(u"  ✓ " + s)
    problems = audit(out)
    if problems:
        sys.stderr.write(u"\nไม่ผ่านการตรวจ ยังไม่เขียนไฟล์\n")
        for p in problems:
            sys.stderr.write(u"  ✗ " + p + u"\n")
        sys.exit(1)

    if os.path.abspath(srcpath) != os.path.abspath(SRC):
        os.makedirs(os.path.dirname(SRC), exist_ok=True)
        shutil.copyfile(srcpath, SRC)
        print(u"  ✓ เก็บต้นฉบับรุ่นใหม่ไว้ที่ lesson/src/original.html")
    io.open(DST, "w", encoding="utf-8", newline="").write(out)
    print(u"\n✅ เขียน lesson/index.html แล้ว (%s → %s ไบต์)" % (format(len(raw), ","), format(len(out.encode("utf-8")), ",")))
    print(u"   ต่อไป: node tools/smoke-test-lesson.js แล้วค่อย commit + push")


if __name__ == "__main__":
    main()
