#!/usr/bin/env python3
"""รับไฟล์ "อัดโชว์" รุ่นใหม่ เข้ามาเป็นเว็บแอปที่ /show/

    python3 tools/update-show.py ~/Downloads/at-show-9.html

ทำอะไรบ้าง (รันซ้ำกี่ครั้งก็ได้ผลเหมือนเดิม)
  1. เก็บไฟล์ดิบไว้ที่ upstream/at-show.html
  2. ฝังชั้นเสริมทุกไฟล์ใน tools/show-layer/ ไว้ท้ายไฟล์ (เก็บขึ้น Google Drive แบบเรียลไทม์)
  3. เขียนผลลัพธ์ลง show/index.html

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
