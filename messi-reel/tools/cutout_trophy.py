"""ตัดพื้นภาพถ้วยฟุตบอลโลกจริง → input/trophy/fifa_trophy.png (RGBA ครอปชิดตัวถ้วย)

  python3 tools/cutout_trophy.py <ภาพต้นฉบับ> [--model isnet-general-use|u2net] [--credit "..."] [--source <ลิงก์>]

ขั้นตอน: rembg ตัดพื้น → เกลาขอบ (หด alpha 1 px + ลบขอบสีพื้นที่ติดมา) → ครอปชิด → พรีวิวบนพื้นดำ/ขาว (out/trophy_check.jpg)
ต้องดูพรีวิวด้วยตาทุกครั้ง: ขอบไม่แหว่ง ไม่มีพื้นหลังติดมา ลูกโลกและแถบหินสีเขียวที่ฐานครบ
"""
import argparse
import os

import cv2
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DST = os.path.join(ROOT, "input", "trophy", "fifa_trophy.png")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("--model", default="isnet-general-use")
    ap.add_argument("--credit", default="")
    ap.add_argument("--source", default="")
    ap.add_argument("--out", default=DST)
    a = ap.parse_args()
    from rembg import new_session, remove

    im = Image.open(a.src).convert("RGB")
    cut = remove(im, session=new_session(a.model), post_process_mask=True)
    rgba = np.asarray(cut).astype(np.float32)
    alpha = rgba[..., 3] / 255.0
    # เกลาขอบ: หด alpha เล็กน้อยกันพื้นหลังติดขอบ แล้วนุ่มขอบ 1 px
    hard = (alpha > 0.5).astype(np.uint8)
    hard = cv2.morphologyEx(hard, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(hard)  # เก็บเฉพาะชิ้นใหญ่สุด (ตัวถ้วย)
    if n > 1:
        keep = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        hard = (lab == keep).astype(np.uint8)
    alpha = np.minimum(alpha, cv2.erode(hard, np.ones((3, 3), np.uint8)).astype(np.float32) + 0.0)
    alpha = cv2.GaussianBlur(alpha, (0, 0), 0.8) * hard
    # ลบสีพื้นที่ติดขอบ: ขอบโปร่งครึ่ง ๆ ใช้สีของพิกเซลทึบที่ใกล้ที่สุดแทน
    rgb = np.asarray(im).astype(np.float32)
    solid = (alpha > 0.95).astype(np.uint8)
    if solid.any():
        _, idx = cv2.distanceTransformWithLabels(1 - solid, cv2.DIST_L2, 3, labelType=cv2.DIST_LABEL_PIXEL)
        ys, xs = np.nonzero(solid)
        lut = np.zeros((idx.max() + 1, 3), np.float32)
        lut[idx[ys, xs]] = rgb[ys, xs]
        near = lut[idx]
        edge = (alpha > 0.01) & (alpha < 0.95)
        rgb[edge] = near[edge]
    ys, xs = np.nonzero(alpha > 0.02)
    pad = 6
    y0, y1 = max(0, ys.min() - pad), min(alpha.shape[0], ys.max() + pad + 1)
    x0, x1 = max(0, xs.min() - pad), min(alpha.shape[1], xs.max() + pad + 1)
    out = np.dstack([rgb, alpha[..., None] * 255])[y0:y1, x0:x1]
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGBA").save(a.out)
    print(a.out, out.shape[1], "x", out.shape[0])

    # พรีวิวบนพื้นดำ / เทาอุ่น / ขาว
    o = out.astype(np.float32) / 255
    h = 900
    w = round(o.shape[1] * h / o.shape[0])
    o = cv2.resize(o, (w, h), interpolation=cv2.INTER_AREA)
    tiles = []
    for bg in ((0.02, 0.02, 0.03), (0.35, 0.25, 0.12), (0.95, 0.95, 0.95)):
        t = o[..., :3] * o[..., 3:4] + np.float32(bg) * (1 - o[..., 3:4])
        tiles.append(t)
    sheet = (np.hstack(tiles) * 255).astype(np.uint8)
    chk = os.path.join(ROOT, "out", "trophy_check.jpg")
    Image.fromarray(sheet).save(chk, quality=90)
    print(chk)
    if a.credit:
        with open(os.path.join(os.path.dirname(a.out), "credits.md"), "w", encoding="utf-8") as f:
            f.write(f"# ถ้วยฟุตบอลโลกจริง\n\n- fifa_trophy.png — {a.credit}" + (f" · {a.source}" if a.source else "") + "\n")


if __name__ == "__main__":
    main()
