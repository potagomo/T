#!/usr/bin/env python3
"""สร้างไอคอนขาวดำของครูต้า (กลอง + ไม้กลอง) สำหรับแถบแจ้งเตือนของ Android

Android ใช้แค่ "ความโปร่งใส" ของไอคอนเล็กบนแถบสถานะ (badge) แล้วระบายสีขาวทับ
ไอคอนแอปปกติเป็นสี่เหลี่ยมทึบ จึงกลายเป็นสี่เหลี่ยมขาวโพน — ไฟล์นี้วาดรูปกลองขาวบนพื้นโปร่งใสแทน

    python3 tools/make-lesson-badge.py

ได้ lesson/icons/badge-96.png (ใช้ใน sw.js) และ lesson/icons/monochrome-512.png (ใน manifest, purpose: monochrome)
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "lesson", "icons")
W = 1024                                    # วาดใหญ่แล้วย่อ ขอบจะเนียน
WHITE, CLEAR = (255, 255, 255, 255), (0, 0, 0, 0)


def drum():
    im = Image.new("RGBA", (W, W), CLEAR)
    d = ImageDraw.Draw(im)
    cx, top, bot, rx, ry = W // 2, 520, 860, 380, 120
    # ตัวกลอง: ทรงกระบอก
    d.rectangle([cx - rx, top, cx + rx, bot], fill=WHITE)
    d.ellipse([cx - rx, bot - ry, cx + rx, bot + ry], fill=WHITE)
    d.ellipse([cx - rx, top - ry, cx + rx, top + ry], fill=WHITE)
    # หน้ากลอง: เจาะโปร่งให้เห็นขอบ
    d.ellipse([cx - rx + 58, top - ry + 44, cx + rx - 58, top + ry - 44], fill=CLEAR)
    # เชือกขึงข้างกลอง: เส้นซิกแซกโปร่ง
    zig, y0, y1, n = [], top + 150, bot - 40, 6
    for i in range(n + 1):
        x = cx - rx + 70 + i * (2 * rx - 140) / n
        zig.append((x, y0 if i % 2 == 0 else y1))
    d.line(zig, fill=CLEAR, width=44, joint="curve")
    # ไม้กลองไขว้กัน หัวไม้กลม
    for (x0, y0, x1, y1) in [(150, 90, cx + 120, top + 10), (W - 150, 90, cx - 120, top + 10)]:
        d.line([(x0, y0), (x1, y1)], fill=WHITE, width=70)
        d.ellipse([x1 - 62, y1 - 62, x1 + 62, y1 + 62], fill=WHITE)
    return im


def main():
    os.makedirs(OUT, exist_ok=True)
    # เว้นขอบ ~8% ตามแนวทางไอคอนแจ้งเตือนของ Android (ไม่ชิดขอบ ไม่โดนตัด)
    art, pad = drum(), int(W * 0.08)
    big = Image.new("RGBA", (W, W), CLEAR)
    big.paste(art.resize((W - 2 * pad, W - 2 * pad), Image.LANCZOS), (pad, pad))
    for size, name in [(96, "badge-96.png"), (512, "monochrome-512.png")]:
        big.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, name), optimize=True)
        print("✓ lesson/icons/" + name)


if __name__ == "__main__":
    main()
