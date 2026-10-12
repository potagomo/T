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
import zlib

import cv2
import numexpr as ne
import numpy as np

from . import fx, gfx
from .hero import Puppet
from .looks import CX, LOOKS, PALETTE, POS_Y, mix
from .timeline import back_out, clamp, ease_in, ease_in_out, ease_out, env, lerp, smooth

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
        px = cx + (x * self.W - tx) * z + self.shake[0] * k
        py = cy + (y * self.H - ty) * z + self.shake[1] * k
        return px, py, z

    def cam_matrix(self, k):
        """เมทริกซ์ของกล้อง (พิกเซลเต็มจอ) สำหรับ warp ทั้งชั้น"""
        px, py, z = self.cam(0, 0, k)
        return np.float32([[z, 0, px], [0, z, py]])

    # ------------------------------------------------------------ static textures
    def _make_haze(self):
        rng = np.random.default_rng(3)
        n = rng.random((18, 10)).astype(np.float32)
        hz = cv2.resize(n, (self.hw, self.hh), interpolation=cv2.INTER_CUBIC)
        n2 = rng.random((40, 22)).astype(np.float32)
        hz = 0.65 * hz + 0.35 * cv2.resize(n2, (self.hw, self.hh), interpolation=cv2.INTER_CUBIC)
        return np.clip((hz - 0.35) * 1.6, 0, 1)

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
            if self.tl.beat.ok:
                last = -9.0
                for b in self.tl.beat.beats:
                    if a["t"] - 0.05 <= b <= a["t"] + a["dur"] and b - last >= ev * 0.75:
                        out.append(b)
                        last = b
            else:
                n = int(a["dur"] / ev) + 1
                out += [a["t"] + i * ev for i in range(n)]
        return sorted(out)

    # ------------------------------------------------------------ layer 1: background (half-res, world)
    def background(self, t, look, ea, eb, w):
        h, wd = self.hh, self.hw
        top, bot = np.float32(look["bg_top"]), np.float32(look["bg_bottom"])
        g = np.linspace(0, 1, h, dtype=np.float32)[:, None, None] ** 1.3
        bg = np.broadcast_to(top + (bot - top) * g, (h, wd, 3)).copy()
        bk = self._bokeh_layer(ea["id"])
        if w > 0 and eb["id"] != ea["id"]:
            bk = bk * (1 - w) + self._bokeh_layer(eb["id"]) * w
        drift = np.float32([[1, 0, math.sin(t * 0.13) * 0.01 * wd], [0, 1, 0]])
        bg += cv2.warpAffine(bk, drift, (wd, h), borderMode=cv2.BORDER_REFLECT)
        hz_amt = 0.05 + 0.10 * self._haze_boost
        off = (t * 0.012 * h) % h
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
        sz = rng.uniform(0.04, 0.11, n)
        energy = 0.6 + 0.8 * self.tl.beat.level(t) if self.tl.beat.ok else 1.0
        for b, x, y, s in zip(births, xs, ys, sz):
            dt = t - b
            if 0 <= dt < 0.22:
                px, py, z = self.cam(x, y, 0.45)
                fx.add_mono(bg, gfx.flare(int(s * self.hh * z)), px / 2, py / 2, (1.0, 0.98, 0.95), 1.4 * math.exp(-dt / 0.05) * energy)

    def lightbanks(self, bg, t, a):
        n = a.get("count", 7)
        times = [self.tl.beat.snap(a["t"] + i * a["dur"] * 0.85 / n, "beat", 0.3) for i in range(n)]
        col = np.float32((1.0, 0.95, 0.85))
        for i, tb in enumerate(times):
            k = smooth((t - tb) / 0.12)
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
        on = sum(1 for tb in times if t >= tb) / n
        bg += np.float32((0.10, 0.075, 0.04)) * on

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
            n = 5200
            row = rng.random(n)
            x = rng.uniform(-0.1, 1.1, n)
            # อัฒจันทร์เป็นชั้นโค้ง: แถวไกลอยู่สูง
            y = 0.10 + row * 0.55 - np.sin(np.clip(x, 0, 1) * np.pi) * (0.05 + 0.04 * row) + rng.normal(0, 0.006, n)
            self._cache[key] = tuple(v.astype(np.float32) for v in (x, y, row, rng.uniform(0, 6.28, n), rng.uniform(0.6, 2.4, n), rng.random(n)))
        x, y, row, ph, sp, order = self._cache[key]
        vis = order < clamp((t - a["t"]) / 2.6)  # ไฟเปิดทีละดวงจนเต็มสนาม
        tw = 0.55 + 0.45 * np.sin(t * sp + ph)
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

    # ------------------------------------------------------------ puppet
    def puppet_T(self):
        sh = self.shot.get("hero", {})
        scale = sh.get("scale", 0.56)
        x = sh.get("x", CX)
        y = sh.get("y", self.hero_top + scale / 2)
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
            hcol = rim_c * np.float32((0.10 + 0.25 * (1 - lit)) * rim_k / 255)
            rcol = rim_c * np.float32((0.45 + 1.1 * (1 - lit)) * rim_k / 255 / 255)
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
        lit = sh.get("lit", [1.0, 1.0])
        lit = lerp(lit[0], lit[1], smooth(self.u))
        P = self.pose(t)
        rim_k = self.motion_amt
        ts = pup.tile

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
        if flip_p is not None:  # พลิกเลข: ภาพเลขใหม่ค่อย ๆ ทับ + แสงวาบบนตัวต่อ
            new = pup.body19 if num == "10" else None
            x0, y0, x1, y1 = pup.number_box
            L = pup.layers["body"] if new is None else new
            sub = dict(img=L["img"][y0 - L["off"][1]:y1 - L["off"][1], x0 - L["off"][0]:x1 - L["off"][0]].copy(),
                       aux=np.zeros((y1 - y0, x1 - x0, 4), np.uint8), off=(x0, y0))
            sub["img"] = (sub["img"].astype(np.float32) * smooth(flip_p)).astype(np.uint8)
            self.draw_layer(img, pup.layers["body"], Mb, look, lit, 0.0, img_override=sub)
            fl = math.sin(clamp(flip_p) * math.pi)
            px, py = self.to_screen(Mb, ((x0 + x1) / 2, (y0 + y1) / 2))
            fx.add_mono(img, gfx.flare(int((y1 - y0) * s * 2.2)), px, py, (1, 0.97, 0.9), 0.9 * fl)
        self.draw_layer(img, pup.layers["head"], T @ P["head"], look, lit, rim_k)

    def number_state(self, t):
        """เลขหลังเสื้อ ณ เวลา t → ('19'|'10', ความคืบหน้าการพลิก หรือ None)"""
        for a in self.tl.active(t, ("number",)):
            seq = a["seq"]
            flips = a.get("flip", [])
            flips = flips if isinstance(flips, list) else [flips]
            idx = sum(1 for f in flips if t >= f + 0.15)
            for f in flips:
                if f - 0.15 <= t < f + 0.15:
                    return seq[min(idx, len(seq) - 1)], (t - (f - 0.15)) / 0.3
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
            if u > 3.0:
                q = clamp((u - 3.0) / 1.9)
                y -= 0.12 * H * ease_in(q)
                alpha *= 1 - smooth(q)
                blur, sc, glow = 1.4 * q, 1 - 0.2 * q, 1 - q
        elif mode == "arrive":
            # ลงมาจากฟ้า มาหยุดเหนือหัว
            q = back_out(clamp(u / 1.0), 1.1)
            y = lerp(-0.12 * H, y, q) + 0.005 * H * math.sin(u * 2.1)
            glow = 1.4
            if 0.9 < u < 1.4:
                fx.add_mono(img, gfx.flare(int(0.5 * H)), x, y, PALETTE["gold"], 1.3 * (1 - (u - 0.9) / 0.5))
        elif mode == "dissolve":
            alpha = smooth(u / 0.9) * 0.92
            y += 0.006 * H * math.sin(u * 1.7)
            dissolve = clamp((u - 1.5) / 1.4)
        sp = gfx.trophy(max(8, int(hgt * sc)))
        if blur > 0:
            sp = fx.blur_fast(sp, blur * 0.01 * H)
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
        fade = 1 - smooth((u - a["dur"] + 0.6) / 0.6)
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
        sheen = np.exp(-(band / 0.07) ** 2) * self.hero_a[y0:y1, x0:x1]
        img[y0:y1, x0:x1] += sheen[..., None] * np.float32((1.0, 0.97, 0.9)) * 0.85

    # ------------------------------------------------------------ text (screen space)
    def _put(self, img, sp, x, y, alpha):
        fx.blit(img, sp, x * self.W, y * self.H, alpha)

    def text(self, img, t, a):
        style = a.get("style", "line")
        k = env(t, a["t"], a["dur"], 0.28, 0.25)
        if k <= 0:
            return
        y = POS_Y[a.get("pos", "upper")]
        q = ease_out((t - a["t"]) / 0.45)
        H = self.H
        if style == "kicker":
            sp = gfx.text_sprite(a["text"], "ui", int(0.0215 * H), (0.95, 0.95, 0.95), 0.16, 0.7)
            if sp.shape[1] > 0.84 * self.W:
                sp = gfx.resize_sprite(sp, sp.shape[0] * 0.84 * self.W / sp.shape[1])
            self._put(img, sp, CX, y + 0.006 * (1 - q), k * 0.95)
        elif style == "line":
            sp = gfx.text_sprite(a["text"], "display", int(0.058 * H), (1.0, 1.0, 1.0), 0.015, 0.85)
            if sp.shape[1] > 0.84 * self.W:
                sp = gfx.resize_sprite(sp, sp.shape[0] * 0.84 * self.W / sp.shape[1])
            self._put(img, sp, CX, y + 0.012 * (1 - q), k)
        elif style == "script":
            sp = gfx.text_sprite(a["text"], "script", int(0.068 * H), (1.0, 0.97, 0.92), 0.0, 0.75)
            self._put(img, sp, CX, y + 0.01 * (1 - q), k)
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
        y = POS_Y[a.get("pos", "upper")] + (0.015 if a.get("pos", "upper") != "top" else 0.01)
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
            else:
                ia, ib = int(fa), int(ta)
                steps = (ib - ia) % 10 or 10
                seq = [str((ia + j) % 10) for j in range(steps + 1)]
                q = p * steps
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
            self._put(img, lb, CX, POS_Y["top2"] - 0.006, k * smooth((u - 0.4) / 0.4))

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
            q = clamp((t - a["t"] - 0.6) / 0.35)  # ดาวดวงที่ 3 ตกลงมาพร้อมแสงวาบ
            if q <= 0:
                continue
            fx.add_mono(img, gfx.flare(int(sz * 5 * (1.2 - q))), x, y, PALETTE["gold"], 1.2 * (1 - q) + 0.25)
            fx.blit(img, gfx.star(int(sz * (1 + 1.5 * (1 - ease_out(q))))), x, y, k * q)

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
        act = tl.active(t)
        kinds = {a["do"] for a in act}

        # ความแรงของการขยับ: ระหว่างประกอบร่างหุ่นนิ่ง แล้วค่อย ๆ มีชีวิต
        self.motion_amt = 1.0
        for a in tl.actions:
            if a["do"] == "build":
                e = a["t"] + a["dur"]
                if t <= e + 0.6:
                    self.motion_amt = smooth((t - e) / 0.6)

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

        # ---- 1 ฉากหลัง
        bg = self.background(t, look, ea, eb, w)
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
        bg = self._bg_cam(bg)
        for a in act:
            if a["do"] == "spotlight":
                self.spotlight(bg, t, a)
        img = cv2.resize(bg, (self.W, self.H), interpolation=cv2.INTER_LINEAR)

        # ---- 2+3 หุ่น และของรอบตัว
        self.T, _ = self.puppet_T()
        for a in act:
            if a["do"] == "trophy":
                self.trophy(img, t, a)
            elif a["do"] == "ember":
                self.motes(img, t, a, "ember")
            elif a["do"] == "rising":
                self.motes(img, t, a, "rising")
        self.track_alpha = "sweep" in kinds  # เก็บรูปร่างหุ่นบนจอเฉพาะเฟรมที่มีแสงกวาด
        self.hero_a = np.zeros((self.H, self.W), np.float32) if self.track_alpha else None
        self.draw_puppet(img, t, look)
        for a in act:
            if a["do"] == "armband":
                self.armband(img, t, a)
            elif a["do"] == "sweep":
                self.sweep(img, t, a)

        # ---- 4 อนุภาคข้างหน้า
        for a in tl.active(t, ("confetti",), pad=0.5):
            self.confetti(img, t, a)
        for a in act:
            if a["do"] == "dust":
                self.motes(img, t, a, "dust")

        # ---- 5 เกรดสี
        desat = 0.0
        for a in tl.active(t, ("desaturate",)):
            desat = max(desat, a.get("amount", 0.8) * env(t, a["t"], a["dur"], 0.15, 0.6))
        np.clip(img, 0, 1.6, out=img)
        img = fx.bloom(img, look["bloom"])
        img = fx.grade(img, look, desat)
        img = fx.soften(img, look["soft"])

        # ---- 6 ตัวหนังสือ
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

        # ---- 7 ทีวีเก่า กลิตช์ ขอบมืด เกรน แฟลช เฟด
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
        img = fx.vignette(img, look["vignette"])
        img = fx.chroma(img, 0.0015)
        img = fx.grain(img, look["grain"], idx)
        for a in tl.active(t, ("flash",)):
            img = img + np.float32(1 - ease_out((t - a["t"]) / a["dur"])) * 0.9
        for a in tl.active(t, ("fade_out",)):
            img = img * np.float32(1 - smooth((t - a["t"]) / a["dur"]))
        if self.debug_text:
            sp = gfx.text_sprite(self.debug_text, "ui", int(0.016 * self.H), (1, 0.85, 0.3), 0.04, 0.9)
            fx.blit(img, sp, 0.5 * self.W, 0.975 * self.H, 1.0)
        return fx.to_u8(img)

    def _bg_cam(self, bg):
        M = self.cam_matrix(0.45)
        M[:, 2] /= 2
        return cv2.warpAffine(bg, M, (self.hw, self.hh), borderMode=cv2.BORDER_REFLECT)
