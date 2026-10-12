"""แยกภาพ Lego Messi (input/hero.jpg) ออกเป็นชิ้น ๆ ให้ขยับได้แบบหุ่นเชิด

ชิ้นที่ได้ (ตาม input/hero_rig.json)
  rays   ลำแสงฟ้า-เขียวด้านหลัง (ช่องที่ตัวบังอยู่ถูกเติมด้วยการลากสีตามแนวรัศมี)
  arm_l  แขนซ้าย (มือชี้ฟ้า) หมุนรอบข้อศอก
  arm_r  แขนขวา (แขนสัก) หมุนรอบข้อศอก
  body   เสื้อหลัง MESSI 10 + ปลอกแขนกัปตัน — มีอีกรุ่นที่เลขเป็น 19 (ปี 2006)
  head   หัว หมุนรอบคอเล็กน้อย
  full   ภาพทั้งก้อนตามต้นฉบับ (ใช้ทำเอฟเฟกต์ต่อตัวต่อ)

ขั้นตอนหนัก (ตัดพื้นหลัง เกลาขอบด้วย GrabCut เติมช่องลำแสง) ทำครั้งเดียวที่ความละเอียดต้นฉบับ
แล้วเก็บไว้ใน .cache/ — เปลี่ยนภาพหรือ rig เมื่อไรจะคำนวณใหม่เอง
"""
import hashlib
import json
import os

import cv2
import numpy as np
from PIL import Image, ImageOps

from .timeline import ROOT

CACHE = os.path.join(ROOT, ".cache")
FONTS = os.path.join(ROOT, "assets", "fonts")
PARTS = ("head", "body", "arm_l", "arm_r")


def _poly_mask(shape, pts, scale):
    m = np.zeros(shape, np.uint8)
    p = np.round(np.float32(pts) * scale).astype(np.int32)
    cv2.fillPoly(m, [p], 255, lineType=cv2.LINE_AA)
    return m


def _sculpture_alpha(rgb):
    """พื้นหลังดำที่ต่อเนื่องถึงขอบภาพ = โปร่งใส (ตัวหนังสือดำบนเสื้ออยู่ข้างในจึงไม่หาย)"""
    dark = (rgb.max(-1) < 30).astype(np.uint8)
    dark = cv2.morphologyEx(dark, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, lab = cv2.connectedComponents(dark, connectivity=4)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(border)).astype(np.float32)
    # จุดมืดเล็ก ๆ ที่ไม่ต่อขอบแต่อยู่นอกตัว (เศษ JPEG) ปล่อยไว้ได้ — เล็กมาก
    bg = cv2.GaussianBlur(bg, (0, 0), 1.0)
    return np.clip(1 - bg, 0, 1)


def _grabcut(rgb, alpha, poly_m, band=12):
    m = np.full(alpha.shape, cv2.GC_BGD, np.uint8)
    k = np.ones((3, 3), np.uint8)
    outer = cv2.dilate(poly_m, k, iterations=band)
    inner = cv2.erode(poly_m, k, iterations=band)
    m[outer > 127] = cv2.GC_PR_BGD
    m[poly_m > 127] = cv2.GC_PR_FGD
    m[inner > 127] = cv2.GC_FGD
    m[alpha < 0.3] = cv2.GC_BGD
    bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    ys, xs = np.nonzero(outer)
    y0, y1, x0, x1 = max(0, ys.min() - 4), ys.max() + 5, max(0, xs.min() - 4), xs.max() + 5
    sub = m[y0:y1, x0:x1].copy()
    cv2.grabCut(np.ascontiguousarray(rgb[y0:y1, x0:x1, ::-1]), sub, None, bgd, fgd, 4, cv2.GC_INIT_WITH_MASK)
    m[y0:y1, x0:x1] = sub
    fg = ((m == cv2.GC_FGD) | (m == cv2.GC_PR_FGD)).astype(np.uint8)
    # เอาเฉพาะก้อนใหญ่สุด กันเศษหลุด
    n, lab, stats, _ = cv2.connectedComponentsWithStats(fg, connectivity=8)
    if n > 1:
        big = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        fg = (lab == big).astype(np.uint8)
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    return cv2.GaussianBlur(fg.astype(np.float32), (0, 0), 0.9)


def _radial_fill(rgb, alpha, hole, center):
    """เติมช่องที่ตัว/แขนบังลำแสง โดยลากสีจากลำแสงที่อยู่ไกลออกไปตามแนวรัศมี"""
    ys, xs = np.nonzero(hole)
    cx, cy = center
    dx, dy = xs - cx, ys - cy
    r = np.hypot(dx, dy) + 1e-3
    ux, uy = dx / r, dy / r
    out_rgb = rgb.astype(np.float32).copy()
    out_a = alpha.copy()
    res_rgb = np.zeros((len(xs), 3), np.float32)
    res_a = np.zeros(len(xs), np.float32)
    done = np.zeros(len(xs), bool)
    h, w = hole.shape
    for step in range(1, 400):
        rr = r + step * 3.0
        sx = np.round(cx + ux * rr).astype(np.int64)
        sy = np.round(cy + uy * rr).astype(np.int64)
        inb = (sx >= 0) & (sx < w) & (sy >= 0) & (sy < h)
        out = ~inb & ~done
        done |= out  # หลุดขอบภาพ = โปร่งใส
        sxc, syc = np.clip(sx, 0, w - 1), np.clip(sy, 0, h - 1)
        ok = ~done & inb & ~hole[syc, sxc]
        res_rgb[ok] = rgb[syc[ok], sxc[ok]]
        res_a[ok] = alpha[syc[ok], sxc[ok]]
        done |= ok
        if done.all():
            break
    out_rgb[ys, xs] = res_rgb
    out_a[ys, xs] = res_a
    return out_rgb, out_a


def _number19(rgb, nb, s):
    """ทำเลข 0 บนหลังเสื้อให้เป็นเลข 9: ปิดรูกลางด้วยคาน + เจาะผนังซ้ายล่าง"""
    out = rgb.copy()

    def patch(box, dy):
        x0, y0, x1, y1 = (int(round(v * s)) for v in box)
        d = int(round(dy * s))
        src = rgb[y0 + d:y1 + d, x0:x1]
        m = np.zeros((y1 - y0, x1 - x0), np.float32)
        f = max(1, int(2 * s))
        m[f:-f, f:-f] = 1
        m = cv2.GaussianBlur(m, (0, 0), f)[..., None]
        out[y0:y1, x0:x1] = out[y0:y1, x0:x1] * (1 - m) + src * m

    patch(nb["crossbar"], nb["crossbar_src_dy"])
    patch(nb["gap"], nb["gap_src_dy"])
    return out


def _key(*paths):
    h = hashlib.sha1(b"v5")
    for p in paths:
        with open(p, "rb") as f:
            h.update(f.read())
    return h.hexdigest()[:12]


def build_source(img_path, rig_path):
    """คำนวณชิ้นส่วนทั้งหมดที่ความละเอียดต้นฉบับ (cache ไว้)"""
    os.makedirs(CACHE, exist_ok=True)
    key = _key(img_path, rig_path)
    cp = os.path.join(CACHE, f"puppet_{key}.npz")
    if os.path.exists(cp):
        z = np.load(cp)
        return {k: z[k] for k in z.files}
    rgb = np.asarray(ImageOps.exif_transpose(Image.open(img_path)).convert("RGB")).astype(np.float32)
    rig = json.load(open(rig_path, encoding="utf-8"))
    h, w = rgb.shape[:2]
    s = w / rig["ref_size"][0]
    alpha = _sculpture_alpha(rgb)
    u8 = rgb.astype(np.uint8)

    fig_poly = np.maximum(_poly_mask(alpha.shape, rig["body"]["poly"], s), _poly_mask(alpha.shape, rig["head"]["poly"], s))
    fig = _grabcut(u8, alpha, fig_poly) * alpha
    arm_l = _grabcut(u8, alpha, _poly_mask(alpha.shape, rig["arm_l"]["poly"], s)) * alpha
    arm_r = _grabcut(u8, alpha, _poly_mask(alpha.shape, rig["arm_r"]["poly"], s)) * alpha

    head_poly = cv2.dilate(_poly_mask(alpha.shape, rig["head"]["poly"], s), np.ones((3, 3), np.uint8), iterations=int(8 * s))
    head_soft = cv2.GaussianBlur(head_poly.astype(np.float32) / 255, (0, 0), 1.5 * s)
    head = fig * head_soft
    # ตัวเสื้อไม่มีหัว ยกเว้นแถบคอเล็ก ๆ ให้ซ้อนกันตอนหัวเอียง (ไม่ให้เห็นรอยต่อ)
    neck_y = rig["head"]["pivot"][1] * s
    yy = np.arange(alpha.shape[0], dtype=np.float32)[:, None]
    neck = np.clip((yy - (neck_y - 30 * s)) / (12 * s), 0, 1)
    body = fig * (1 - head_soft * (1 - neck))

    hole = (np.maximum.reduce([fig, arm_l, arm_r]) > 0.05).astype(np.uint8)
    hole = cv2.dilate(hole, np.ones((3, 3), np.uint8), iterations=max(2, int(3 * s))) > 0
    c = np.float32(rig["ray_center"]) * s
    rays_rgb, rays_a = _radial_fill(rgb, alpha, hole, c)
    rays_a = cv2.GaussianBlur(rays_a, (0, 0), 0.8) * np.where(hole, 1.0, 1.0)
    # ลำแสงต้องไม่ทับส่วนตัว: ข้างนอกช่องใช้ alpha เดิม ลบส่วนที่เป็นตัว/แขนออก
    rays_a = np.where(hole, rays_a, alpha * (1 - np.maximum.reduce([fig, arm_l, arm_r])))

    body19 = _number19(rgb, rig["number"], s)
    out = dict(rgb=rgb, alpha=alpha, rays_rgb=rays_rgb, rays_a=rays_a.astype(np.float32),
               head=head.astype(np.float32), body=body.astype(np.float32),
               arm_l=arm_l.astype(np.float32), arm_r=arm_r.astype(np.float32), body19=body19.astype(np.float32))
    np.savez_compressed(cp, **out)
    return out


class Puppet:
    """ชิ้นส่วนที่ย่อ/ขยายมาเท่ากับความละเอียดที่จะ render

    layers[name] = dict(rgba=premultiplied float32, aux=[rimL, rimR, halo, 0], pivot=(x, y) ในพิกัด sprite)
    """

    def __init__(self, cfg, frame_h, max_h_frac=0.80):
        img_p = os.path.join(ROOT, cfg.get("image", "input/hero.jpg"))
        rig_p = os.path.join(ROOT, cfg.get("rig", "input/hero_rig.json"))
        if not os.path.exists(img_p):
            raise SystemExit(f"ไม่พบภาพ {img_p}")
        src = build_source(img_p, rig_p)
        rig = json.load(open(rig_p, encoding="utf-8"))
        a = src["alpha"]
        ys, xs = np.nonzero(a > 0.05)
        pad = 24
        y0, y1 = max(0, ys.min() - pad), min(a.shape[0], ys.max() + pad)
        x0, x1 = max(0, xs.min() - pad), min(a.shape[1], xs.max() + pad)
        self.src_h = ys.max() - ys.min()  # ความสูงของประติมากรรมจริง (ไม่รวมขอบ)
        target = frame_h * max_h_frac
        f = min(target / self.src_h, 3.2)
        self.f = f
        s_rig = a.shape[1] / rig["ref_size"][0]
        W, H = int(round((x1 - x0) * f)), int(round((y1 - y0) * f))
        self.w, self.h = W, H
        self.body_h = self.src_h * f
        bb_cy = ((ys.min() + ys.max()) / 2 - y0) * f
        bb_cx = ((xs.min() + xs.max()) / 2 - x0) * f
        self.center = (bb_cx, bb_cy)

        def P(pt):  # rig → sprite
            return ((pt[0] * s_rig - x0) * f, (pt[1] * s_rig - y0) * f)

        def up(x, interp=cv2.INTER_CUBIC):
            return cv2.resize(x[y0:y1, x0:x1], (W, H), interpolation=interp)

        rgb = up(src["rgb"]) / 255.0
        rgb19 = up(src["body19"]) / 255.0
        rays_rgb = up(src["rays_rgb"]) / 255.0
        if f > 1.05:  # ขยายแล้วเกลาให้คม (ขอบตัวต่อเลโก้เป็นเส้นตรง คมได้)
            sig = 0.55 * f
            for arr in (rgb, rgb19, rays_rgb):
                arr += 0.55 * (arr - cv2.GaussianBlur(arr, (0, 0), sig))
        np.clip(rgb, 0, 1, out=rgb)
        np.clip(rgb19, 0, 1, out=rgb19)
        np.clip(rays_rgb, 0, 1, out=rays_rgb)

        def mk(rgb_, a_):
            a_ = np.clip(a_, 0, 1).astype(np.float32)
            return np.dstack([rgb_ * a_[..., None], a_]).astype(np.float32)

        lin = cv2.INTER_LINEAR
        al = {k: up(src[k], lin) for k in ("alpha", "rays_a") + PARTS}
        self.layers = {}
        self.layers["rays"] = dict(rgba=mk(rays_rgb, al["rays_a"]), pivot=P(rig["ray_center"]))
        self.layers["arm_l"] = dict(rgba=mk(rgb, al["arm_l"]), pivot=P(rig["arm_l"]["pivot"]))
        self.layers["arm_r"] = dict(rgba=mk(rgb, al["arm_r"]), pivot=P(rig["arm_r"]["pivot"]))
        self.layers["body"] = dict(rgba=mk(rgb, al["body"]), pivot=P(rig["body"]["pivot"]))
        self.layers["head"] = dict(rgba=mk(rgb, al["head"]), pivot=P(rig["head"]["pivot"]))
        self.body19 = mk(rgb19, al["body"])
        self.full = mk(rgb, al["alpha"])
        self.tips = {k: P(rig[k]["tip"]) for k in ("arm_l", "arm_r")}
        self.armband = P(rig["armband"])
        self.ray_center = P(rig["ray_center"])
        nb = rig["number"]["zero_box"]
        p0, p1 = P(nb[:2]), P(nb[2:])
        self.number_box = (int(p0[0]), int(p0[1]), int(p1[0]), int(p1[1]))
        self.head_top = P((rig["head"]["poly"][6][0], rig["head"]["poly"][6][1]))

        # ไฟขอบ (rim) + รัศมีแสง ต่อชิ้น แล้วเก็บเป็น uint8 ตัดเฉพาะกรอบของชิ้นนั้น (ประหยัดแรม/เร็วขึ้นตอน warp)
        d = max(2, int(0.010 * self.body_h))
        sig = max(1.0, 0.003 * self.body_h)

        def aux_of(A, halo_on):
            def shifted(dx, dy):
                M = np.float32([[1, 0, dx], [0, 1, dy]])
                return cv2.warpAffine(A, M, (A.shape[1], A.shape[0]), borderValue=0)
            rimL = cv2.GaussianBlur(np.clip(A - shifted(d, d * 0.5), 0, 1), (0, 0), sig)
            rimR = cv2.GaussianBlur(np.clip(A - shifted(-d, d * 0.5), 0, 1), (0, 0), sig)
            halo = cv2.GaussianBlur(A, (0, 0), max(2.0, 0.035 * self.body_h)) if halo_on else np.zeros_like(A)
            return np.dstack([rimL, rimR, halo, np.zeros_like(A)])

        def pack(rgba, halo_on):
            A = rgba[..., 3]
            m = max(8, int(0.06 * self.body_h)) if halo_on else 8
            ys_, xs_ = np.nonzero(A > 0.004)
            y0_, y1_ = max(0, ys_.min() - m), min(H, ys_.max() + m)
            x0_, x1_ = max(0, xs_.min() - m), min(W, xs_.max() + m)
            sub = rgba[y0_:y1_, x0_:x1_]
            aux = aux_of(np.ascontiguousarray(sub[..., 3]), halo_on)
            return dict(img=_u8(sub), aux=_u8(aux), off=(x0_, y0_))

        for name, L in self.layers.items():
            L.update(pack(L.pop("rgba"), name in ("rays", "arm_l", "arm_r", "head")))
        b19 = pack(self.body19, False)
        self.body19 = b19

        # ตัวต่อสำหรับเอฟเฟกต์ประกอบ/แตกออก (ขนาดราว 2 ปุ่ม)
        self.tile = max(6, int(round(46 * s_rig * f)))
        self.build_tiles = self._tiles(self.full)
        self.ray_tiles = self._tiles(np.dstack([rays_rgb * al["rays_a"][..., None], al["rays_a"]]).astype(np.float32))
        del self.full

    def _tiles(self, sp):
        ts = self.tile
        out = []
        for ty in range(0, self.h, ts):
            for tx in range(0, self.w, ts):
                t = sp[ty:ty + ts, tx:tx + ts]
                if t[..., 3].max() < 0.05:
                    continue
                out.append(((tx + t.shape[1] / 2, ty + t.shape[0] / 2), _u8(t)))
        return out


def _u8(x):
    return (np.clip(x, 0, 1) * 255 + 0.5).astype(np.uint8)
