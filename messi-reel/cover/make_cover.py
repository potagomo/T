"""ภาพปก Reel ตามปรัชญา Zenith Cartography (cover/PHILOSOPHY.md)

  python3 cover/make_cover.py → out/cover_1080x1920.png + out/cover_2160x3840.png

ประติมากรรมอยู่ล่าง แกนบาง ๆ ไต่ขึ้นไปหาจุดที่นิ้วชี้ไป บนแกนบันทึกว่าแต่ละบอลโลกเข้าใกล้จุดนั้นแค่ไหน
2006 QF · 2010 QF · 2014 FINAL (ลอยหนี) · 2018 R16 · 2022 ★ ตรงจุดสูงสุด · 2026 FINAL (สลายเป็นละอองทอง)
ภาพปกมีภาพประติมากรรมของผู้ใช้ จึงเก็บใน out/ (ไม่ขึ้น git)
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from render.hero import build_source  # noqa: E402

FD = "/root/.claude/skills/synced/e30bc9b1-bb41-40a3-83a0-ce117c2954e4_46474f54-df21-414b-aceb-30d11664f8a4/canvas-design/canvas-fonts"
LOCAL = os.path.join(ROOT, "assets", "fonts")


def font(name, px):
    for d in (FD, LOCAL):
        p = os.path.join(d, name)
        if os.path.exists(p):
            return ImageFont.truetype(p, int(px))
    raise SystemExit(f"ไม่พบฟอนต์ {name}")


S = 2                      # วาดที่ 2 เท่าแล้วย่อ เส้นบางจะคม
W, H = 1080 * S, 1920 * S
NAVY = (5, 8, 15)
LIFT = (12, 21, 40)
ICE = (150, 190, 228)       # เส้นเครื่องมือ (ใช้ที่ความทึบต่ำ)
GOLD = (242, 193, 78)
WHITE = (238, 242, 248)


def main():
    src = build_source(os.path.join(ROOT, "input", "hero.jpg"), os.path.join(ROOT, "input", "hero_rig.json"))
    rig = json.load(open(os.path.join(ROOT, "input", "hero_rig.json"), encoding="utf-8"))
    rgb, alpha = src["rgb"], src["alpha"]
    ys, xs = np.nonzero(alpha > 0.05)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1

    # ---- พื้น: ดำอมกรมท่า ยกแสงเย็นจาง ๆ ตรงกลาง
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    r = np.sqrt(((xx - W * 0.5) / (W * 0.75)) ** 2 + ((yy - H * 0.52) / (H * 0.55)) ** 2)
    k = np.clip(1 - r, 0, 1) ** 1.8
    base = np.float32(NAVY) + (np.float32(LIFT) - np.float32(NAVY)) * k[..., None]
    canvas = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8)).convert("RGBA")

    # ---- ประติมากรรม: ย่อจากต้นฉบับ (ย่อ = คม) วางชิดล่างในเขต 3:4 ของกริด IG (y 240–1680)
    obj_h = int(0.405 * H)
    sc = obj_h / (y1 - y0)
    obj_w = int((x1 - x0) * sc)
    cx = W // 2
    bottom = int(1636 * S)
    left, top = cx - obj_w // 2, bottom - obj_h
    rgba = np.dstack([rgb[y0:y1, x0:x1], alpha[y0:y1, x0:x1] * 255]).astype(np.uint8)
    obj = Image.fromarray(rgba, "RGBA").resize((obj_w, obj_h), Image.LANCZOS)
    # รัศมีเย็นจาง ๆ ด้านหลังวัตถุ (แยกวัตถุออกจากความมืด)
    halo = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    a = obj.getchannel("A").filter(ImageFilter.GaussianBlur(28 * S))
    halo_l = Image.new("RGBA", obj.size, ICE + (0,))
    halo_l.putalpha(a.point(lambda v: int(v * 0.10)))
    halo.alpha_composite(halo_l, (left, top))
    canvas.alpha_composite(halo)
    canvas.alpha_composite(obj, (left, top))

    def P(pt):  # จุดใน rig → พิกัดผืนภาพ
        s_rig = rgb.shape[1] / rig["ref_size"][0]
        return left + (pt[0] * s_rig - x0) * sc, top + (pt[1] * s_rig - y0) * sc

    tl, tr = P(rig["arm_l"]["tip"]), P(rig["arm_r"]["tip"])
    head = P(rig["head"]["poly"][6])
    ax = (tl[0] + tr[0]) / 2                 # แกนอยู่กึ่งกลางระหว่างนิ้วชี้ทั้งสอง
    zen = 560 * S                            # จุดสูงสุด (ที่นิ้วชี้ไป) ใต้แถบชื่อเรื่อง
    foot = head[1] - 34 * S                  # ปลายล่างของแกน เหนือหัวเล็กน้อย
    span = foot - zen

    def ylev(f):  # 0 = จุดสูงสุด · 1 = ปลายล่างแกน
        return zen + f * span

    ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    hair = max(1, S)  # 1 px ที่ขนาดจริง

    # ---- แกนและไม้บรรทัด
    d.line([(ax, zen + 26 * S), (ax, foot)], fill=ICE + (110,), width=hair)
    levels = {"FINAL": 0.13, "SF": 0.30, "QF": 0.50, "R16": 0.72, "R32": 0.88}
    f_lab = font("GeistMono-Regular.ttf", 15 * S)
    minor = np.linspace(0.06, 0.96, 31)
    for f in minor:
        d.line([(ax - 5 * S, ylev(f)), (ax + 5 * S, ylev(f))], fill=ICE + (46,), width=hair)
    for name, f in levels.items():
        y = ylev(f)
        d.line([(ax - 13 * S, y), (ax + 13 * S, y)], fill=ICE + (120,), width=hair)
        tw = d.textlength(name, font=f_lab)
        d.text((ax - 26 * S - tw, y - 10 * S), name, font=f_lab, fill=ICE + (150,))

    # ---- ผลบอลโลกแต่ละครั้ง (ข้อเท็จจริงใน FACTS.md)
    f_yr = font("GeistMono-Regular.ttf", 14 * S)
    # ทุกครั้งอยู่ฝั่งขวาของแกน เรียงซ้ายไปขวาตามปีในระดับเดียวกัน · 2014 อยู่ขั้นเดียวใต้ดาว (ไม่ต้องวาดอะไรเพิ่ม)
    marks = [("2006", "QF", 0), ("2010", "QF", 1), ("2014", "FINAL", 0), ("2018", "R16", 0), ("2026", "FINAL", 1)]
    col_x = [ax + 42 * S, ax + 138 * S]
    rr = 5 * S
    for yr, lev, col in marks:
        y, x = ylev(levels[lev]), col_x[col]
        al = 130 if yr == "2018" else 220
        d.ellipse([x - rr, y - rr, x + rr, y + rr], outline=WHITE + (al,), width=hair, fill=NAVY + (255,))
        d.text((x + 13 * S, y - 10 * S), yr, font=f_yr, fill=WHITE + (190,))

    # 2026: ละอองทองลอยขึ้นจากเครื่องหมาย FINAL ฝั่งขวา ไปจนพ้นขอบบน
    rng = np.random.default_rng(2026)
    y26, x26 = ylev(levels["FINAL"]), ax + 138 * S
    for i in range(70):
        t = rng.random() ** 0.8
        px = x26 + 10 * S + t * rng.normal(140, 60) * S
        py = y26 - 8 * S - t * (y26 - 470 * S)  # ลอยขึ้นแล้วจางหายก่อนถึงแถบชื่อเรื่อง
        rad = (2.2 - 1.6 * t) * S * rng.uniform(0.6, 1.2)
        al = int(210 * (1 - t) ** 1.2 * rng.uniform(0.4, 1))
        if py > 0 and al > 6:
            d.ellipse([px - rad, py - rad, px + rad, py + rad], fill=GOLD + (al,))

    # ---- จุดสูงสุด: ดาวทองดวงเดียว (2022)
    def star(cx_, cy_, ro, ri):
        pts = []
        for i in range(10):
            rad = ro if i % 2 == 0 else ri
            ang = -math.pi / 2 + i * math.pi / 5
            pts.append((cx_ + rad * math.cos(ang), cy_ + rad * math.sin(ang)))
        return pts
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(glow).polygon(star(ax, zen, 46 * S, 19 * S), fill=GOLD + (150,))
    glow = glow.filter(ImageFilter.GaussianBlur(22 * S))
    ov.alpha_composite(glow)
    d = ImageDraw.Draw(ov)
    d.polygon(star(ax, zen, 21 * S, 8.6 * S), fill=GOLD + (255,))
    t22 = "2022"
    d.text((ax + 74 * S, zen - 10 * S), t22, font=f_yr, fill=GOLD + (230,))  # อยู่นอกวงแหวน
    # วงแหวนเล็งเป้า: เส้นบางรอบจุดสูงสุด
    for rad, al in ((40 * S, 70), (64 * S, 36)):
        d.ellipse([ax - rad, zen - rad, ax + rad, zen + rad], outline=ICE + (al,), width=hair)

    # ---- ตัวหนังสือ: ป้ายอ้างอิงบาง ๆ + ประโยคเดียวด้วยเซอริฟเอียง
    m = 76 * S
    f_k = font("Jura-Light.ttf", 25 * S)
    kick = "M E S S I     2 0 0 6  —  2 0 2 6"
    d.text((m, 270 * S), kick, font=f_k, fill=WHITE + (205,))
    f_t = font("InstrumentSerif-Italic.ttf", 72 * S)
    d.text((m - 3 * S, 306 * S), "The last dance", font=f_t, fill=WHITE + (245,))
    d.text((m - 3 * S, 378 * S), "of a generation.", font=f_t, fill=WHITE + (245,))
    # กันชน: ขอบล่างของชื่อเรื่องต้องอยู่เหนือวงแหวนรอบดาว
    title_right = m + d.textlength("of a generation.", font=f_t)
    title_bottom = 378 * S + f_t.getbbox("of a generation.")[3]
    assert title_bottom < zen - 64 * S - 12 * S, ("ชื่อเรื่องชนวงแหวน", title_bottom / S, zen / S)

    # หมายเลขแผ่นแบบแอตลาส (มุมล่างขวา ภายในขอบ)
    f_p = font("GeistMono-Regular.ttf", 13 * S)
    plate = "PL. 10  ·  ZENITH"
    tw = d.textlength(plate, font=f_p)
    d.text((W - m - tw, 1868 * S - 13 * S), plate, font=f_p, fill=ICE + (120,))
    d.text((m, 1868 * S - 13 * S), "6 · 1 · 21", font=f_p, fill=ICE + (120,))

    canvas.alpha_composite(ov)
    out = os.path.join(ROOT, "out")
    os.makedirs(out, exist_ok=True)
    big = canvas.convert("RGB")
    big.save(os.path.join(out, "cover_2160x3840.png"), optimize=True)
    big.resize((1080, 1920), Image.LANCZOS).save(os.path.join(out, "cover_1080x1920.png"), optimize=True)
    print(os.path.join(out, "cover_1080x1920.png"), "axis x =", round(ax / S), "title right =", round(title_right / S))


if __name__ == "__main__":
    main()
