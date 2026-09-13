#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""เติมชั้นเว็บแอปลงในไฟล์ HTML รุ่นใหม่ แล้วเขียนทับ index.html

วิธีใช้
    python3 tools/apply-webapp-layer.py path/to/klong-pro-9.html

ทำไมต้องมีสคริปต์นี้
    ไฟล์ต้นฉบับถูกพัฒนาเพิ่มเรื่อย ๆ ทุกครั้งที่ได้ไฟล์ใหม่มาก็ต้องเติมชั้นเว็บแอป
    (manifest, Service Worker, CSP, safe-area, ฟอนต์ในเครื่อง) กลับเข้าไปใหม่ทั้งชุด
    ทำมือทีละรอบจะลืมข้อใดข้อหนึ่งเมื่อไหร่ก็ได้ สคริปต์นี้ทำให้ผลออกมาเหมือนเดิมทุกครั้ง

    จุดสำคัญ: ถ้าหาที่แทรกไม่เจอ มันจะ "หยุดพร้อมบอกว่าหาอะไรไม่เจอ"
    ไม่ใช่เติมผิดที่แล้วเงียบ — ไฟล์ที่ออกมาผิดแบบเงียบ ๆ อันตรายกว่าไฟล์ที่ไม่ออกมาเลย

ตรรกะของโปรแกรมไม่ถูกแตะ สคริปต์นี้แทรกของเพิ่มเข้าไปสามที่เท่านั้น
คือใน <head>, ท้ายบล็อก <style> และก่อน </body>
"""
import io, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

FONT_WEIGHTS = ["300", "400", "500", "600"]
FONT_SUBSETS = ["thai", "latin", "latin-ext"]

CSP = " ".join([
    "default-src 'self';",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval';",
    "style-src 'self' 'unsafe-inline';",
    "img-src 'self' data: blob:;",
    "media-src 'self' blob:;",
    "font-src 'self';",
    "connect-src 'self';",
    "worker-src 'self';",
    "manifest-src 'self';",
    "object-src 'none';",
    "base-uri 'self';",
    "form-action 'none'",
])

HEAD_BLOCK = u'''
<!-- ==================== ชั้นเว็บแอป ====================
     ส่วนนี้เพิ่มเข้ามาเพื่อให้ไฟล์เดียวกลายเป็นเว็บแอปที่ติดตั้งลงหน้าโฮมของ
     iPad/มือถือได้ ใช้ตอนไม่มีเน็ตได้ และปิดทางให้หน้านี้โหลดของจากที่อื่น
     ตรรกะของโปรแกรมไม่ถูกแตะเลย

     สร้างโดย tools/apply-webapp-layer.py — อย่าแก้ตรงนี้ด้วยมือ
     ถ้าจะเปลี่ยน ให้ไปแก้ในสคริปต์แล้วรันใหม่ ไม่งั้นรอบหน้าจะถูกเขียนทับ
     ==================================================== -->
<script>/* กันเอาหน้านี้ไปฝังใน iframe ของเว็บอื่น (clickjacking) */
if(self!==top){try{top.location=self.location}catch(e){document.documentElement.innerHTML=""}}</script>
<meta http-equiv="Content-Security-Policy" content="__CSP__">
<meta name="referrer" content="no-referrer">
<!-- ไม่ให้เสิร์ชเอนจินเก็บหน้านี้ไปทำดัชนี (robots.txt ใช้ไม่ได้กับ project page
     เพราะมันอ่านที่รากโดเมนเท่านั้น จึงต้องสั่งที่ meta) -->
<meta name="robots" content="noindex, nofollow">
<meta name="description" content="ถอดจังหวะกลองจากไฟล์เสียงออกมาเป็นโน้ตและไฟล์ MIDI แก้บนกริด ฟังเทียบ แล้วส่งออก — ประมวลผลในเครื่องทั้งหมด ไม่ส่งไฟล์ออกไปไหน">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#1F1B19">
<link rel="manifest" href="./manifest.webmanifest">
<link rel="icon" type="image/png" sizes="32x32" href="./icons/favicon-32.png">
<link rel="icon" type="image/png" sizes="512x512" href="./icons/icon-512.png">
<link rel="apple-touch-icon" href="./icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="กลอง→MIDI">
<meta name="format-detection" content="telephone=no">
<!-- ฟอนต์เก็บไว้ในโปรเจกต์เอง ไม่เรียก Google แล้ว: เปิดได้ตอนไม่มีเน็ต เร็วกว่า
     และไม่มีใครนอกเครื่องรู้ว่าเราเปิดหน้านี้ (สัญญาอนุญาต SIL OFL 1.1) -->
<link rel="preload" href="./fonts/ibm-plex-sans-thai-thai-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="./fonts/ibm-plex-sans-thai-latin-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="./fonts/ibm-plex-sans-thai.css">'''.replace("__CSP__", CSP)

CSS_BLOCK = u'''
/* ==================== ชั้นเว็บแอป: จอ iPad และมือถือ ====================
   1) รอยบาก/ขีดโฮมของ iPhone·iPad กินพื้นที่จอจริง เวลาเปิดจากหน้าโฮม
      แถบล่าง (#tp) จะไปอยู่ใต้ขีดโฮมถ้าไม่เผื่อไว้ จึงเผื่อด้วย env(safe-area-*)
   2) Safari จะซูมหน้าเข้าเองเมื่อแตะช่องกรอกที่ตัวอักษรเล็กกว่า 16px
      พอซูมแล้วกริดเลื่อนหลุดมือ จึงบังคับ 16px เฉพาะบนจอสัมผัส
      (ช่องรหัสในประตูหน้าใช้ 16px อยู่แล้วด้วยเหตุผลเดียวกัน)

   สร้างโดย tools/apply-webapp-layer.py — อย่าแก้ตรงนี้ด้วยมือ
   ====================================================================== */
:root{
  --sat:env(safe-area-inset-top,0px);  --sab:env(safe-area-inset-bottom,0px);
  --sal:env(safe-area-inset-left,0px); --sar:env(safe-area-inset-right,0px);
}
html{-webkit-text-size-adjust:100%}
header{padding-top:calc(18px + var(--sat))}
main{padding-left:calc(18px + var(--sal)); padding-right:calc(18px + var(--sar));
     padding-bottom:calc(132px + var(--sab))}
body.locked main.wrap{padding-top:calc(8px + var(--sat))}
#tp{padding-left:calc(12px + var(--sal)); padding-right:calc(12px + var(--sar));
    padding-bottom:calc(8px + var(--sab))}
#tp.min{padding-bottom:calc(6px + var(--sab))}
#gate{padding:calc(20px + var(--sat)) calc(20px + var(--sar)) calc(20px + var(--sab)) calc(20px + var(--sal))}
@media (max-width:700px){
  main{padding-left:calc(10px + var(--sal)); padding-right:calc(10px + var(--sar));
       padding-bottom:calc(190px + var(--sab))}
}
/* แถบล่างสูงตามจอจริง ไม่ใช่จอที่รวมแถบเครื่องมือของ Safari ที่ยุบ ๆ ยืด ๆ */
@supports (height:1dvh){ #tp{max-height:52dvh} }
@media (pointer:coarse){
  input[type=number],input[type=text],input[type=password],select{font-size:16px}
  input[type=number]{width:86px}
  /* กันไฮไลต์ข้อความ/เมนูค้างไว้ตอนลากนิ้วบนปุ่มและบนกริด */
  button,.seg,.valwrap,#labels,#zwheel,canvas{
    -webkit-user-select:none; user-select:none; -webkit-touch-callout:none}
  button{-webkit-tap-highlight-color:transparent}
}

/* แถบแจ้งว่ามีรุ่นใหม่ — ขึ้นเมื่อ Service Worker โหลดรุ่นใหม่เสร็จเท่านั้น */
#swbar{position:fixed; left:0; right:0; top:0; z-index:9998;
  padding:calc(9px + var(--sat)) calc(12px + var(--sar)) 9px calc(12px + var(--sal));
  background:var(--panel2); border-bottom:1px solid var(--ok); color:var(--ink);
  font-size:13px; display:flex; gap:10px; align-items:center; justify-content:center;
  flex-wrap:wrap; box-shadow:0 6px 20px rgba(0,0,0,.45)}
#swbar button{background:var(--ok); color:#10201F; border:0; font-weight:600;
  padding:6px 14px; border-radius:7px; font-size:13px}
#swbar .x{background:transparent; color:var(--dim); font-weight:400; padding:6px 8px}'''

SW_BLOCK = u'''<script>
/* ==================== ชั้นเว็บแอป: Service Worker ====================
   ทำให้เปิดใช้ได้ตอนไม่มีเน็ต และติดตั้งลงหน้าโฮมได้

   ตั้งใจ "ไม่" รีโหลดเองเมื่อมีรุ่นใหม่ เพราะงานที่ยังไม่ได้บันทึกบนกริด
   จะหายไปกลางคัน จึงขึ้นแถบให้กดเองแทน

   สร้างโดย tools/apply-webapp-layer.py — อย่าแก้ตรงนี้ด้วยมือ
   ==================================================================== */
(function(){
"use strict";
if(location.protocol !== "http:" && location.protocol !== "https:") return;  // เปิดจาก file:// ก็ยังใช้ได้ แค่ไม่มีโหมดออฟไลน์
if(!("serviceWorker" in navigator)) return;

function showBar(waiting){
  if(document.getElementById("swbar")) return;
  var bar = document.createElement("div");
  bar.id = "swbar";
  bar.innerHTML = '<span>มีรุ่นใหม่พร้อมแล้ว</span>' +
                  '<button type="button" id="swgo">อัปเดตเดี๋ยวนี้</button>' +
                  '<button type="button" class="x" id="swno">ไว้ก่อน</button>';
  document.body.appendChild(bar);
  document.getElementById("swno").onclick = function(){ bar.remove(); };
  document.getElementById("swgo").onclick = function(){
    bar.remove();
    navigator.serviceWorker.addEventListener("controllerchange", function once(){
      navigator.serviceWorker.removeEventListener("controllerchange", once);
      location.reload();
    });
    waiting.postMessage({type:"SKIP_WAITING"});
  };
}

addEventListener("load", function(){
  navigator.serviceWorker.register("./sw.js", {scope:"./"}).then(function(reg){
    if(reg.waiting && navigator.serviceWorker.controller) showBar(reg.waiting);
    reg.addEventListener("updatefound", function(){
      var sw = reg.installing;
      if(!sw) return;
      sw.addEventListener("statechange", function(){
        // มี controller อยู่แล้ว = ครั้งนี้เป็นการอัปเดต ไม่ใช่การติดตั้งครั้งแรก
        if(sw.state === "installed" && navigator.serviceWorker.controller) showBar(sw);
      });
    });
    // เช็ครุ่นใหม่ทุกครั้งที่กลับมาที่หน้านี้ เผื่อเปิดค้างไว้เป็นวัน ๆ
    document.addEventListener("visibilitychange", function(){
      if(!document.hidden) reg.update().catch(function(){});
    });
  }).catch(function(){ /* ไม่มีโหมดออฟไลน์ก็ใช้งานได้ตามปกติ */ });
});
})();
</script>
</body>'''

MARKER = "ชั้นเว็บแอป"


def die(msg):
    sys.stderr.write(u"\n❌  %s\n\n" % msg)
    sys.exit(1)


def patch(src):
    steps = []

    # --- 1) viewport: ต้องมี viewport-fit=cover ไม่งั้น env(safe-area-*) เป็นศูนย์หมด ---
    m = re.search(r'<meta\s+name=["\']viewport["\'][^>]*>', src, re.I)
    if not m:
        die(u"หา <meta name=viewport> ไม่เจอ — ไฟล์ต้นฉบับเปลี่ยนโครงไปแล้ว")
    tag = m.group(0)
    if "viewport-fit" not in tag:
        new = re.sub(r'(content=["\'])([^"\']*)(["\'])',
                     lambda x: x.group(1) + x.group(2).rstrip() + ", viewport-fit=cover" + x.group(3),
                     tag, count=1)
        src = src[:m.start()] + new + src[m.end():]
        steps.append(u"viewport: เติม viewport-fit=cover")
    else:
        steps.append(u"viewport: มี viewport-fit อยู่แล้ว ข้าม")

    # --- 2) ตัดลิงก์ที่วิ่งไป Google Fonts ออกให้หมด ---
    before = src
    src = re.sub(r'^[ \t]*<link\b[^>]*fonts\.(googleapis|gstatic)\.com[^>]*>[ \t]*\r?\n?', '',
                 src, flags=re.I | re.M)
    n = len(re.findall(r'<link\b[^>]*fonts\.(?:googleapis|gstatic)\.com', before, re.I))
    steps.append(u"Google Fonts: ตัดออก %d บรรทัด" % n)

    # --- 3) แทรกบล็อก head ต่อจาก </title> ---
    m = re.search(r'</title\s*>', src, re.I)
    if not m:
        die(u"หา </title> ไม่เจอ — แทรกบล็อก head ไม่ได้")
    src = src[:m.end()] + HEAD_BLOCK + src[m.end():]
    steps.append(u"head: แทรก manifest/CSP/ไอคอน/ฟอนต์ ต่อจาก </title>")

    # --- 4) แทรก CSS ท้ายบล็อก <style> ก้อนสุดท้ายใน <head> ---
    head_end = re.search(r'</head\s*>', src, re.I)
    if not head_end:
        die(u"หา </head> ไม่เจอ")
    styles = list(re.finditer(r'</style\s*>', src[:head_end.start()], re.I))
    if not styles:
        die(u"ไม่เจอ </style> ใน <head> — แทรก CSS ของจอ iPad ไม่ได้")
    at = styles[-1].start()
    src = src[:at] + CSS_BLOCK + "\n" + src[at:]
    steps.append(u"css: แทรก safe-area/กันซูม/แถบอัปเดต ท้าย <style> ก้อนสุดท้าย")

    # --- 5) แทรกสคริปต์ลงทะเบียน Service Worker ก่อน </body> ---
    m = None
    for m in re.finditer(r'</body\s*>', src, re.I):
        pass
    if not m:
        die(u"หา </body> ไม่เจอ — แทรก Service Worker ไม่ได้")
    src = src[:m.start()] + SW_BLOCK + src[m.end():]
    steps.append(u"body: แทรกตัวลงทะเบียน Service Worker ก่อน </body>")

    return src, steps


def audit(src):
    """ตรวจผลลัพธ์ ถ้าไม่ผ่านคือมีอะไรผิด อย่าเพิ่ง commit"""
    problems, notes = [], []

    for what, pat in [
        (u"CSP", r'http-equiv=["\']Content-Security-Policy'),
        (u"manifest", r'rel=["\']manifest'),
        (u"apple-touch-icon", r'rel=["\']apple-touch-icon'),
        (u"ตัวลงทะเบียน Service Worker", r'serviceWorker\.register'),
        (u"safe-area", r'safe-area-inset-bottom'),
        (u"ฟอนต์ในเครื่อง", r'fonts/ibm-plex-sans-thai\.css'),
    ]:
        if not re.search(pat, src, re.I):
            problems.append(u"ผลลัพธ์ไม่มี %s" % what)

    if re.search(r'fonts\.(googleapis|gstatic)\.com', src, re.I):
        problems.append(u"ยังเหลือลิงก์ Google Fonts อยู่")

    # ของที่โหลดจากข้างนอก จะถูก CSP บล็อกเงียบ ๆ ต้องเตือนให้เห็นก่อน
    ext = set()
    for mm in re.finditer(r'(?:src|href)\s*=\s*["\'](https?://[^"\']+)["\']', src, re.I):
        u = mm.group(1)
        if not u.startswith("http://www.musicxml.org/"):   # อันนี้เป็น DTD ในข้อความ ไม่ได้โหลดจริง
            ext.add(u)
    if ext:
        problems.append(u"ไฟล์ใหม่ดึงของจากข้างนอก %d รายการ CSP จะบล็อกทิ้งเงียบ ๆ:\n     "
                        % len(ext) + u"\n     ".join(sorted(ext)) +
                        u"\n     → ต้องย้ายมาเก็บในโปรเจกต์ หรือผ่อน CSP อย่างจงใจ")

    for f in ["manifest.webmanifest", "sw.js", ".nojekyll",
              "fonts/ibm-plex-sans-thai.css", "icons/icon-512.png"]:
        if not os.path.exists(os.path.join(ROOT, f)):
            problems.append(u"ไฟล์ประกอบหาย: %s" % f)

    for w in FONT_WEIGHTS:
        for s in FONT_SUBSETS:
            p = os.path.join(ROOT, "fonts", "ibm-plex-sans-thai-%s-%s.woff2" % (s, w))
            if not os.path.exists(p):
                notes.append(u"ไม่มีไฟล์ฟอนต์ %s" % os.path.basename(p))

    return problems, notes


def main():
    if len(sys.argv) != 2:
        sys.stderr.write(__doc__)
        sys.exit(2)
    srcpath = sys.argv[1]
    if not os.path.isfile(srcpath):
        die(u"ไม่พบไฟล์: %s" % srcpath)

    raw = io.open(srcpath, encoding="utf-8").read()
    if MARKER in raw:
        die(u"ไฟล์นี้ถูกเติมชั้นเว็บแอปไปแล้ว\n"
            u"    ต้องใช้ไฟล์ต้นฉบับที่ยังไม่ถูกเติม (ไฟล์ที่ผู้พัฒนาส่งมาตรง ๆ)")

    out, steps = patch(raw)

    print(u"ขั้นตอนที่ทำ")
    for s in steps:
        print(u"  ✓ " + s)

    problems, notes = audit(out)
    if notes:
        print(u"\nขอเตือนไว้")
        for n in notes:
            print(u"  ! " + n)
    if problems:
        sys.stderr.write(u"\nไม่ผ่านการตรวจ ยังไม่เขียนไฟล์\n")
        for p in problems:
            sys.stderr.write(u"  ✗ " + p + u"\n")
        sys.exit(1)

    dst = os.path.join(ROOT, "index.html")
    io.open(dst, "w", encoding="utf-8").write(out)
    print(u"\n✅ เขียน %s แล้ว (%s → %s ไบต์)"
          % (dst, format(len(raw), ","), format(len(out), ",")))
    print(u"   ต่อไป: ตรวจด้วยตาอีกรอบ แล้ว git add -A && git commit && git push")


if __name__ == "__main__":
    main()
