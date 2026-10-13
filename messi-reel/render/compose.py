"""ประกอบภาพทีละเฟรม: Renderer.frame(t) → ภาพ uint8 (H, W, 3)

ชั้นภาพ (หลัง → หน้า)
  1 ฉากหลัง: ไล่สี + ไฟสนามโบเก้ + หมอก + แฟลชกล้อง/ไฟสนาม/ไฟมือถือ (ครึ่งความละเอียด แล้วขยาย)
  2 ถ้วย (ลอยเหนือหัว ตรงที่นิ้วชี้) + จุดแสงแห่งความหวัง + ประกายลอยขึ้นฟ้า
  3 หุ่นเชิด Lego: ลำแสง → แขนซ้าย/ขวา → เสื้อ → หัว  (ขยับแบบสต็อปโมชัน 12 ครั้ง/วินาที)
     + ตัวต่อประกอบร่าง (เปิดเรื่อง) / ลำแสงแตกเป็นตัวต่อลอยขึ้นฟ้า (ปิดเรื่อง)
  4 ข้างหน้า: คอนเฟตตี ฝุ่น
  5 บลูม → เกรดสี → ความนุ่มตามยุค
  6 ตัวหนังสือ (แถบบนเหนือปลายนิ้ว)
  7 ทีวีเก่า/กลิตช์ → ขอบมืด → เกรน → แฟลชขาว/เฟดดำ
"""
import math
import os
import zlib

import cv2
import numexpr as ne
import numpy as np

from . import fx, gfx
from .hero import Puppet
from .looks import CX, LOOKS, PALETTE, POS_Y, mix
from .timeline import ROOT, back_out, clamp, ease_in, ease_in_out, ease_out, env, lerp, smooth

ARCHIVE_DIR = os.path.join(ROOT, "input", "archive")  # ภาพถ่ายจริงที่ใช้สิทธิ์ได้ (ไม่เข้า git) — ดู input/archive/README.md
# ภาพบนจอยักษ์ "แก่" ตามยุค: (ความอิ่มสี, โทนอุ่น, คอนทราสต์)
ARCHIVE_GRADE = {2006: (0.55, 0.05, 0.92), 2010: (0.75, 0.03, 0.96), 2014: (0.95, 0.01, 1.0),
                 2018: (0.85, 0.0, 1.06), 2022: (1.0, 0.02, 1.03), 2026: (1.0, 0.0, 1.0)}
TWOS = 12.0  # หุ่นขยับ 12 ครั้ง/วินาที ให้ความรู้สึกหนังเลโก้สต็อปโมชัน ส่วนกล้องลื่นเต็ม 30 fps
ANCHOR_Y = 0.55


def _seed(*parts):
    return zlib.crc32("|".join(str(p) for p in parts).encode())


def _m3(M):
    return np.vstack([M, [0, 0, 1]]).astype(np.float64)


def _local(pivot, rot_deg=0.0, scale=1.0, dx=0.0, dy=0.0):
    """เมทริกซ์ในพิกัด sprite: ย่อ/หมุนรอบ pivot แล้วเลื่อน (dx, dy)"""
    a = math.radians(rot_deg)
    c, s = math.cos(a) * scale, math.sin(a) * scale
    px, py = pivot
    return np.array([[c, -s, px - c * px + s * py + dx],
                     [s, c, py - s * px - c * py + dy],
                     [0, 0, 1]], np.float64)


class Renderer:
    def __init__(self, tl, W, H):
        self.tl, self.W, self.H = tl, W, H
        self.hw, self.hh = W // 2, H // 2
        self.pup = Puppet(tl.raw["hero"], H)
        self.hero_top = tl.raw["hero"].get("top", 0.36)
        self._bokeh = {}
        self._haze = self._make_haze()
        self._rays = self._make_rays()
        self._cache = {}
        self.debug_text = None
        self.placeholders = False  # True = วาดกรอบ "รอภาพ" แทนภาพถ่ายจริงที่ยังไม่มีไฟล์ (ไว้ดูตำแหน่งเท่านั้น)
        self._pumps = self._pump_times()

    # ------------------------------------------------------------ helpers
    def _a(self, a):
        """สุ่มแบบคงที่ต่อ action (render แยกชิ้นแล้วได้ผลเหมือนกัน)"""
        return np.random.default_rng(_seed(a["_shot"], a["do"], round(a["t"], 3)))

    def cam(self, x, y, k=1.0):
        """พิกัดโลก (สัดส่วนจอ) → พิกเซลจอ ผ่านกล้อง  k = ค่า parallax (1 = ระนาบเดียวกับหุ่น)"""
        z = 1 + (self.zoom - 1) * k
        cx, cy = CX * self.W, ANCHOR_Y * self.H
        tx = cx + (self.target[0] * self.W - cx) * k
        ty = cy + (self.target[1] * self.H - cy) * k
        px = cx + (x * self.W - tx) * z + self.shake[0] * k - self.orbit_s * (1 - k) * 0.6 * self.W
        py = cy + (y * self.H - ty) * z + self.shake[1] * k
        return px, py, z

    def cam_matrix(self, k):
        """เมทริกซ์ของกล้อง (พิกเซลเต็มจอ) สำหรับ warp ทั้งชั้น"""
        px, py, z = self.cam(0, 0, k)
        return np.float32([[z, 0, px], [0, z, py]])

    # ------------------------------------------------------------ static textures
    def _make_haze(self):
        """หมอกที่ต่อกันได้ในแนวนอน (ขอบซ้ายต่อขอบขวาพอดี) — เลื่อนวนด้วย np.roll แล้วไม่เห็นรอยต่อ"""
        def tile(n):
            c, p = n.shape[1], 3
            big = cv2.resize(np.pad(n, ((0, 0), (p, p)), mode="wrap"), (self.hw * (c + 2 * p) // c, self.hh), interpolation=cv2.INTER_CUBIC)
            x0 = self.hw * p // c
            return big[:, x0:x0 + self.hw]
        rng = np.random.default_rng(3)
        hz = tile(rng.random((18, 10)).astype(np.float32))
        hz = 0.65 * hz + 0.35 * tile(rng.random((40, 22)).astype(np.float32))
        return np.ascontiguousarray(np.clip((hz - 0.35) * 1.6, 0, 1))

    def _make_rays(self):
        h, w = self.hh, self.hw
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        ox, oy = CX * w, -0.08 * h
        ang = np.arctan2(yy - oy, xx - ox)
        rng = np.random.default_rng(11)
        r = np.zeros_like(ang)
        for f, a in ((14, 0.5), (31, 0.3), (57, 0.2)):
            r += a * (0.5 + 0.5 * np.sin(ang * f + rng.random() * 6.28))
        dist = np.sqrt((xx - ox) ** 2 + (yy - oy) ** 2) / h
        fall = np.exp(-dist * 1.4) * np.clip(1 - np.abs(ang - math.pi / 2) / 0.9, 0, 1)
        return (np.clip(r - 0.45, 0, 1) * 2.2 * fall).astype(np.float32)

    def _bokeh_layer(self, era):
        if era in self._bokeh:
            return self._bokeh[era]
        col, n = LOOKS[era]["bokeh"]
        rng = np.random.default_rng(_seed("bokeh", era))
        h, w = self.hh, self.hw
        lay = np.zeros((h, w, 3), np.float32)
        for _ in range(n):  # ไฟสนามเบลอเป็นวง ๆ (อัฒจันทร์ไกล ๆ)
            x, y = rng.uniform(-0.05, 1.05) * w, (0.02 + rng.beta(1.6, 3.0) * 0.7) * h
            r = int(rng.uniform(0.012, 0.05) * h)
            c = np.float32(col) * rng.uniform(0.35, 1.0) * (0.85 + 0.3 * rng.random(3)).astype(np.float32)
            fx.add_mono(lay, gfx.soft_dot(2 * r, hard=0.75), x, y, c, rng.uniform(0.15, 0.45))
        for row in range(3):  # แนวไฟอัฒจันทร์เป็นจุดเล็ก
            yb = (0.20 + row * 0.07) * h
            for _ in range(70):
                x = rng.uniform(0, 1) * w
                y = yb - math.sin(x / w * math.pi) * 0.05 * h + rng.normal(0, 0.006 * h)
                fx.add_mono(lay, gfx.soft_dot(max(3, int(0.006 * h))), x, y, np.float32(col), rng.uniform(0.1, 0.4))
        lay = cv2.GaussianBlur(lay, (0, 0), max(1.0, 0.002 * h))
        self._bokeh[era] = lay
        return lay

    def _pump_times(self):
        """จังหวะที่แขนชี้ฟ้ากระตุกขึ้น: ตามบีตจริงถ้ามี beatmap ไม่งั้นตามค่า every ในแผน"""
        out = []
        for a in self.tl.actions:
            if a["do"] != "pump":
                continue
            ev = a.get("every", 0.5)
            cnt = a.get("count", 99)  # จำนวนครั้งสูงสุด (เช่น S21 = 4 ครั้ง ตามชัยชนะ 4 นัดในรอบน็อกเอาต์)
            if self.tl.beat.ok:
                last, got = -9.0, []
                for b in self.tl.beat.beats:
                    if a["t"] - 0.05 <= b <= a["t"] + a["dur"] and b - last >= ev * 0.75 and len(got) < cnt:
                        got.append(b)
                        last = b
                out += got
            else:
                n = min(cnt, int(a["dur"] / ev) + 1)
                out += [a["t"] + i * ev for i in range(n)]
        return sorted(out)

    # ------------------------------------------------------------ layer 1: background (half-res, world)
    def background(self, t, look, ea, eb, w, stadium=0.5, expand=1.0, bokeh=1.0):
        h, wd = self.hh, self.hw
        top, bot = np.float32(look["bg_top"]), np.float32(look["bg_bottom"])
        g = np.linspace(0, 1, h, dtype=np.float32)[:, None, None] ** 1.3
        bg = np.broadcast_to(top + (bot - top) * g, (h, wd, 3)).copy()
        self.stadium(bg, look, stadium, expand)
        bk = self._bokeh_layer(ea["id"])
        if w > 0 and eb["id"] != ea["id"]:
            bk = bk * (1 - w) + self._bokeh_layer(eb["id"]) * w
        drift = np.float32([[1, 0, math.sin(t * 0.13) * 0.01 * wd], [0, 1, 0]])
        bk = cv2.warpAffine(bk, drift, (wd, h), borderMode=cv2.BORDER_REFLECT)
        bg += bk if bokeh >= 0.999 else bk * np.float32(bokeh)  # world.bokeh: หรี่ไฟสนามในช็อตที่ต้องมืด (เช่นต้นปี 2022)
        hz_amt = 0.05 + 0.10 * self._haze_boost
        off = (t * 0.012 * h) % wd
        bg += np.roll(self._haze, int(off), axis=1)[..., None] * np.float32(look["rim"]) * hz_amt
        return bg

    def flashbulbs(self, bg, t, a):
        rng = self._a(a)
        r0, r1 = a.get("rate", 4), a.get("rate_end", a.get("rate", 4))
        dur = a["dur"]
        n = int((r0 + r1) / 2 * dur) + 1
        u = np.sort(rng.random(n))
        if r1 != r0:  # ถี่ขึ้นเรื่อย ๆ
            u = (np.sqrt(r0 ** 2 + (r1 ** 2 - r0 ** 2) * u) - r0) / (r1 - r0)
        births = a["t"] + u * dur
        xs, ys = rng.uniform(-0.02, 1.02, n), 0.04 + rng.beta(1.4, 2.6, n) * 0.6
        s0, s1 = a.get("size", [0.04, 0.11])
        sz = rng.uniform(s0, s1, n)
        decay, life, lift = a.get("decay", 0.05), a.get("life", 0.22), a.get("lift", 0.0)
        energy = 0.6 + 0.8 * self.tl.beat.level(t) if self.tl.beat.ok else 1.0
        exposure = 0.0
        for b, x, y, s in zip(births, xs, ys, sz):
            dt = t - b
            if 0 <= dt < life:
                px, py, z = self.cam(x, y, 0.45)
                fx.add_mono(bg, gfx.flare(int(s * self.hh * z)), px / 2, py / 2, (1.0, 0.98, 0.95), 1.4 * math.exp(-dt / decay) * energy)
                exposure += lift * math.exp(-dt / 0.06)
        if exposure > 0:  # ทั้งฉากสว่างวาบตามแฟลช (ช่วงท้ายที่ถี่มากจะกะพริบเป็นสโตรบ)
            bg += np.float32(min(exposure, 0.18))

    def lightbanks(self, bg, t, a):
        n = a.get("count", 7)
        step = a.get("step", a["dur"] * 0.85 / n)  # ระยะห่างไม่ผูกกับ dur → ยืด dur ไว้เฟดหางได้โดยจังหวะไม่เพี้ยน
        times = [self.tl.beat.snap(a["t"] + i * step, "beat", 0.3) for i in range(n)]
        col = np.float32((1.0, 0.95, 0.85))
        tail = env(t, a["t"], a["dur"], 0.0, a.get("tail", 0.01))  # ไฟดับแบบค่อย ๆ หรี่ ไม่วูบหายในเฟรมเดียว
        for i, tb in enumerate(times):
            k = smooth((t - tb) / 0.12) * tail
            if k <= 0:
                continue
            flick = 1.0 if t - tb > 0.25 else (0.5 + 0.5 * math.sin((t - tb) * 90))
            x = 0.06 + i * (0.88 / (n - 1))
            y = 0.10 + 0.04 * math.sin(i / (n - 1) * math.pi)
            px, py, z = self.cam(x, y, 0.5)
            for r in range(2):
                for c in range(4):
                    fx.add_mono(bg, gfx.soft_dot(int(0.03 * self.hh * z), hard=0.5),
                                px / 2 + (c - 1.5) * 0.012 * self.hh * z, py / 2 + (r - 0.5) * 0.012 * self.hh * z, col, 1.4 * k * flick)
            fx.add_mono(bg, gfx.soft_dot(int(0.22 * self.hh * z)), px / 2, py / 2, col, 0.35 * k * flick)
        on = sum(1 for tb in times if t >= tb) / n * tail
        bg += np.float32((0.10, 0.075, 0.04)) * np.float32(on)

    def godrays(self, bg, t, a, look):
        k = env(t, a["t"], a["dur"], 0.4, 0.8)
        if k <= 0:
            return
        M = cv2.getRotationMatrix2D((CX * self.hw, -0.08 * self.hh), math.sin(t * 0.4) * 3, 1.0)
        bg += cv2.warpAffine(self._rays, M, (self.hw, self.hh))[..., None] * np.float32(look["rim"]) * 0.55 * k

    def spotlight(self, bg, t, a):
        k = env(t, a["t"], a["dur"], 0.5, 0.6)
        if k <= 0:
            return
        key = ("spot", self.hh)
        if key not in self._cache:
            h, w = self.hh, self.hw
            yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
            half = 0.05 * w + (yy / h) * 0.34 * w
            cone = np.clip(1 - np.abs(xx - CX * w) / half, 0, 1) ** 1.5 * np.clip(yy / h * 1.6, 0, 1)
            self._cache[key] = cv2.GaussianBlur(cone, (0, 0), 0.01 * h)
        bg *= np.float32(1 - 0.75 * k)
        bg += self._cache[key][..., None] * np.float32((1.0, 0.92, 0.85)) * 0.32 * k

    def phonelights(self, bg, t, a):
        k = env(t, a["t"], a["dur"], 1.6, 0.8)
        if k <= 0:
            return
        key = ("phones",)
        if key not in self._cache:
            rng = np.random.default_rng(5)
            n = 6400
            row = rng.beta(1.7, 1.0, n)  # แถวหน้า (row → 1) แน่นกว่าแถวไกล
            x = rng.uniform(-0.1, 1.1, n)
            # อัฒจันทร์เป็นชั้นโค้ง: แถวไกลอยู่สูง
            y = 0.10 + row * 0.55 - np.sin(np.clip(x, 0, 1) * np.pi) * (0.05 + 0.04 * row) + rng.normal(0, 0.006, n)
            wave = (rng.random(n) < 0.22) * (0.004 + 0.010 * row)  # บางดวงโบกซ้าย-ขวา (แถวหน้าโบกกว้างกว่า)
            self._cache[key] = tuple(v.astype(np.float32) for v in (x, y, row, rng.uniform(0, 6.28, n), rng.uniform(0.6, 2.4, n), rng.random(n),
                                                                     wave, rng.uniform(1.6, 2.6, n)))
        x, y, row, ph, sp, order, wave, wf = self._cache[key]
        vis = order < clamp((t - a["t"]) / 2.6)  # ไฟเปิดทีละดวงจนเต็มสนาม
        tw = 0.55 + 0.45 * np.sin(t * sp + ph)
        x = x + wave * np.sin(t * wf + ph)
        y = y - wave * 0.35 * np.abs(np.cos(t * wf + ph))  # โบกเป็นแนวโค้งเหมือนแกว่งแขน
        M = self.cam_matrix(0.5)
        X = ((M[0, 0] * x * self.W + M[0, 2]) / 2).astype(np.int32)
        Y = ((M[1, 1] * y * self.H + M[1, 2]) / 2).astype(np.int32)
        ok = vis & (X >= 0) & (X < self.hw) & (Y >= 0) & (Y < self.hh)
        lay = np.zeros((self.hh, self.hw), np.float32)
        np.add.at(lay, (Y[ok], X[ok]), tw[ok] * (0.5 + 0.5 * row[ok]))
        rad = max(1, int(self.hh / 900))
        if rad > 1:
            lay = cv2.dilate(lay, np.ones((rad, rad), np.uint8))
        lay = lay + cv2.GaussianBlur(lay, (0, 0), max(1.0, 0.004 * self.hh)) * 3.0
        bg *= np.float32(1 - 0.25 * k)
        bg += (lay * k)[..., None] * np.float32((1.0, 0.97, 0.9))


    # ------------------------------------------------------------ giant screen (real archive photos)
    def _archive_src(self, name):
        key = ("arch", name)
        if key not in self._cache:
            p = os.path.join(ARCHIVE_DIR, name)
            im = cv2.imread(p, cv2.IMREAD_COLOR) if os.path.isfile(p) else None
            if im is not None:
                lim = 2 * self.W  # ย่อครั้งเดียวพอให้ warp ไม่ต้องย่อมาก (ไม่เป็นรอยหยัก)
                if max(im.shape[:2]) > lim:
                    k = lim / max(im.shape[:2])
                    im = cv2.resize(im, (int(im.shape[1] * k), int(im.shape[0] * k)), interpolation=cv2.INTER_AREA)
                im = np.ascontiguousarray(im[..., ::-1].astype(np.float32) / 255)
            self._cache[key] = im
        return self._cache[key]

    def _archive_placeholder(self, a, sw, sh):
        key = ("arch_ph", a["src"], sw, sh)
        if key not in self._cache:
            g = np.linspace(0, 1, sh, dtype=np.float32)[:, None, None]
            pic = np.broadcast_to(np.float32((0.10, 0.11, 0.13)) * (1 - 0.4 * g), (sh, sw, 3)).copy()
            yy, xx = np.mgrid[0:sh, 0:sw]
            pic += (((xx + yy) // max(2, sh // 14)) % 2 == 0)[..., None].astype(np.float32) * 0.025
            for txt, fk, sz, y in ((f"ARCHIVE PHOTO · {a.get('year', '')}", "display", 0.13, 0.40),
                                   (a.get("label", "รอภาพถ่ายจริงที่ใช้สิทธิ์ได้"), "thai", 0.07, 0.60)):
                sp = gfx.text_sprite(txt, fk, int(sz * sh), (0.85, 0.87, 0.9), 0.04 if fk == "display" else 0.0, 0.0)
                fx.blit(pic, sp, sw / 2, y * sh, 1.0)
            self._cache[key] = pic
        return self._cache[key]

    def screen(self, img, t, a):
        """จอยักษ์ในสนามเหนือหัวหุ่น: ฉายภาพถ่ายจริงของเหตุการณ์ในปีนั้น (หุ่นชี้นิ้วขึ้นไปที่จอ เรายืนดูอยู่ข้างหลังเขา)
        ภาพมาจาก input/archive/<src> เท่านั้น ถ้าไม่มีไฟล์ = ไม่วาดอะไรเลย (คลิปเหมือนเดิมทุกพิกเซล)"""
        u, dur = t - a["t"], a["dur"]
        if u < 0 or u > dur:
            return
        src = self._archive_src(a["src"])
        if src is None and not self.placeholders:
            return
        H, W = self.H, self.W
        px, py, z = self.cam(a.get("x", CX), a.get("y", 0.25), a.get("parallax", 0.3))  # ขอบบนพ้นแถบหัว Reels · ตามกล้องแค่ 30% ช็อตซูมแล้วจอไม่ล้นกรอบ
        sw = max(16, int(a.get("w", 0.84) * W * z))
        sh = max(9, int(sw / a.get("aspect", 1.5)))  # 3:2 เท่าภาพข่าวกีฬาส่วนใหญ่ — ขอบล่างจอให้ปลายนิ้วชี้แตะพอดี
        # เปิดจอแบบจอ LED สนาม: เส้นสว่างกลางจอแล้วกางขึ้นลง · ปิดจอ: หุบกลับเป็นเส้น
        vs = ease_out(clamp(u / 0.22)) * (1 - ease_in(clamp((u - dur + 0.28) / 0.28)))
        if src is not None:
            ih, iw = src.shape[:2]
            fx_, fy_ = a.get("focus", [0.5, 0.4])
            z0, z1 = a.get("zoom", [1.0, 1.07])
            s0 = max(sw / iw, sh / ih) * lerp(z0, z1, ease_in_out(u / dur))  # เต็มจอ (cover) + ซูมช้า ๆ แบบ Ken Burns
            cx_ = min(max(fx_ * iw, sw / (2 * s0)), iw - sw / (2 * s0))
            cy_ = min(max(fy_ * ih, sh / (2 * s0)), ih - sh / (2 * s0))
            Ms = np.float32([[s0, 0, sw / 2 - s0 * cx_], [0, s0, sh / 2 - s0 * cy_]])
            pic = cv2.warpAffine(src, Ms, (sw, sh), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
            sat, warm, con = ARCHIVE_GRADE.get(int(a.get("year", 2026)), (1.0, 0.0, 1.0))
            lum = pic @ np.float32([0.2126, 0.7152, 0.0722])
            pic = lum[..., None] + (pic - lum[..., None]) * np.float32(sat)
            pic = (pic - 0.45) * np.float32(con) + 0.45 + np.float32((warm, warm * 0.4, -warm * 0.8))
        else:
            pic = self._archive_placeholder(a, sw, sh).copy()
        # เนื้อจอ LED: ตารางพิกเซลจาง ๆ + สว่างแบบเปล่งแสง
        mk = ("ledmesh", sw, sh)
        if mk not in self._cache:
            pitch = max(2.5, sh / 190)
            yy = np.arange(sh, dtype=np.float32)[:, None]
            xx = np.arange(sw, dtype=np.float32)[None, :]
            self._cache[mk] = ((0.88 + 0.12 * np.cos(2 * np.pi * xx / pitch)) * (0.9 + 0.10 * np.cos(2 * np.pi * yy / pitch))).astype(np.float32)[..., None]
        pic = np.clip(pic, 0, 1) * self._cache[mk] * np.float32(a.get("gain", 0.92))
        hv = max(2, int(sh * vs))
        if hv < sh:
            pic = cv2.resize(pic, (sw, hv), interpolation=cv2.INTER_AREA)
            if vs < 0.12:  # เส้นไฟตอนเปิด/ปิดจอ
                pic = pic * 0.3 + np.float32(0.9)
        al = a.get("alpha", 1.0)
        # แสงจากจอฟุ้งลงบนฉากรอบ ๆ (สีเฉลี่ยของภาพ)
        gk = ("scrglow", sw // 8, sh // 8)
        if gk not in self._cache:
            gw, gh = sw // 8 + 40, sh // 8 + 40
            m = np.zeros((gh, gw), np.float32)
            m[20:gh - 20, 20:gw - 20] = 1
            m = cv2.GaussianBlur(m, (0, 0), 7)
            self._cache[gk] = cv2.resize(m, (int(gw * 8 * 1.1), int(gh * 8 * 1.25)), interpolation=cv2.INTER_LINEAR)
        mean = pic.reshape(-1, 3).mean(0)
        fx.add_mono(img, self._cache[gk], px, py, tuple(float(c) for c in mean), 0.35 * al * vs)
        # กรอบจอ (ขอบมืด + เส้นขอบบางสะท้อนแสง)
        b = max(2, int(0.006 * H * z))
        x0, y0 = int(px - sw / 2), int(py - hv / 2)
        X0, Y0, X1, Y1 = max(0, x0 - b), max(0, y0 - b), min(W, x0 + sw + b), min(H, y0 + hv + b)
        if X1 > X0 and Y1 > Y0:
            img[Y0:Y1, X0:X1] *= np.float32(1 - 0.85 * al)
            img[Y0:Y1, X0:X1] += np.float32(0.03 * al)
        X0, Y0, X1, Y1 = max(0, x0), max(0, y0), min(W, x0 + sw), min(H, y0 + hv)
        if X1 > X0 and Y1 > Y0:
            sub = pic[Y0 - y0:Y1 - y0, X0 - x0:X1 - x0]
            img[Y0:Y1, X0:X1] = img[Y0:Y1, X0:X1] * np.float32(1 - al) + sub * np.float32(al)

    # ------------------------------------------------------------ puppet
    def sv(self, d, key, default):
        """ค่าในช็อต: ตัวเลขเดี่ยว หรือ [a, b] = เปลี่ยนจาก a ไป b ตลอดช็อต"""
        v = d.get(key, default)
        if isinstance(v, (list, tuple)):
            return lerp(float(v[0]), float(v[1]), smooth(self.u))
        return v

    def puppet_T(self):
        sh = self.shot.get("hero", {})
        scale = self.sv(sh, "scale", 0.56)
        x = self.sv(sh, "x", CX)
        y = self.sv(sh, "y", None)
        y = self.hero_top + scale / 2 if y is None else y
        px, py, z = self.cam(x, y, 1.0)
        s = scale * self.H / self.pup.body_h * z
        cx, cy = self.pup.center
        return np.array([[s, 0, px - s * cx], [0, s, py - s * cy], [0, 0, 1]], np.float64), s

    def to_screen(self, T, p):
        v = T @ np.array([p[0], p[1], 1.0])
        return v[0], v[1]

    def pose(self, t):
        """ท่าทางของหุ่น ณ เวลา t (ขยับเป็นจังหวะ 12 ครั้ง/วินาที)"""
        th = math.floor(t * TWOS) / TWOS
        sh = self.shot.get("hero", {})
        rays = sh.get("rays", [1.0, 1.0])
        rays = rays if isinstance(rays, list) else [rays, rays]
        amt = self.motion_amt
        pump = 0.0
        for ti in self._pumps:
            if 0 <= th - ti < 0.9:
                pump = max(pump, math.exp(-(th - ti) / 0.16))
        pump_r = 0.0
        for ti in self._pumps:
            if 0 <= th - ti - 1 / TWOS < 0.9:
                pump_r = max(pump_r, math.exp(-(th - ti - 1 / TWOS) / 0.16))
        bh = self.pup.body_h
        bp = 0.0
        if self.tl.beat.ok:
            bp = self.tl.beat.pulse(th, 0.14, True) * clamp((self.tl.beat.level(t) - 0.3) / 0.5)
        return dict(
            arm_l=_local(self.pup.layers["arm_l"]["pivot"], amt * 1.2 * math.sin(2 * math.pi * th / 3.1) - 2.5 * pump, 1.0, 0, -0.022 * bh * pump),
            arm_r=_local(self.pup.layers["arm_r"]["pivot"], amt * 1.2 * math.sin(2 * math.pi * th / 3.7 + 1) + 2.5 * pump_r, 1.0, 0, -0.022 * bh * pump_r),
            head=_local(self.pup.layers["head"]["pivot"], amt * 0.8 * math.sin(2 * math.pi * th / 4.3) + 0.6 * pump),
            body=_local(self.pup.layers["body"]["pivot"], 0, 1 + amt * 0.004 * math.sin(2 * math.pi * th / 3.4)),
            rays=_local(self.pup.layers["rays"]["pivot"], amt * 0.5 * math.sin(2 * math.pi * th / 9.0),
                        lerp(rays[0], rays[1], smooth(self.u)) * (1 + 0.02 * bp + 0.012 * pump)),
            pump=max(pump, pump_r),
        )

    def _warp(self, sp_u8, off, M):
        Ms = M @ np.array([[1, 0, off[0]], [0, 1, off[1]], [0, 0, 1]], np.float64)
        return fx.warp_into((self.H, self.W), sp_u8, Ms[:2].astype(np.float32))

    def draw_layer(self, img, L, M, look, lit, rim_k, tint=None, img_override=None):
        sp = L["img"] if img_override is None else img_override["img"]
        off = L["off"] if img_override is None else img_override["off"]
        r = self._warp(sp, off, M)
        if r is None:
            return
        roi, rgba = r
        rgba = rgba.astype(np.float32)  # 0..255
        if tint is not None:
            rgba = tint(rgba, roi)
        k = np.float32(1 / 255)
        rim_c = np.float32(look["rim"]) * np.float32(look["rim_amt"])
        lit_k = np.float32((0.05 + 0.95 * lit) / 255)
        rgb, a = rgba[..., :3], rgba[..., 3:4]
        d = img[roi]
        if rim_k > 0.001:
            _, aux = self._warp(L["aux"] if img_override is None else img_override["aux"], off, M)
            aux = aux.astype(np.float32)
            hl, rl, rr = aux[..., 2:3], aux[..., 0:1], aux[..., 1:2]
            # ไฟขอบเพิ่มได้นิดเดียวตอนแสงหรี่ (เดิมเพิ่มเกือบเท่าตัว → เป็นเส้นเรืองรอบชั้นภาพเหมือนสติกเกอร์)
            hcol = rim_c * np.float32((0.10 + 0.08 * (1 - lit)) * rim_k / 255)
            rcol = rim_c * np.float32((0.45 + 0.35 * (1 - lit)) * rim_k / 255 / 255)
            img[roi] = ne.evaluate("(d + hl * hcol) * (1 - a * k) + rgb * lit_k + (rl + rr) * a * rcol")
        else:
            img[roi] = ne.evaluate("d * (1 - a * k) + rgb * lit_k")
        if self.track_alpha:
            ha = self.hero_a[roi]
            a2 = rgba[..., 3]
            self.hero_a[roi] = ne.evaluate("where(ha > a2 * k, ha, a2 * k)")

    def draw_tile(self, img, tile_u8, M, alpha, lit):
        r = fx.warp_into((self.H, self.W), tile_u8, M[:2].astype(np.float32))
        if r is None:
            return
        roi, rgba = r
        rgba = rgba.astype(np.float32) * np.float32(alpha / 255)
        d = img[roi]
        d *= 1 - rgba[..., 3:4]
        d += rgba[..., :3] * np.float32(0.05 + 0.95 * lit)
        if self.track_alpha:
            np.maximum(self.hero_a[roi], rgba[..., 3], out=self.hero_a[roi])

    def draw_puppet(self, img, t, look):
        pup = self.pup
        T, s = self.puppet_T()
        self.T = T
        sh = self.shot.get("hero", {})
        lit = self.sv(sh, "lit", 1.0)
        P = self.pose(t)
        rim_k = self.motion_amt * self.sv(sh, "rim", 1.0)
        ts = pup.tile
        # โคจรบางส่วน: ชั้นที่อยู่ลึกกว่าเลื่อนไปตามฉากหลัง ชั้นหน้า (เสื้อ) อยู่กับที่ → เห็นความลึก
        ob = self.orbit_s * 0.12 * pup.body_h
        for name, depth in (("rays", -1.0), ("arm_l", -0.25), ("arm_r", -0.25), ("head", -0.3)):
            P[name] = np.array([[1, 0, ob * depth], [0, 1, 0], [0, 0, 1]], np.float64) @ P[name]

        # --- ประกอบร่างจากตัวต่อ (เปิดเรื่อง)
        for a in self.tl.active(t, ("build",)):
            if t <= a["t"] + a["dur"]:
                rng = self._a(a)
                for (c, tile) in pup.build_tiles:
                    order = 1 - c[1] / pup.h  # จากล่างขึ้นบน เหมือนต่อเลโก้จริง
                    delay = order * (a["dur"] - 0.55) + rng.uniform(0, 0.12)
                    dx0, dy0 = rng.uniform(-0.25, 0.25) * pup.h, -rng.uniform(0.45, 0.9) * pup.h
                    rot0 = rng.uniform(-45, 45)
                    q = clamp((t - a["t"] - delay) / 0.45)
                    if q <= 0:
                        continue
                    k = 1 - back_out(q, 1.3)
                    L = _local((c[0], c[1]), rot0 * k, 1.0, dx0 * k, dy0 * k)
                    M = T @ L @ np.array([[1, 0, c[0] - tile.shape[1] / 2], [0, 1, c[1] - tile.shape[0] / 2], [0, 0, 1]])
                    self.draw_tile(img, tile, M, smooth(q * 3), lit)
                return

        # --- ลำแสง (หรือแตกเป็นตัวต่อลอยขึ้นฟ้าตอนจบ)
        release = self.tl.active(t, ("release",))
        Mr = T @ P["rays"]
        if release:
            a = release[0]
            rng = self._a(a)
            rc = pup.ray_center
            maxd = max(math.hypot(c[0] - rc[0], c[1] - rc[1]) for c, _ in pup.ray_tiles)
            for (c, tile) in pup.ray_tiles:
                dn = math.hypot(c[0] - rc[0], c[1] - rc[1]) / maxd
                delay = (1 - dn) * a["dur"] * 0.5 + rng.uniform(0, 0.5)
                vx, vy = rng.normal(0, 0.03) * pup.h, -rng.uniform(0.05, 0.13) * pup.h
                spin = rng.uniform(-60, 60)
                v = t - a["t"] - delay
                Mt = np.array([[1, 0, c[0] - tile.shape[1] / 2], [0, 1, c[1] - tile.shape[0] / 2], [0, 0, 1]])
                if v <= 0:
                    self.draw_tile(img, tile, Mr @ Mt, 1.0, lit)
                    continue
                al = 1 - smooth(v / 2.4)
                if al <= 0.01:
                    continue
                L = _local((c[0], c[1]), spin * v, 1 - 0.3 * smooth(v / 2.5), vx * v + 0.01 * pup.h * math.sin(v * 2 + c[0]),
                           vy * v - 0.03 * pup.h * v * v)
                self.draw_tile(img, tile, Mr @ L @ Mt, al, lit)
                px, py = self.to_screen(Mr @ L, c)
                fx.add_mono(img, gfx.soft_dot(int(ts * s * 1.6)), px, py, PALETTE["gold"], 0.25 * al * smooth(v / 0.4))
        else:
            gold = sh.get("gold", 0.0)
            pulses = [ti for ti in self._pumps if 0 <= t - ti < 0.7]
            pulses += [a["t"] + i * 0.8 for a in self.tl.active(t, ("rays",)) for i in range(int(a["dur"] / 0.8) + 1) if 0 <= t - a["t"] - i * 0.8 < 0.7]
            if self.tl.beat.ok and self.tl.beat.level(t) > 0.6:
                pulses += [b for b in self.tl.beat.downbeats if 0 <= t - b < 0.7]
            cx, cy = self.to_screen(Mr, pup.ray_center)
            R = 0.75 * pup.w * s

            def tint(rgba, roi):
                if gold > 0:
                    r_, g_, b_ = rgba[..., 0:1], rgba[..., 1:2], rgba[..., 2:3]
                    gc = np.float32(PALETTE["gold"]) * np.float32(0.6 * gold / 3)
                    keep = np.float32(1 - 0.45 * gold)
                    rgba[..., :3] = ne.evaluate("rgb * keep + (r_ + g_ + b_) * gc", local_dict=dict(rgb=rgba[..., :3], keep=keep, r_=r_, g_=g_, b_=b_, gc=gc))
                if pulses:
                    # คลื่นแสงวิ่งออกจากกลางลำแสง คำนวณที่ 1/4 ความละเอียดแล้วขยาย (นุ่มอยู่แล้ว)
                    y0_, y1_, x0_, x1_ = roi[0].start, roi[0].stop, roi[1].start, roi[1].stop
                    q4 = 4
                    yy, xx = np.ogrid[y0_:y1_:q4, x0_:x1_:q4]
                    dist = np.sqrt(((xx - cx) ** 2 + (yy - cy) ** 2).astype(np.float32))
                    band = np.zeros_like(dist)
                    for ti in pulses[-3:]:
                        q = (t - ti) / 0.7
                        band = np.maximum(band, np.exp(-((dist - q * R) / (0.06 * R)) ** 2) * (1 - q))
                    band = cv2.resize(band.astype(np.float32), (x1_ - x0_, y1_ - y0_), interpolation=cv2.INTER_LINEAR)[..., None]
                    rgba[..., :3] = ne.evaluate("rgb * (1 + 0.9 * band)", local_dict=dict(rgb=rgba[..., :3], band=band))
                return rgba

            self.draw_layer(img, pup.layers["rays"], Mr, look, lit, rim_k, tint)

        # --- แขน (หลังเสื้อ) → เสื้อ → หัว
        self.draw_layer(img, pup.layers["arm_l"], T @ P["arm_l"], look, lit, rim_k)
        self.draw_layer(img, pup.layers["arm_r"], T @ P["arm_r"], look, lit, rim_k)
        Mb = T @ P["body"]
        num, flip_p = self.number_state(t)
        cur = pup.body19 if num == "19" else None
        self.draw_layer(img, pup.layers["body"], Mb, look, lit, rim_k, img_override=cur)
        if flip_p is not None:  # พลิกแบบป้ายพลิก: ครึ่งบนของเลขเดิมพับลง → ครึ่งล่างของเลขใหม่ตามลงมาปิด
            x0, y0, x1, y1 = pup.number_box
            ym = (y0 + y1) // 2
            old_L = pup.body19 if num == "19" else pup.layers["body"]
            new_L = pup.body19 if num == "10" else pup.layers["body"]
            body = pup.layers["body"]

            def part(L, ya, yb, shade):
                im = L["img"][ya - L["off"][1]:yb - L["off"][1], x0 - L["off"][0]:x1 - L["off"][0]].astype(np.float32)
                im[..., :3] *= shade
                return dict(img=np.clip(im, 0, 255).astype(np.uint8), aux=np.zeros(im.shape[:2] + (4,), np.uint8), off=(x0, ya))

            def fold(c):  # ย่อแนวตั้งเข้าหาเส้นกลางป้าย
                return Mb @ np.array([[1, 0, 0], [0, c, ym * (1 - c)], [0, 0, 1]], np.float64)

            p = clamp(flip_p)
            self.draw_layer(img, body, Mb, look, lit, 0.0, img_override=part(new_L, y0, ym, 1.0))
            if p < 0.5:
                q = p / 0.5
                self.draw_layer(img, body, fold(max(0.03, math.cos(q * math.pi / 2))), look, lit, 0.0, img_override=part(old_L, y0, ym, 1 - 0.45 * q))
            else:
                q = (p - 0.5) / 0.5
                self.draw_layer(img, body, fold(max(0.03, math.sin(q * math.pi / 2))), look, lit, 0.0, img_override=part(new_L, ym, y1, 0.55 + 0.45 * q))
            seam = np.zeros((3, x1 - x0, 4), np.uint8)
            seam[..., 3] = int(150 * math.sin(p * math.pi))
            self.draw_layer(img, body, Mb, look, lit, 0.0, img_override=dict(img=seam, aux=np.zeros_like(seam), off=(x0, ym - 1)))
            fl = math.sin(p * math.pi)
            px, py = self.to_screen(Mb, ((x0 + x1) / 2, ym))
            fx.add_mono(img, gfx.flare(int((y1 - y0) * s * 1.8)), px, py, (1, 0.97, 0.9), 0.6 * fl)
        self.draw_layer(img, pup.layers["head"], T @ P["head"], look, lit, rim_k)

    FLIP_PRE, FLIP_POST = 0.22, 0.06  # ป้ายพลิกเริ่มก่อนจุด flip และ "แปะ" ลงหลังจุด flip เล็กน้อย (ตรงกับเสียงแปะใน sfx)

    def number_state(self, t):
        """เลขหลังเสื้อ ณ เวลา t → ('19'|'10', ความคืบหน้าการพลิก หรือ None)"""
        a0, a1 = self.FLIP_PRE, self.FLIP_POST
        for a in self.tl.active(t, ("number",)):
            seq = a["seq"]
            flips = a.get("flip", [])
            flips = flips if isinstance(flips, list) else [flips]
            idx = sum(1 for f in flips if t >= f + a1)
            for f in flips:
                if f - a0 <= t < f + a1:
                    return seq[min(idx, len(seq) - 1)], (t - (f - a0)) / (a0 + a1)
            return seq[min(idx, len(seq) - 1)], None
        return "10", None

    # ------------------------------------------------------------ things around the puppet
    def trophy_anchor(self):
        """จุดเหนือหัวระหว่างนิ้วชี้ทั้งสอง (พิกัดจอ) + ความสูงถ้วย"""
        pup = self.pup
        tl_, tr_ = pup.tips["arm_l"], pup.tips["arm_r"]
        x, _ = self.to_screen(self.T, ((tl_[0] + tr_[0]) / 2, 0))
        _, hy = self.to_screen(self.T, pup.head_top)
        _, s = self.puppet_T()
        hgt = 0.36 * pup.body_h * s
        return x, hy - 0.025 * self.H - hgt / 2, hgt

    def trophy(self, img, t, a):
        mode, u = a["mode"], t - a["t"]
        if u < 0 or u > a["dur"]:
            return
        x, y, hgt = self.trophy_anchor()
        alpha, glow, blur, sc, dissolve = 1.0, 1.0, 0.0, 1.0, 0.0
        H = self.H
        if mode == "pass":
            # ลอยลงมาอยู่ตรงหน้า (นิ้วชี้ไปที่ถ้วย) → นาที 113 ลอยขึ้นหนีไป สีจาง
            q0 = smooth(u / 0.9)
            alpha, y = q0, y - 0.03 * H * (1 - ease_out(u / 0.9)) + 0.006 * H * math.sin(u * 1.7)
            if u > 3.0:  # ลอยขึ้นหนีให้เห็นระยะที่ห่างออกก่อน แล้วค่อยจางหาย
                q = clamp((u - 3.0) / 2.4)
                y -= 0.20 * H * ease_in_out(q)
                alpha *= 1 - smooth(clamp((q - 0.4) / 0.6))
                blur, sc, glow = 1.4 * q, 1 - 0.2 * q, 1 - q
        elif mode == "arrive":
            # ลงมาจากฟ้า มาหยุดเหนือหัว แล้ว (ตั้งแต่วินาทีที่ 3.9) ลอยขึ้นไปกลายเป็นดาวดวงที่ 3
            q = back_out(clamp(u / 1.0), 1.1)
            y = lerp(-0.12 * H, y, q) + 0.005 * H * math.sin(u * 2.1)
            glow = 1.4
            if 0.9 < u < 1.4:
                fx.add_mono(img, gfx.flare(int(0.5 * H)), x, y, PALETTE["gold"], 1.3 * (1 - (u - 0.9) / 0.5))
            if u > 3.9:
                k = ease_in_out(clamp((u - 3.9) / 0.7))
                sx_, sy_ = CX * self.W + int(0.032 * H) * 1.25, POS_Y["top2"] * H
                x, y = lerp(x, sx_, k), lerp(y, sy_, k)
                sc = lerp(1.0, 0.032 * H / hgt, k)
                alpha = 1 - smooth((k - 0.7) / 0.3)
                if u > 4.65:
                    return
        elif mode == "dissolve":
            alpha = smooth(u / 0.9) * 0.92
            y += 0.006 * H * math.sin(u * 1.7)
            dissolve = clamp((u - 1.5) / 1.4)
        sp = gfx.trophy(max(8, int(hgt * sc)))
        if mode != "pass" or u < 3.0:  # แสงสะท้อนวิ่งพาดผิวโลหะ (เฉียงจากล่างซ้ายขึ้นขวา) ทุก ~2.6 วินาที
            hs, ws = sp.shape[:2]
            key = ("tsheen", sp.shape)
            if key not in self._cache:
                yy, xx = np.mgrid[0:hs, 0:ws].astype(np.float32)
                self._cache[key] = (xx / ws - 0.5) * 0.9 - (yy / hs - 0.5) * 0.55
            pos = ((u + 0.4) / 2.6) % 1.0 * 1.9 - 0.95
            d = self._cache[key]
            band = ne.evaluate("exp(-((d - pos) / 0.06) ** 2) * 0.8 + exp(-((d - pos + 0.13) / 0.025) ** 2) * 0.35")
            sp = sp.copy()  # sprite มาจาก cache ห้ามแก้ตรง ๆ
            sp[..., :3] += (band * sp[..., 3])[..., None] * np.float32((1.0, 0.94, 0.78))
        if blur > 0:  # เผื่อขอบก่อนเบลอ ไม่งั้นฐานถ้วยโดนกรอบ sprite ตัดเป็นเส้นตรง
            pd = int(3 * blur * 0.01 * H) + 2
            sp = fx.blur_fast(cv2.copyMakeBorder(sp, pd, pd, pd, pd, cv2.BORDER_CONSTANT, value=0), blur * 0.01 * H)
        if glow > 0:
            fx.add_mono(img, gfx.soft_dot(int(hgt * 1.6)), x, y, PALETTE["gold"], 0.25 * glow * alpha)
        if dissolve > 0:
            key = ("dnoise", sp.shape)
            if key not in self._cache:
                n = np.random.default_rng(9).random((max(2, sp.shape[0] // 22), max(2, sp.shape[1] // 22))).astype(np.float32)
                n = cv2.resize(n, (sp.shape[1], sp.shape[0]), interpolation=cv2.INTER_CUBIC)
                yy = np.linspace(0, 1, sp.shape[0], dtype=np.float32)[:, None]
                self._cache[key] = np.clip(0.55 * n + 0.45 * yy, 0, 1)  # ละลายจากบนลงล่าง
            nz = self._cache[key]
            th = dissolve * 1.15 - 0.08
            m = np.clip((nz - th) / 0.08, 0, 1)
            edge = np.clip(1 - np.abs(nz - th) / 0.05, 0, 1) * (sp[..., 3] > 0.05)
            sp = sp * m[..., None]
            fx.add_mono(img, edge.astype(np.float32), x, y, PALETTE["gold"], 1.8 * (1 - 0.5 * dissolve))
        fx.blit(img, sp, x, y, alpha)
        if mode != "pass" or u < 3.0:  # ประกายบนโลหะ
            gl = (math.sin(t * 3.1) * 0.5 + 0.5) ** 8
            fx.add_mono(img, gfx.flare(int(0.12 * H)), x - 0.06 * hgt, y - 0.28 * hgt, (1, 0.95, 0.8), 0.8 * gl * alpha * (1 - dissolve))

    def armband(self, img, t, a):
        k = env(t, a["t"], a["dur"], 0.01, 0.3)
        if k <= 0:
            return
        sc = back_out(clamp((t - a["t"]) / 0.35))
        px, py = self.to_screen(self.T, self.pup.armband)
        _, s = self.puppet_T()
        size = 0.10 * self.pup.body_h * s
        pulse = 0.6 + 0.4 * math.sin((t - a["t"]) * 5)
        fx.add_mono(img, gfx.soft_dot(int(size * 3.2)), px, py, PALETTE["celeste"], 0.45 * k * pulse)
        fx.blit(img, gfx.armband(max(4, int(size * sc))), px, py - size * 0.9, k)

    def motes(self, img, t, a, kind):
        """dust = ฝุ่นลอยช้า · ember = แสงทองแห่งความหวังเหนือหัว · rising = ประกายทองลอยขึ้นฟ้า"""
        u = t - a["t"]
        k = env(t, a["t"], a["dur"], 0.5, 0.6)
        if k <= 0:
            return
        tx, ty, hgt = self.trophy_anchor()
        if kind == "ember":
            q = clamp(u / a["dur"])
            fx.add_mono(img, gfx.flare(int((0.05 + 0.5 * q ** 2) * self.H)), tx, ty, PALETTE["gold"], 0.4 + 1.6 * q ** 2)
            return
        rng = self._a(a)
        n = 90 if kind == "dust" else 170
        col = (1.0, 0.95, 0.85) if kind == "dust" else PALETTE["gold"]
        for i in range(n):
            sp, ph, sz = rng.uniform(0.01, 0.05), rng.uniform(0, 6.28), rng.uniform(0.003, 0.009)
            if kind == "dust":
                x0, y0 = rng.uniform(0, 1), rng.uniform(0, 1)
                x, y = x0 + 0.01 * math.sin(u * 0.7 + ph), (y0 + sp * u * 0.6) % 1.05
                px, py, z = self.cam(x, y, 1.1)
            else:
                d0 = rng.uniform(0, 1.6)
                uu = u - d0
                if uu < 0:
                    continue
                ox, oy = rng.normal(0, 0.35) * hgt, rng.normal(0, 0.45) * hgt
                px = tx + ox * (1 + 0.6 * uu) + 0.02 * self.W * math.sin(uu * 1.3 + ph)
                py = ty + oy - (0.05 + sp * 2) * self.H * uu
                z = 1.0
            tw = 0.5 + 0.5 * math.sin(u * 3 + ph * 3)
            fx.add_mono(img, gfx.soft_dot(int(sz * self.H * 2.5 * z)), px, py, col, k * tw * 0.9)

    def confetti(self, img, t, a):
        u = t - a["t"]
        if u < 0 or u > a["dur"] + 0.5:
            return
        rng = self._a(a)
        gentle = a.get("mode") == "gentle"
        n = 160 if gentle else 420
        cols = ([PALETTE["celeste"], PALETTE["white"], PALETTE["celeste"], PALETTE["gold"]] if gentle
                else [PALETTE["gold"], PALETTE["celeste"], PALETTE["white"], PALETTE["gold_deep"]])
        fo = a.get("fade", 0.6)  # ช่วงจาง: ยาวขึ้น = คอนเฟตตีค่อย ๆ บางลงจนหมด (S23 ร่วงหมดก่อนเสียงนกหวีด)
        fade = 1 - smooth((u - a["dur"] + fo) / fo)
        H = self.H
        tx, ty, _ = self.trophy_anchor()
        for i in range(n):
            burst = (not gentle) and i < n * 0.55
            if burst:  # ระเบิดออกจากถ้วย
                ang = rng.uniform(-math.pi * 0.95, -math.pi * 0.05)
                spd = rng.uniform(0.5, 1.5)
                x0, y0 = tx / self.W + rng.normal(0, 0.03), ty / H + rng.normal(0, 0.02)
                vx, vy = math.cos(ang) * spd * 0.7, math.sin(ang) * spd
                t0 = rng.uniform(0, 0.15)
            else:
                x0, y0 = rng.uniform(-0.05, 1.05), rng.uniform(-0.25, -0.02)
                vx, vy = rng.normal(0, 0.03), rng.uniform(0.10, 0.22) if gentle else rng.uniform(0.15, 0.3)
                t0 = rng.uniform(0, a["dur"] * (0.8 if gentle else 0.5))
            ph, fr, sz = rng.uniform(0, 6.28), rng.uniform(2, 7), rng.uniform(0.005, 0.011)
            keep = rng.random()
            col = np.float32(cols[i % len(cols)])
            tt = u - t0
            if tt < 0 or keep > fade:  # ตอนจาง ค่อย ๆ หายไปทีละชิ้น (ระบายสีทึบ ห้ามหรี่จนเป็นจุดดำ)
                continue
            dr = 2.2  # แรงต้านอากาศ + แรงโน้มถ่วง → ร่วงช้าแบบกระดาษ
            ex = (1 - math.exp(-dr * tt)) / dr
            x = x0 + vx * ex + 0.02 * math.sin(tt * 2.3 + ph)
            y = y0 + vy * ex + 0.16 * (tt - ex)
            if y > 1.1 or x < -0.1 or x > 1.1:
                continue
            px, py, z = (x * self.W, y * H, 1.0) if burst else self.cam(x, y, 1.15)
            flip = math.cos(tt * fr + ph)
            rot = tt * fr * 0.7 + ph
            L, Wd = sz * H * z, sz * H * z * 0.55 * max(0.08, abs(flip))
            c, s = math.cos(rot), math.sin(rot)
            pts = np.array([[-L, -Wd], [L, -Wd], [L, Wd], [-L, Wd]], np.float32) @ np.float32([[c, s], [-s, c]]) + (px, py)
            shine = 0.75 + 0.45 * abs(flip)
            cv2.fillConvexPoly(img, np.round(pts * 4).astype(np.int32), tuple(float(v) for v in col * shine), lineType=cv2.LINE_AA, shift=2)

    def sweep(self, img, t, a):
        q = clamp((t - a["t"]) / a["dur"])
        if q <= 0 or q >= 1:
            return
        ys, xs = np.nonzero(self.hero_a[::8, ::8] > 0.02)
        if not len(ys):
            return
        y0, y1, x0, x1 = ys.min() * 8, min(self.H, ys.max() * 8 + 8), xs.min() * 8, min(self.W, xs.max() * 8 + 8)
        yy, xx = np.ogrid[y0:y1, x0:x1]
        band = ((xx - x0) / max(1, x1 - x0) * 0.8 + (yy - y0) / max(1, y1 - y0) * 0.6).astype(np.float32) - lerp(-0.3, 1.7, ease_in_out(q))
        sheen = np.exp(-(band / 0.12) ** 2) * self.hero_a[y0:y1, x0:x1]
        # ผสมแบบ screen: เติมแสงเฉพาะส่วนที่ยังไม่สว่าง → แสงอุ่นลูบขอบตัวต่อ ไม่ทำให้มือ/หัวขาวโพลน
        sub = img[y0:y1, x0:x1]
        add = sheen[..., None] * np.float32(a.get("color", (1.0, 0.86, 0.66))) * np.float32(a.get("gain", 0.5))
        img[y0:y1, x0:x1] = sub + add * np.clip(1 - sub, 0, 1)

    # ------------------------------------------------------------ text (screen space)
    def _put(self, img, sp, x, y, alpha):
        fx.blit(img, sp, x * self.W, y * self.H, alpha)

    def _block(self, text, key, px, color, tracking, shadow, max_w=0.84):
        """ตัวหนังสือหลายบรรทัด (แยกด้วย \n) จัดกึ่งกลาง ย่อเองถ้ากว้างเกิน"""
        ck = ("block", text, key, px, color, tracking, shadow, max_w, self.W)
        if ck in self._cache:
            return self._cache[ck]
        lines = [gfx.text_sprite(ln, key, px, color, tracking, shadow) for ln in text.split("\n")]
        gap = int(px * 0.12)
        Wd = max(l.shape[1] for l in lines)
        Hd = sum(l.shape[0] for l in lines) + gap * (len(lines) - 1)
        sp = np.zeros((Hd, Wd, 4), np.float32)
        y = 0
        for l in lines:
            x = (Wd - l.shape[1]) // 2
            sp[y:y + l.shape[0], x:x + l.shape[1]] = np.maximum(sp[y:y + l.shape[0], x:x + l.shape[1]], l)
            y += l.shape[0] + gap
        if sp.shape[1] > max_w * self.W:
            sp = gfx.resize_sprite(sp, sp.shape[0] * max_w * self.W / sp.shape[1])
        self._cache[ck] = sp
        return sp

    def text(self, img, t, a):
        style = a.get("style", "line")
        k = env(t, a["t"], a["dur"], 0.28 if style != "script" else 0.45, 0.25 if style != "script" else 0.4)
        if k <= 0:
            return
        y = a.get("y", POS_Y[a.get("pos", "upper")])
        q = ease_out((t - a["t"]) / 0.45)
        H = self.H
        if style == "kicker":
            sp = self._block(a["text"], "ui", int(0.0215 * H), (0.95, 0.95, 0.95), 0.16, 0.7, a.get("max_w", 0.76))  # แกน CX=0.47 → กว้างได้ไม่เกิน 0.76 ไม่ล้นเขต 86%
            self._put(img, sp, CX, y + 0.006 * (1 - q), k * 0.95)
        elif style == "line":
            sp = self._block(a["text"], "display", int(0.058 * H), (1.0, 1.0, 1.0), 0.015, 0.85, a.get("max_w", 0.76))
            self._put(img, sp, CX, y + 0.012 * (1 - q), k)
        elif style == "script":
            q = ease_out((t - a["t"]) / 0.9)
            sp = self._block(a["text"], "script", int(0.050 * H), (1.0, 0.97, 0.92), 0.0, 0.8, a.get("max_w", 0.805))  # รวมขอบเผื่อ ~0.09 → ตัวอักษรจริงไม่เกิน ~0.72 ของจอ ขอบขวาไม่ล้น 0.86
            self._put(img, sp, CX, y + 0.008 * (1 - q), k)
        elif style == "date":
            n = len(a["text"])
            shown = a["text"][:max(1, int(clamp((t - a["t"]) / 0.6) * n + 0.999))]
            full = gfx.text_sprite(a["text"], "ui_medium", int(0.046 * H), (1, 1, 1), 0.08, 0.7)
            sp = gfx.text_sprite(shown, "ui_medium", int(0.046 * H), (1, 1, 1), 0.08, 0.7)
            self._put(img, sp, CX - (full.shape[1] - sp.shape[1]) / 2 / self.W, y, k)

    def bignum(self, img, t, a):
        k = env(t, a["t"], a["dur"], 0.12, 0.3)
        if k <= 0:
            return
        seq = a["seq"]
        flips = a.get("flip", [])
        flips = flips if isinstance(flips, list) else [flips]
        idx = min(sum(1 for f in flips if t >= f), len(seq) - 1)
        sq = 1.0
        for f in flips:  # พลิกแบบป้ายสนาม
            d = t - f
            if -0.1 <= d < 0:
                sq = clamp(-d / 0.1)
            elif 0 <= d < 0.12:
                sq = clamp(d / 0.12)
        hot = seq[idx].endswith("'")
        sp = gfx.text_sprite(seq[idx], "display", int(0.105 * self.H), (1.0, 1.0, 1.0) if hot else PALETTE["gold"], 0.02, 0.9)
        sc = 1.0
        if a.get("slam") or any(0 <= t - f < 0.2 for f in flips):
            t0 = a["t"] if a.get("slam") and t - a["t"] < 0.3 else max([f for f in flips if f <= t], default=a["t"])
            sc = 1 + 0.35 * (1 - ease_out((t - t0) / 0.28))
        s2 = gfx.resize_sprite(sp, sp.shape[0] * sc)
        if sq < 0.999:
            s2 = cv2.resize(s2, (s2.shape[1], max(2, int(s2.shape[0] * max(0.03, sq)))), interpolation=cv2.INTER_AREA)
        y = POS_Y[a.get("pos", "upper")] + (0.015 if a.get("pos", "upper") != "top" else 0.02)
        self._put(img, s2, CX, y, k)

    def score(self, img, t, a):
        k = env(t, a["t"], a["dur"], 0.12, 0.25)
        if k <= 0:
            return
        H = self.H
        key = ("score", a["text"], H)
        if key not in self._cache:
            txt = gfx.text_sprite(a["text"], "ui", int(0.028 * H), (1, 1, 1), 0.06)
            ph, pw = int(txt.shape[0] + 0.026 * H), int(txt.shape[1] + 0.055 * H)
            m = np.zeros((ph, pw), np.uint8)
            rad = int(0.011 * H)
            cv2.rectangle(m, (rad, 0), (pw - rad, ph - 1), 255, -1)
            cv2.rectangle(m, (0, rad), (pw - 1, ph - rad), 255, -1)
            for c_ in ((rad, rad), (pw - rad, rad), (rad, ph - rad), (pw - rad, ph - rad)):
                cv2.circle(m, c_, rad, 255, -1, lineType=cv2.LINE_AA)
            al = m.astype(np.float32) / 255
            panel = np.zeros((ph, pw, 4), np.float32)
            panel[..., :3] = np.float32(PALETTE["navy"]) * (al * 0.8)[..., None]
            panel[..., 3] = al * 0.8
            bar = int(0.007 * H)
            panel[:, :bar, :3] = np.float32(PALETTE["celeste"]) * al[:, :bar, None]
            panel[:, :bar, 3] = al[:, :bar]
            oy, ox = (ph - txt.shape[0]) // 2, (pw - txt.shape[1]) // 2 + bar // 2
            sub = panel[oy:oy + txt.shape[0], ox:ox + txt.shape[1]]
            sub *= 1 - txt[..., 3:4]
            sub += txt
            self._cache[key] = panel
        sp = self._cache[key]
        if a.get("slam"):
            sp = gfx.resize_sprite(sp, sp.shape[0] * (1 + 0.3 * (1 - ease_out((t - a["t"]) / 0.22))))
        self._put(img, sp, CX, POS_Y[a.get("pos", "top2")], k)

    def counter(self, img, t, a):
        k = env(t, a["t"], a["dur"] + 0.6, 0.2, 0.3)
        if k <= 0:
            return
        a0, a1 = int(a["from"]), int(a["to"])
        steps = a1 - a0
        times = [self.tl.beat.snap(a["t"] + i * a["dur"] / max(1, steps), "beat", 0.25) for i in range(steps + 1)]
        i = max(0, sum(1 for x in times if t >= x) - 1)
        pop = 1 + 0.18 * (1 - ease_out((t - times[i]) / 0.2)) if t >= times[0] else 1
        v, suf = a0 + i, a.get("suffix", "")
        if v == 1 and suf.endswith("S"):
            suf = suf[:-1]  # 1 GOAL ไม่ใช่ 1 GOALS
        sp = gfx.text_sprite(f"{v}{suf}", "display", int(0.058 * self.H), (1, 1, 1), 0.015, 0.85)
        self._put(img, gfx.resize_sprite(sp, sp.shape[0] * pop), CX, POS_Y[a.get("pos", "upper")], k)

    def listing(self, img, t, a):
        items, labels = a["items"], a.get("labels", [])
        times = [self.tl.beat.snap(a["t"] + i * a.get("step", 0.7), "beat", 0.25) for i in range(len(items))]
        i = sum(1 for x in times if t >= x) - 1
        if i < 0 or t > a["t"] + a["dur"]:
            return
        k = env(t, a["t"], a["dur"], 0.1, 0.25)
        q = ease_out((t - times[i]) / 0.25)
        sp = gfx.text_sprite(items[i], "display", int(0.058 * self.H), (1, 1, 1), 0.015, 0.85)
        self._put(img, sp, CX, POS_Y["upper2"] + 0.01 * (1 - q), k * q)
        if i < len(labels):
            lb = gfx.text_sprite(labels[i], "ui", int(0.019 * self.H), PALETTE["celeste"], 0.2, 0.7)
            self._put(img, lb, CX, POS_Y["upper"], k * q)

    def odometer(self, img, t, a, stars_on):
        k = env(t, a["t"], a["dur"], 0.12, 0.4)
        if k <= 0:
            return
        frm, to = a.get("from", "    "), a["to"]
        px = int(0.070 * self.H)
        cell = gfx.glyph_cell("0", "display", px)
        ch, cw = cell.shape[:2]
        x0 = CX * self.W - cw * len(to) / 2
        yc = POS_Y["top"] * self.H
        u = t - a["t"]
        for i, ta in enumerate(to):
            fa = frm[i] if i < len(frm) else " "
            p = ease_in_out((u - 0.08 * i) / 0.75)  # หมุนทีละหลักเหมือนป้ายสนาม
            if fa == ta:
                seq, q = [ta], 0.0
            elif fa == " ":
                seq, q = [" ", ta], p
            else:  # เลื่อนจากเลขเดิมไปเลขใหม่ทีเดียว (ไม่ไล่ผ่านเลขกลาง ๆ — กันเห็นปีอื่นแวบขึ้นมา เช่น 2018 ระหว่าง 2006→2010)
                seq, q = [fa, ta], p
            j = min(int(math.floor(q)), len(seq) - 1)
            f = q - j
            canvas = np.zeros((ch, cw, 4), np.float32)
            for jj, o in ((j, -f), (j + 1, 1 - f)):
                if jj >= len(seq) or seq[jj] == " ":
                    continue
                g = gfx.glyph_cell(seq[jj], "display", px)
                oy = int(round(o * ch))
                if abs(oy) >= ch:
                    continue
                if oy >= 0:
                    canvas[oy:] += g[:ch - oy]
                else:
                    canvas[:ch + oy] += g[-oy:]
            if 0 < f < 1:
                canvas = cv2.blur(canvas, (1, max(1, int(ch * 0.12 * math.sin(f * math.pi)))))
            fx.blit(img, np.clip(canvas, 0, 1), x0 + cw * (i + 0.5), yc, k)
        era = self.tl.era_at(t)
        if era["label"] and not stars_on:
            lb = gfx.text_sprite(era["label"], "ui", int(0.0175 * self.H), PALETTE["celeste"], 0.32, 0.6)
            land = 0.08 * (len(to) - 1) + 0.75  # ชื่อประเทศขึ้นหลังหลักสุดท้ายหมุนเสร็จ ไม่โดนตัวเลขที่กำลังหมุนทับ
            self._put(img, lb, CX, POS_Y["top2"] - 0.006, k * smooth((u - land) / 0.3))

    def stars(self, img, t, a):
        k = env(t, a["t"], a["dur"], 0.2, 0.3)
        if k <= 0:
            return
        n0, n1 = a.get("from", 2), a.get("to", 3)
        sz = int(0.032 * self.H)
        y = POS_Y["top2"] * self.H
        for i in range(n1):
            x = CX * self.W + (i - (n1 - 1) / 2) * sz * 1.25
            if i < n0:
                fx.blit(img, gfx.star(sz), x, y, k)
                continue
            q = clamp((t - a["t"] - 0.45) / 0.35)  # ดาวดวงที่ 3 ตกลงมาพร้อมแสงวาบ (ทับเฟรมสุดท้ายของถ้วยที่หดลง)
            if q <= 0:
                continue
            fx.add_mono(img, gfx.flare(int(sz * 5 * (1.2 - q))), x, y, PALETTE["gold"], 1.2 * (1 - q) + 0.25)
            fx.blit(img, gfx.star(int(sz * (1 + 1.5 * (1 - ease_out(q))))), x, y, k * q)

    # ------------------------------------------------------------ frame
    # ------------------------------------------------------------ stadium (world, half-res)
    def _stadium_base(self):
        """อัฒจันทร์ทรงชาม มองจากในสนาม: ชั้นที่นั่ง (ฝูงคน) · ขอบชั้นเรืองแสง · ไฟหลังคา · หญ้า
        เก็บเป็นช่องขาวดำ แล้วค่อยลงสีตามยุคทุกเฟรม"""
        key = ("stadium", self.hh)
        if key in self._cache:
            return self._cache[key]
        h, w = self.hh, self.hw
        rng = np.random.default_rng(21)
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        Y, nx = yy / h, xx / w - CX
        bounds = [(0.585, 0.10), (0.50, 0.14), (0.415, 0.18), (0.335, 0.22), (0.27, 0.26), (0.215, 0.30)]
        curves = [y0 - a * nx ** 2 * 4 for y0, a in bounds]
        stands = ((Y < curves[0]) & (Y > curves[-1])).astype(np.float32)
        roof = ((Y <= curves[-1]) & (Y > curves[-1] - 0.05)).astype(np.float32)
        pitch = (Y >= curves[0]).astype(np.float32)
        # ฝูงคน: จุดสีสุ่มหนาแน่น เรียงเป็นแถวที่นั่งตามแนวโค้งของแต่ละชั้น
        crowd = np.zeros((h, w), np.float32)
        n = int(w * h * 0.16)
        crowd[rng.integers(0, h, n), rng.integers(0, w, n)] = rng.uniform(0.1, 1.0, n).astype(np.float32)
        crowd = cv2.GaussianBlur(crowd, (0, 0), 0.9) * 2.2
        row_phase = (Y + 0.30 * nx ** 2 * 4) * h / max(2.0, h * 0.0045)
        rows = 0.55 + 0.45 * (np.sin(row_phase * np.pi) > -0.2)
        crowd = np.clip(crowd * rows, 0, 1.2) * stands * (0.5 + 0.5 * np.clip((Y - 0.2) / 0.4, 0, 1))
        # ขอบหน้าชั้น: ป้ายไฟเป็นช่วง ๆ (ไม่ใช่วงต่อเนื่อง)
        edges = np.zeros((h, w), np.float32)
        for j, c in enumerate(curves[1:-1]):
            seg = (np.sin(nx * (40 + 9 * j) + j) > -0.35).astype(np.float32)
            edges += np.exp(-((Y - c) * h / 1.6) ** 2) * seg * (0.5 + 0.5 * (j % 2))
        roof_l = np.zeros((h, w), np.float32)
        for k in range(70):
            x = (k + 0.5) / 70
            yv = bounds[-1][0] - 0.095 - bounds[-1][1] * ((x - CX) ** 2) * 4  # สูงพ้นช่องตัวหนังสือ top/top2 (ไม่ร้อยผ่านตัวอักษร)
            cv2.circle(roof_l, (int(x * w), int(yv * h)), max(1, int(h * 0.0025)), 1.0, -1, lineType=cv2.LINE_AA)
        stripes = (np.sin((1 / np.maximum(Y - 0.5, 0.02)) * 3.2) > 0).astype(np.float32)
        pitch_t = pitch * (0.8 + 0.2 * stripes) * np.clip((Y - 0.58) / 0.3 + 0.4, 0, 1)
        structure = np.clip(stands + roof, 0, 1)
        A = cv2.GaussianBlur(np.dstack([crowd, edges, roof_l, structure]), (0, 0), 0.6)
        B = cv2.GaussianBlur(pitch_t, (0, 0), 0.8)
        self._cache[key] = (np.ascontiguousarray(A), np.ascontiguousarray(B))
        return self._cache[key]

    def _pylons_base(self):
        """เสาไฟสนาม 4 ต้นยืนหลังอัฒจันทร์ (ส่วนล่างจะถูกอัฒจันทร์บังเอง) → (ตัวเสา, หลอดไฟ, แสงฟุ้ง)"""
        key = ("pylons", self.hh)
        if key in self._cache:
            return self._cache[key]
        h, w = self.hh, self.hw
        mast, lamps = np.zeros((h, w), np.float32), np.zeros((h, w), np.float32)
        for xc, top, lean in ((CX - 0.30, 0.040, 0.020), (CX - 0.19, 0.080, 0.010), (CX + 0.19, 0.080, -0.010), (CX + 0.30, 0.040, -0.020)):
            # เสาเอียงเข้าหากลางสนามนิดหน่อย ปลายบนเป็นแผงไฟ 5 x 3 ดวง
            x_top, x_bot = (xc + lean) * w, xc * w
            cv2.line(mast, (int(x_bot), int(0.40 * h)), (int(x_top), int((top + 0.02) * h)), 1.0, max(1, int(0.0035 * h)), cv2.LINE_AA)
            pw, ph = 0.075 * w, 0.022 * h
            x0, y0 = x_top - pw / 2, top * h - ph / 2
            cv2.rectangle(mast, (int(x0 - 2), int(y0 - 2)), (int(x0 + pw + 2), int(y0 + ph + 2)), 1.0, -1)
            for r in range(3):
                for c in range(5):
                    cx_, cy_ = x0 + (c + 0.5) * pw / 5, y0 + (r + 0.5) * ph / 3
                    cv2.circle(lamps, (int(cx_), int(cy_)), max(1, int(0.0045 * h)), 1.0, -1, cv2.LINE_AA)
        mast = cv2.GaussianBlur(mast, (0, 0), 0.6)
        glow = cv2.GaussianBlur(lamps, (0, 0), 0.02 * h) * 6.0 + cv2.GaussianBlur(lamps, (0, 0), 0.004 * h) * 1.5
        self._cache[key] = (mast, lamps, glow)
        return self._cache[key]

    def stadium(self, bg, look, amount, expand):
        if amount <= 0.01:
            return
        A, B = self._stadium_base()
        h, w = self.hh, self.hw
        M = cv2.getRotationMatrix2D((CX * w, 0.62 * h), 0, expand)
        py_k = look.get("pylons", 0.0) * amount
        if py_k > 0.01:  # วาดก่อนอัฒจันทร์ ตัวอัฒจันทร์จะบังโคนเสาเอง
            mast, lamps, glow = (cv2.warpAffine(c, M, (w, h)) for c in self._pylons_base())
            dark = np.float32(look["bg_top"]) * np.float32(0.6)
            lamp_c = np.float32((1.0, 0.97, 0.9)) * np.float32(1.3 * py_k)
            glow_c = np.float32(look["rim"]) * np.float32(0.22 * py_k)
            pk = np.float32(py_k)
            m3, l3, g3 = mast[..., None], lamps[..., None], glow[..., None]
            bg[:] = ne.evaluate("bg * (1 - pk * m3) + pk * m3 * dark + l3 * lamp_c + g3 * glow_c")
        A = cv2.warpAffine(A, M, (w, h), borderMode=cv2.BORDER_REPLICATE)
        B = cv2.warpAffine(B, M, (w, h), borderMode=cv2.BORDER_REPLICATE)
        crowd, edges, roof_l, structure = A[..., 0:1], A[..., 1:2], A[..., 2:3], A[..., 3:4]
        dark = np.float32(look["bg_top"]) * 0.8 + np.float32(look["bg_bottom"]) * 0.15
        fin = look.get("pylons", 0.0)  # นัดชิง (2014/2022): อัฒจันทร์ใหญ่ต้องอ่านออก
        crowd_c = np.float32(look["bokeh"][0]) * np.float32((0.10 + 0.30 * amount) * (1 - fin) + (0.15 + 0.55 * amount) * fin)
        rim = np.float32(look["rim"]) * np.float32((0.35 + 0.25 * fin) * amount)
        roof_c = np.float32((1.0, 0.96, 0.88)) * np.float32(1.1 * amount * smooth((amount - 0.25) / 0.4))  # ไฟหลังคาขึ้นพร้อมอัฒจันทร์ ไม่ลอยเดี่ยวเป็นเส้นจุด
        pitch_c = np.float32((0.03, 0.10, 0.05)) * np.float32(0.5 + 0.8 * amount)
        Bp = B[..., None]
        a = np.float32(amount)
        bg[:] = ne.evaluate("bg * (1 - a * structure) * (1 - a * Bp * 0.85) + a * (structure * dark + crowd * crowd_c + Bp * pitch_c)"
                            " + edges * rim + roof_l * roof_c")

    def lightpulse(self, bg, t, a):
        """สนามสว่างวาบเป็นจังหวะ (หนึ่งครั้งต่อหนึ่งนัดที่ชนะ)"""
        times = [self.tl.beat.snap(a["t"] + i * a.get("step", 0.7), "beat", 0.25) for i in range(a.get("count", 4))]
        last = max([x for x in times if x <= t], default=None)
        if last is None:
            return
        k = math.exp(-(t - last) / 0.22)
        bg += np.float32((0.55, 0.45, 0.30)) * np.float32(0.35 * k)
        px, py, z = self.cam(CX, 0.2, 0.45)
        fx.add_mono(bg, gfx.flare(int(0.5 * self.hh)), px / 2, py / 2, (1.0, 0.95, 0.85), 0.9 * k)

    # ------------------------------------------------------------ foreground extras
    def ball(self, img, t, a):
        u = t - a["t"]
        if u < 0 or u > a["dur"]:
            return
        H, W = self.H, self.W
        if a.get("mode") == "whip":
            # ลูกบอลใหญ่พุ่งผ่านหน้ากล้อง เบลอทั้งจากความเร็วและระยะชัด
            q = u / a["dur"]
            x, y = lerp(1.25, -0.3, q) * W, (0.90 - 0.07 * q) * H  # ผ่านใต้เลข 10 ไม่บังชื่อ/เลขบนเสื้อ
            sp = gfx.ball(int(0.24 * H), rot=-q * 260)
            small = cv2.resize(sp, (sp.shape[1] // 4, sp.shape[0] // 4), interpolation=cv2.INTER_AREA)
            klen = max(3, int(small.shape[1] * 0.22))  # เบลอแค่พอรู้ว่าเร็ว ยังเห็นลายลูกบอล
            kern = np.zeros((1, klen), np.float32)
            kern[0, :] = 1.0 / klen
            pad = klen
            small = cv2.copyMakeBorder(small, 0, 0, pad, pad, cv2.BORDER_CONSTANT, value=0)
            small = cv2.filter2D(small, -1, kern)
            small = cv2.GaussianBlur(small, (0, 0), 0.7)
            sp = cv2.resize(small, (small.shape[1] * 4, small.shape[0] * 4), interpolation=cv2.INTER_LINEAR)
            fx.blit(img, sp, x, y, 1.0)
            return
        # roll: ลูกเล็กกลิ้งเข้ามาจากซ้ายแล้วหยุดข้างตัว
        k = ease_out(clamp(u / 1.6))
        bounce = abs(math.sin(u * 7.0)) * math.exp(-u * 2.2) * 0.02
        x = lerp(-0.08, a.get("x_end", 0.28), k)
        y = a.get("y", 0.74) - bounce
        px, py, z = self.cam(x, y, 1.0)
        size = int(0.05 * H * z)
        rot = -(k * 0.28 * W) / (size / 2) * 57.3
        fade = 1 - smooth((u - a["dur"] + 0.4) / 0.4)
        fx.add_mono(img, gfx.soft_dot(int(size * 1.4)), px, py + size * 0.45, (-0.5, -0.5, -0.5), 0.6 * fade)
        fx.blit(img, gfx.ball(size, rot=rot), px, py, fade)

    def occlude(self, img, t, a):
        """เงาดำ (เสา/ฝูงคน) เลื่อนผ่านหน้ากล้อง — ความไม่แน่นอนของปี 2018"""
        u = t - a["t"]
        if u < 0 or u > a["dur"]:
            return
        rng = self._a(a)
        q4 = 4
        h, w = self.H // q4, self.W // q4
        m = np.zeros((h, w), np.float32)
        for i in range(4):
            t0 = rng.uniform(0, a["dur"] * 0.6)
            sp = rng.uniform(0.8, 1.6) * (1 if i % 2 == 0 else -1)
            bw = rng.uniform(0.12, 0.3)
            v = (u - t0) * sp * 0.6
            cx = (-0.3 + v) if sp > 0 else (1.3 + v)
            if -0.4 < cx < 1.4:
                x0, x1 = int((cx - bw / 2) * w), int((cx + bw / 2) * w)
                top = int(rng.uniform(0.0, 0.35) * h)
                cv2.rectangle(m, (x0, top), (x1, h), 1.0, -1)
        if m.max() == 0:
            return
        m = cv2.GaussianBlur(m, (0, 0), w * 0.03)
        m = cv2.resize(m, (self.W, self.H), interpolation=cv2.INTER_LINEAR)[..., None]
        img[:] = ne.evaluate("img * (1 - 0.88 * m)")

    def echo(self, img, t, a):
        """ความทรงจำ: แสงของแต่ละยุคกวาดผ่านตัวต่อเร็ว ๆ ทีละยุค (2006 → 2026)"""
        if self.hero_a is None:
            return
        eras = ["e2006", "e2010", "e2014", "e2018", "e2022", "e2026"]
        q = (t - a["t"]) / a["dur"]
        if not 0 <= q < 1:
            return
        # แถบแสงเดียวเลื่อนช้า ๆ จากหัวลงเท้า สีค่อย ๆ เปลี่ยนตามยุค 2006 → 2026 (ความทรงจำ ไม่ใช่ไฟกะพริบ)
        f = q * (len(eras) - 1)
        i = min(int(f), len(eras) - 2)
        col = np.float32(mix({"c": LOOKS[eras[i]]["rim"]}, {"c": LOOKS[eras[i + 1]]["rim"]}, f - i)["c"])
        ys, xs = np.nonzero(self.hero_a[::8, ::8] > 0.02)
        if not len(ys):
            return
        y0, y1 = ys.min() * 8, min(self.H, ys.max() * 8 + 8)
        x0, x1 = xs.min() * 8, min(self.W, xs.max() * 8 + 8)
        yy = np.arange(y0, y1, dtype=np.float32)[:, None]
        band = np.exp(-(((yy - y0) / max(1, y1 - y0) - lerp(-0.2, 1.2, q)) / 0.30) ** 2).astype(np.float32)
        ha = self.hero_a[y0:y1, x0:x1]
        sub = img[y0:y1, x0:x1]
        g = np.float32(0.18 * math.sin(math.pi * q) ** 0.5)
        img[y0:y1, x0:x1] = sub + (band * ha)[..., None] * col * g * np.clip(1 - sub, 0, 1)

    def photo_frame(self):
        """ภาพถ่ายต้นฉบับ (รวมพื้นดำ) วางด้วยตำแหน่ง/ขนาดเดียวกับหุ่น — สลับไปมาได้แนบเนียน"""
        canvas = np.zeros((self.H, self.W, 3), np.float32)
        r = fx.warp_into((self.H, self.W), self.pup.photo, self.T[:2].astype(np.float32))
        if r is not None:
            roi, ph = r
            canvas[roi] = ph.astype(np.float32) * np.float32(1 / 255)
        return canvas

    # ------------------------------------------------------------ frame
    def frame(self, t, idx=0):
        tl = self.tl
        ea, eb, w = tl.era_blend(t)
        look = mix(LOOKS[ea["id"]], LOOKS[eb["id"]], w)
        self.shot = shot = tl.shot_at(t)
        self.u = (t - shot["start"]) / max(1e-6, shot["end"] - shot["start"])
        cam = shot.get("camera", {})
        z0, z1 = cam.get("zoom", [1.0, 1.0])
        tg = cam.get("target", [[CX, ANCHOR_Y], [CX, ANCHOR_Y]])
        q = ease_in_out(self.u)
        self.zoom = lerp(z0, z1, q)
        self.target = (lerp(tg[0][0], tg[1][0], q), lerp(tg[0][1], tg[1][1], q))
        ob = cam.get("orbit", [0, 0])
        self.orbit_s = math.sin(math.radians(lerp(ob[0], ob[1], q)))
        act = tl.active(t)
        kinds = {a["do"] for a in act}

        # ภาพถ่ายต้นฉบับ: เปิดเรื่อง/ปิดเรื่อง (1 = ภาพจริงล้วน)
        photo = 0.0
        for a in tl.active(t, ("photo",)):
            photo = max(photo, lerp(a.get("from", 1), a.get("to", 1), smooth((t - a["t"]) / max(1e-6, a["dur"]))))

        # ความแรงของการขยับ: ตอนเป็นภาพถ่ายหุ่นนิ่ง แล้วค่อย ๆ มีชีวิต
        self.motion_amt = 1.0 - photo
        for a in tl.actions:
            if a["do"] == "build":
                e = a["t"] + a["dur"]
                if t <= e + 0.6:
                    self.motion_amt = min(self.motion_amt, smooth((t - e) / 0.6))

        shk = cam.get("shake", 0.0)
        for a in act:
            if a.get("slam"):
                shk += 1.6 * max(0.0, 1 - (t - a["t"]) / 0.3)
        for a in tl.active(t, ("heartbeat",)):
            beats = ([b for b in tl.beat.beats if a["t"] <= b <= a["t"] + a["dur"]] if tl.beat.ok
                     else [a["t"] + i * 0.75 for i in range(int(a["dur"] / 0.75) + 1)])
            last = max([b for b in beats if b <= t], default=None)
            if last is not None:
                self.zoom *= 1 + 0.025 * math.exp(-(t - last) / 0.12)
        if tl.beat.ok:  # เตะซูมเบา ๆ บน downbeat ตามแรงเพลง
            self.zoom *= 1 + 0.010 * tl.beat.pulse(t, 0.16, True) * clamp((tl.beat.level(t) - 0.3) / 0.5)
        ts = math.floor(t * 24) / 24
        self.shake = (shk * 0.004 * self.H * (math.sin(ts * 37.1) + 0.6 * math.sin(ts * 23.7 + 1.3)),
                      shk * 0.004 * self.H * (math.sin(ts * 29.3 + 0.7) + 0.6 * math.sin(ts * 41.9)))
        self._haze_boost = 1.0 if "haze" in kinds else 0.0
        self.T, _ = self.puppet_T()

        if photo < 0.999:
            img = self.world(t, idx, look, ea, eb, w, act, kinds)
            if photo > 0.001:
                img = ne.evaluate("img * (1 - p) + ph * p", local_dict=dict(img=img, ph=self.photo_frame(), p=np.float32(photo)))
        else:
            img = self.photo_frame()

        # ---- ตัวหนังสือ
        stars_on = "stars" in kinds
        for a in act:
            d = a["do"]
            if d == "odometer":
                self.odometer(img, t, a, stars_on)
            elif d == "text":
                self.text(img, t, a)
            elif d == "score":
                self.score(img, t, a)
            elif d == "list":
                self.listing(img, t, a)
            elif d == "stars":
                self.stars(img, t, a)
            elif d == "bignum":
                self.bignum(img, t, a)
        for a in tl.active(t, ("counter",), pad=0.6):
            self.counter(img, t, a)

        # ---- ทีวีเก่า กลิตช์ ขอบมืด เกรน แฟลช เฟด
        if photo < 0.999:
            off = 0.0
            for a in tl.active(t, ("crt_off",)):
                off = clamp((t - a["t"]) / a["dur"])
            if look["crt"] > 0.01 or off > 0:
                img = fx.crt(img, look["crt"], t, off)
            for a in tl.active(t, ("glitch",)):
                g = 1.0 if any(s_.get("slam") and 0 <= t - s_["t"] < 0.16 for s_ in tl.active(t, ("score",))) else 0.0
                if g == 0 and (_seed(idx, "g") % 100) < 14:
                    g = 0.35
                img = fx.glitch(img, g, idx)
            vig = look["vignette"] * (1 - photo)
            img = fx.vignette(img, vig)
            img = fx.chroma(img, 0.0015 * (1 - photo))
            img = fx.grain(img, look["grain"] * (1 - photo), idx)
        for a in tl.active(t, ("flash",)):
            img = img + np.float32(1 - ease_out((t - a["t"]) / a["dur"])) * 0.9
        for a in tl.active(t, ("fade_out",)):
            img = img * np.float32(1 - smooth((t - a["t"]) / a["dur"]))
        if self.debug_text:
            sp = gfx.text_sprite(self.debug_text, "ui", int(0.016 * self.H), (1, 0.85, 0.3), 0.04, 0.9)
            fx.blit(img, sp, 0.5 * self.W, 0.975 * self.H, 1.0)
        return fx.to_u8(img)

    def world(self, t, idx, look, ea, eb, w, act, kinds):
        """โลกของเรื่อง: ฉากหลัง → ถ้วย → หุ่น → อนุภาค → เกรดสี (ยังไม่มีตัวหนังสือ)"""
        tl = self.tl
        wd = self.shot.get("world", {})
        # ---- 1 ฉากหลัง (ครึ่งความละเอียด): ไล่สี + อัฒจันทร์ + ไฟเบลอ + หมอก → กล้อง → ไฟที่อยู่บนจอ
        bg = self.background(t, look, ea, eb, w, self.sv(wd, "stadium", 0.5), self.sv(wd, "expand", 1.0), self.sv(wd, "bokeh", 1.0))
        bg = self._bg_cam(bg)
        for a in act:
            d = a["do"]
            if d == "flashbulbs":
                self.flashbulbs(bg, t, a)
            elif d == "lightbanks":
                self.lightbanks(bg, t, a)
            elif d == "rays":
                self.godrays(bg, t, a, look)
            elif d == "phonelights":
                self.phonelights(bg, t, a)
            elif d == "lightpulse":
                self.lightpulse(bg, t, a)
        for a in act:
            if a["do"] == "spotlight":
                self.spotlight(bg, t, a)
        img = cv2.resize(bg, (self.W, self.H), interpolation=cv2.INTER_LINEAR)

        # ---- จอยักษ์ (ภาพถ่ายจริง) อยู่ในสนาม หลังถ้วยและหุ่น
        for a in act:
            if a["do"] == "screen":
                self.screen(img, t, a)

        # ---- 2+3 ของรอบตัว + หุ่น
        for a in act:
            if a["do"] == "trophy":
                self.trophy(img, t, a)
            elif a["do"] == "ember":
                self.motes(img, t, a, "ember")
            elif a["do"] == "rising":
                self.motes(img, t, a, "rising")
        self.track_alpha = bool({"sweep", "echo"} & kinds)  # เก็บรูปร่างหุ่นบนจอเฉพาะเฟรมที่มีแสงกวาด
        self.hero_a = np.zeros((self.H, self.W), np.float32) if self.track_alpha else None
        self.draw_puppet(img, t, look)
        for a in act:
            d = a["do"]
            if d == "armband":
                self.armband(img, t, a)
            elif d == "sweep":
                self.sweep(img, t, a)
            elif d == "echo":
                self.echo(img, t, a)

        # ---- 4 ข้างหน้า
        for a in act:
            if a["do"] == "ball":
                self.ball(img, t, a)
        for a in tl.active(t, ("confetti",), pad=0.5):
            self.confetti(img, t, a)
        for a in act:
            if a["do"] == "dust":
                self.motes(img, t, a, "dust")
            elif a["do"] == "occlude":
                self.occlude(img, t, a)

        # ---- 5 เกรดสี
        desat = 0.0
        for a in tl.active(t, ("desaturate",)):
            desat = max(desat, a.get("amount", 0.8) * env(t, a["t"], a["dur"], a.get("attack", 0.15), a.get("release", 0.6)))
        np.clip(img, 0, 1.6, out=img)
        img = fx.bloom(img, look["bloom"])
        img = fx.grade(img, look, desat)
        return fx.soften(img, look["soft"])

    def _bg_cam(self, bg):
        M = self.cam_matrix(0.45)
        M[:, 2] /= 2
        return cv2.warpAffine(bg, M, (self.hw, self.hh), borderMode=cv2.BORDER_REFLECT)
