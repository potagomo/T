#!/usr/bin/env python3
"""สร้างไอคอนแอป "อัดโชว์" (show/icons/) — ปุ่มอัด: วงแหวนอำพันกับจุดแดง บนพื้นสีน้ำตาลเข้มของแอป

    python3 tools/make-show-icons.py

ใช้สีเดียวกับในแอป (--umber #231c16, --amber #ffb300, --red #ff453a) วาดใหญ่ 4 เท่าแล้วย่อ ขอบจึงเนียน
ไอคอนแบบ maskable ย่อลายให้อยู่ในวงกลมปลอดภัย 80% ตรงกลาง (Android ตัดขอบเป็นรูปทรงต่าง ๆ ได้ไม่โดนลาย)
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "show", "icons")
UMBER, AMBER, RED = (35, 28, 22), (255, 179, 0), (255, 69, 58)


def icon(size, scale):
    """scale = สัดส่วนของลายเทียบกับขนาดไอคอน (1 = เต็ม, ใช้น้อยลงสำหรับ maskable)"""
    S = size * 4
    im = Image.new("RGB", (S, S), UMBER)
    d = ImageDraw.Draw(im)
    c = S / 2
    r_ring = S * 0.36 * scale
    w_ring = S * 0.055 * scale
    d.ellipse([c - r_ring, c - r_ring, c + r_ring, c + r_ring], outline=AMBER, width=max(1, round(w_ring)))
    r_dot = S * 0.22 * scale
    d.ellipse([c - r_dot, c - r_dot, c + r_dot, c + r_dot], fill=RED)
    return im.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, size, scale in [("icon-192.png", 192, 1.0), ("icon-512.png", 512, 1.0),
                              ("icon-maskable-512.png", 512, 0.78), ("apple-touch-icon.png", 180, 0.92)]:
        icon(size, scale).save(os.path.join(OUT, name), optimize=True)
    print("✓ show/icons/ " + ", ".join(sorted(os.listdir(OUT))))


if __name__ == "__main__":
    main()
