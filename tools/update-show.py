#!/usr/bin/env python3
"""รับไฟล์ "อัดโชว์" รุ่นใหม่ เข้ามาเป็นเว็บแอปที่ /show/

    python3 tools/update-show.py ~/Downloads/at-show-9.html

ทำอะไรบ้าง (รันซ้ำกี่ครั้งก็ได้ผลเหมือนเดิม)
  1. เก็บไฟล์ดิบไว้ที่ upstream/at-show.html
  2. ทำเป็นแอปติดตั้งได้: ลิงก์ manifest ไอคอน (show/manifest.webmanifest, show/icons/) Service Worker อยู่ที่ show/sw.js
  3. ใช้ของที่เก็บไว้ในแอปแทนการโหลดจากข้างนอก เปิดได้ตอนไม่มีเน็ต และไม่พังเพราะของข้างนอกเปลี่ยน
       ฟอนต์ Chakra Petch → show/fonts/   ·   ตัวอ่านนิ้ว MediaPipe 0.10.14 + โมเดลมือ → show/vendor/mediapipe/
       (ยังถอยไปโหลดจาก jsDelivr รุ่นเดียวกันได้ถ้าของในแอปใช้ไม่ได้ แต่ตัด @latest ออก เพราะรุ่นเปลี่ยนเองได้)
  4. ฝังชั้นเสริมทุกไฟล์ใน tools/show-layer/ ไว้ท้ายไฟล์ (Drive, ตรวจเครื่อง, อัดผ่านตัวช่วย, ติดตั้งแอป)
  5. เขียนผลลัพธ์ลง show/index.html

ตรรกะของโปรแกรม (อัด มาร์กเพลง ตัดคลิป) ไม่ถูกแตะเลย ชั้นเสริมเกาะกับฟังก์ชันที่มีอยู่แล้ว
ถ้ารุ่นใหม่เปลี่ยนชื่อฟังก์ชันเหล่านั้น สคริปต์จะหยุดและบอกว่าขาดอะไร
"""
import io, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "show")
LAYER_RE = r"<!-- layer:[\w.-]+:start -->.*?<!-- layer:[\w.-]+:end -->\n?"


def die(msg):
    sys.exit("✗ " + msg)


def main():
    if len(sys.argv) != 2:
        die("ใช้: python3 tools/update-show.py <ไฟล์ html>")
    src = io.open(sys.argv[1], encoding="utf-8").read()

    # ด่านตรวจ: ต้องเป็นแอปอัดโชว์ และยังมีจุดที่ชั้น Drive เกาะอยู่
    for need in [
        "indexedDB.open('at-show'",
        "function writeChunk(",
        "async function delSession(",
        "async function renderLib(",
        "async function openDetail(",
        "function renderStats(",
        "async function enterCam(",
        "function readSetlist(",
        "function fileName(",
        "function chaptersText(",
        "$('openCam').onclick = enterCam",
    ]:
        if need not in src:
            die("ไม่พบ %s — ไม่ใช่ไฟล์อัดโชว์ หรือรุ่นนี้เปลี่ยนโครง ต้องปรับ tools/show-layer/ ให้ตรง" % need)

    html = re.sub(LAYER_RE, "", src, flags=re.S)
    html = html.replace("ต้องเปิดผ่านลิงก์ https เช่น Netlify ด้วย Chrome", "ต้องเปิดผ่านลิงก์เว็บแอป (https) ด้วย Chrome")

    for f in ["manifest.webmanifest", "sw.js", "icons/icon-512.png", "icons/apple-touch-icon.png", "fonts/chakra-petch.css",
              "vendor/mediapipe/hand_landmarker.task", "vendor/mediapipe/tasks-vision-0.10.14/vision_bundle.mjs",
              "vendor/mediapipe/tasks-vision-0.10.14/wasm/vision_wasm_internal.wasm"]:
        if not os.path.isfile(os.path.join(OUT, f)):
            die("ขาดไฟล์ show/" + f + " (python3 tools/make-show-icons.py สร้างไอคอนใหม่ได้)")

    def swap(old, new, why):
        nonlocal html
        if html.count(old) != 1:
            die("หา " + why + " ไม่เจอ (หรือเจอมากกว่าหนึ่งที่) — รุ่นนี้เปลี่ยนโครง ต้องปรับ tools/update-show.py")
        html = html.replace(old, new)

    # ฟอนต์: ใช้ไฟล์ในแอปแทน Google Fonts
    html = re.sub(r'<link rel="preconnect" href="https://fonts\.googleapis\.com">\n?', "", html)
    swap('<link href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;500;600;700&display=swap" rel="stylesheet">',
         '<link href="fonts/chakra-petch.css" rel="stylesheet">', "ลิงก์ฟอนต์ Chakra Petch")
    # ตัวอ่านนิ้ว: ของในแอปก่อน ถอยไป jsDelivr รุ่นเดียวกัน (ไม่ใช้ @latest)
    swap("const model = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';",
         "const model = new URL('vendor/mediapipe/hand_landmarker.task', location.href).href;", "ที่อยู่โมเดลมือ")
    swap("const bases = ['https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14', 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest'];",
         "const bases = [new URL('vendor/mediapipe/tasks-vision-0.10.14', location.href).href, 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14'];",
         "ที่อยู่ตัวอ่านนิ้ว")
    html = html.replace("กำลังโหลดตัวอ่านนิ้ว ต้องมีเน็ต", "กำลังโหลดตัวอ่านนิ้ว (ครั้งแรกต้องมีเน็ต)")
    html = html.replace("เปิดใช้ครั้งแรกต้องมีเน็ต", "เปิดใช้ครั้งแรกต้องมีเน็ต ครั้งต่อไปใช้ได้แม้ไม่มีเน็ต")
    # ติดตั้งเป็นแอป
    swap("<title>อัดโชว์</title>",
         '<title>อัดโชว์</title>\n<!-- ชั้นเว็บแอป: ติดตั้งลงหน้าโฮม (tools/update-show.py) -->\n'
         '<link rel="manifest" href="manifest.webmanifest">\n'
         '<link rel="icon" type="image/png" sizes="192x192" href="icons/icon-192.png">\n'
         '<link rel="apple-touch-icon" sizes="180x180" href="icons/apple-touch-icon.png">\n'
         '<meta name="mobile-web-app-capable" content="yes">\n'
         '<meta name="apple-mobile-web-app-capable" content="yes">\n'
         '<meta name="apple-mobile-web-app-status-bar-style" content="black">\n'
         '<meta name="apple-mobile-web-app-title" content="อัดโชว์">\n'
         '<meta name="robots" content="noindex">', "<title>")

    if html.count("</body>") != 1:
        die("หา </body> ไม่เจอหรือมีมากกว่าหนึ่ง — ฝังชั้นเสริมไม่ได้")
    layer_dir = os.path.join(ROOT, "tools", "show-layer")
    blocks = ""
    for name in sorted(f for f in os.listdir(layer_dir) if f.endswith(".js")):
        code = io.open(os.path.join(layer_dir, name), encoding="utf-8").read()
        if "</script" in code.lower():
            die(name + " มีคำว่า </script> ซึ่งจะตัดสคริปต์ขาดกลางทาง")
        blocks += "<!-- layer:%s:start -->\n<script>\n%s</script>\n<!-- layer:%s:end -->\n" % (name, code, name)
    html = html.replace("</body>", blocks + "</body>")

    os.makedirs(OUT, exist_ok=True)
    os.makedirs(os.path.join(ROOT, "upstream"), exist_ok=True)
    # เก็บเฉพาะไฟล์ดิบเป็นจุดอ้างอิง ไฟล์ที่ผ่านสคริปต์นี้มาแล้ว (มีชั้นเสริมฝังอยู่) ไม่นับ
    if not re.search(r"<!-- layer:[\w.-]+:start -->", src):
        io.open(os.path.join(ROOT, "upstream", "at-show.html"), "w", encoding="utf-8").write(src)
    io.open(os.path.join(OUT, "index.html"), "w", encoding="utf-8").write(html)
    print("✓ show/index.html (%d KB)" % (len(html.encode()) // 1024))


if __name__ == "__main__":
    main()
