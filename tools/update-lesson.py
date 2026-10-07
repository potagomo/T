#!/usr/bin/env python3
"""รับไฟล์ "ครูต้า — บันทึกการสอนกลอง" รุ่นใหม่ เข้ามาเป็นเว็บแอปที่ /lesson/

    python3 tools/update-lesson.py ~/Downloads/index.html

ทำอะไรบ้าง (รันซ้ำกี่ครั้งก็ได้ผลเหมือนเดิม)
  1. เก็บไฟล์ดิบไว้ที่ upstream/kruta-lesson.html
  2. ดึงไอคอนที่ฝังในไฟล์ออกมาเป็น lesson/icons/*.png
  3. เปลี่ยน manifest ที่สร้างเป็น data: URL ให้เป็นไฟล์จริง lesson/manifest.webmanifest
     (Chrome บน Android/Samsung ติดตั้งเป็นแอปเต็มตัวได้แน่นอนกว่า และ iOS ได้ไอคอนคมชัด)
  4. เขียนผลลัพธ์ลง lesson/index.html

ตรรกะของโปรแกรม (บันทึก ซิงค์ ฯลฯ) ไม่ถูกแตะเลย
"""
import base64, io, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "lesson")


def die(msg):
    sys.exit("✗ " + msg)


def main():
    if len(sys.argv) != 2:
        die("ใช้: python3 tools/update-lesson.py <ไฟล์ html>")
    src = io.open(sys.argv[1], encoding="utf-8").read()

    # ด่านตรวจ: ต้องเป็นแอปครูต้า และยังมีกลไกที่ชั้นเว็บแอปพึ่งอยู่
    for need, why in [
        ("registerSW", "ไม่พบ registerSW() — ไม่ใช่ไฟล์ครูต้า หรือรุ่นนี้ตัดระบบออฟไลน์ออก"),
        ('register("./sw.js")', "รุ่นนี้ไม่ได้ลงทะเบียน ./sw.js แล้ว ต้องปรับ lesson/sw.js ให้ตรง"),
        ('postMessage("skipWaiting")', "ข้อความสั่งอัปเดตเปลี่ยนไป ต้องปรับ lesson/sw.js ให้ตรง"),
    ]:
        if need not in src:
            die(why)

    os.makedirs(os.path.join(OUT, "icons"), exist_ok=True)
    os.makedirs(os.path.join(ROOT, "upstream"), exist_ok=True)

    html = src
    block = re.search(r"<script>\s*/\* The app installs from this one file.*?</script>\n?", html, re.S)
    if block:
        b = block.group(0)
        icons = re.findall(r'src:"data:image/png;base64,([A-Za-z0-9+/=]+)",\s*sizes:"(\d+)x\d+",\s*type:"image/png",\s*purpose:"(\w+)"', b)
        if len(icons) < 2:
            die("อ่านไอคอนจาก manifest ในไฟล์ไม่ได้")
        def field(k, default):
            m = re.search(k + r':"([^"]*)"', b)
            return m.group(1) if m else default
        man_icons = []
        for data, size, purpose in icons:
            name = "icon-%s%s.png" % ("maskable-" if purpose == "maskable" else "", size)
            io.open(os.path.join(OUT, "icons", name), "wb").write(base64.b64decode(data))
            man_icons.append({"src": "./icons/" + name, "sizes": "%sx%s" % (size, size), "type": "image/png", "purpose": purpose})
        manifest = {
            "name": field("name", "ครูต้า — บันทึกการสอน"),
            "short_name": field("short_name", "ครูต้า"),
            "description": "บันทึกการสอนกลอง — ใช้ได้ทั้ง iPad และมือถือ ซิงค์ข้ามเครื่องแบบเรียลไทม์",
            "lang": "th",
            "id": "./",
            "start_url": "./",
            "scope": "./",
            "display": "standalone",
            "orientation": "any",
            "background_color": field("background_color", "#FFFDF5"),
            "theme_color": field("theme_color", "#FFFDF5"),
            "categories": ["education", "music", "productivity"],
            "icons": man_icons,
        }
        io.open(os.path.join(OUT, "manifest.webmanifest"), "w", encoding="utf-8").write(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
        html = html.replace(b, '<!-- ชั้นเว็บแอป: manifest เป็นไฟล์จริง (tools/update-lesson.py) -->\n'
                               '<link rel="manifest" href="manifest.webmanifest">\n')
    elif 'href="manifest.webmanifest"' not in html:
        die("ไม่พบบล็อกสร้าง manifest และไม่มี <link rel=manifest> — โครงไฟล์เปลี่ยน ต้องดูด้วยมือ")

    m = re.search(r'<link rel="apple-touch-icon" sizes="180x180" href="data:image/png;base64,([A-Za-z0-9+/=]+)">', html)
    if m:
        io.open(os.path.join(OUT, "icons", "apple-touch-icon.png"), "wb").write(base64.b64decode(m.group(1)))
        html = html.replace(m.group(0), '<link rel="apple-touch-icon" sizes="180x180" href="icons/apple-touch-icon.png">')

    html = html.replace("ต้องเปิดจากลิงก์ Netlify ไม่ใช่", "ต้องเปิดจากลิงก์เว็บแอป ไม่ใช่")

    if src != html or not os.path.exists(os.path.join(ROOT, "upstream", "kruta-lesson.html")):
        io.open(os.path.join(ROOT, "upstream", "kruta-lesson.html"), "w", encoding="utf-8").write(src)
    io.open(os.path.join(OUT, "index.html"), "w", encoding="utf-8").write(html)
    print("✓ lesson/index.html (%d KB) · ไอคอน %s" % (len(html.encode()) // 1024, ", ".join(sorted(os.listdir(os.path.join(OUT, "icons"))))))


if __name__ == "__main__":
    main()
