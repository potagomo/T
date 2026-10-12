"""กราฟิกที่วาดด้วยโค้ด: ถ้วย ดาว เสื้อเบอร์ 10 ปลอกแขนกัปตัน แฟลช ตัวหนังสือ

ทุกอย่างคืนเป็น sprite แบบ float32 premultiplied RGBA และ cache ตามขนาด
ถ้วยเป็นทรงทั่วไป (ถ้วยทอง + ลูกโลก) ไม่ลอกแบบถ้วยจริงหรือโลโก้ของ FIFA
"""
import functools
import os

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .hero import FONTS

FONT_FILES = {
    "display": "Anton-Regular.ttf",
    "ui": "Inter-SemiBold.otf",
    "ui_medium": "Inter-Medium.otf",
    "script": "PlayfairDisplay-Italic.ttf",
    "thai": "IBMPlexSansThai-Medium.ttf",
}


def _to_sprite(im_rgba_u8):
    x = np.asarray(im_rgba_u8).astype(np.float32) / 255.0
    a = x[..., 3:4]
    return np.concatenate([x[..., :3] * a, a], -1)


def resize_sprite(sp, h):
    h = max(2, int(round(h)))
    w = max(2, int(round(sp.shape[1] * h / sp.shape[0])))
    interp = cv2.INTER_AREA if h < sp.shape[0] else cv2.INTER_LINEAR
    return cv2.resize(sp, (w, h), interpolation=interp)


# ---------------------------------------------------------------- text
@functools.lru_cache(maxsize=64)
def font(key, px):
    return ImageFont.truetype(os.path.join(FONTS, FONT_FILES[key]), max(4, int(px)))


@functools.lru_cache(maxsize=512)
def text_sprite(text, key, px, color=(1.0, 1.0, 1.0), tracking=0.0, shadow=0.0):
    """ตัวหนังสือบรรทัดเดียว tracking = ระยะห่างตัวอักษรเพิ่ม (สัดส่วนของ px)"""
    f = font(key, px)
    pad = int(px * 0.5)
    asc, desc = f.getmetrics()
    widths = [f.getlength(c) for c in text]
    tw = int(sum(widths) + tracking * px * max(0, len(text) - 1)) + 2 * pad
    th = asc + desc + 2 * pad
    im = Image.new("RGBA", (max(tw, 4), th), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = tuple(int(255 * v) for v in color) + (255,)
    if tracking == 0:
        d.text((pad, pad), text, font=f, fill=c)
    else:
        x = pad
        for ch, w in zip(text, widths):
            d.text((x, pad), ch, font=f, fill=c)
            x += w + tracking * px
    sp = _to_sprite(im)
    if shadow > 0:  # เงานุ่มใต้ตัวหนังสือ ให้อ่านออกบนพื้นสว่าง
        a = sp[..., 3]
        s = cv2.GaussianBlur(a, (0, 0), px * 0.12) * shadow
        out_a = a + s * (1 - a)
        sp = np.dstack([sp[..., :3], out_a])
    # ตัดขอบว่าง
    ys, xs = np.nonzero(sp[..., 3] > 0.004)
    if len(ys):
        sp = sp[max(0, ys.min() - 2):ys.max() + 3, max(0, xs.min() - 2):xs.max() + 3]
    return np.ascontiguousarray(sp)


@functools.lru_cache(maxsize=64)
def glyph_cell(ch, key, px, color=(1.0, 1.0, 1.0)):
    """ตัวเลขหนึ่งตัวในช่องกว้างเท่ากันทุกตัว (ใช้กับตัวนับเลขปี)"""
    f = font(key, px)
    asc, desc = f.getmetrics()
    w = int(f.getlength("0") * 1.04) + 4
    h = asc + desc
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if ch.strip():
        cw = f.getlength(ch)
        d.text(((w - cw) / 2, 0), ch, font=f, fill=tuple(int(255 * v) for v in color) + (255,))
    return _to_sprite(im)


# ---------------------------------------------------------------- shapes
def _supersample(draw_fn, w, h, s=3):
    im = Image.new("RGBA", (w * s, h * s), (0, 0, 0, 0))
    draw_fn(ImageDraw.Draw(im), s, im)
    return im.resize((w, h), Image.LANCZOS)


def _bucket(px):
    """ปัดขนาดเป็นขั้น ๆ (ห่างกัน ~5%) ให้ cache ใช้ซ้ำได้ระหว่างเฟรมที่กล้องซูมอยู่"""
    px = max(3, int(px))
    return int(round(1.05 ** round(np.log(px) / np.log(1.05))))


def trophy(h):
    """ถ้วยทองทรงทั่วไป สูง h px (ย่อจากต้นแบบ แล้ว cache เป็นขั้น)"""
    return _trophy_at(_bucket(h))


@functools.lru_cache(maxsize=48)
def _trophy_at(h):
    return resize_sprite(_trophy_base(), h)


@functools.lru_cache(maxsize=1)
def _trophy_base():
    W, H = 400, 900

    def draw(d, s, im):
        S = lambda *v: [int(x * s) for x in v]
        dark, mid = (150, 98, 22, 255), (214, 160, 52, 255)
        # ฐาน
        d.rounded_rectangle(S(70, 812, 330, 884), radius=14 * s, fill=dark)
        d.rounded_rectangle(S(96, 760, 304, 818), radius=12 * s, fill=mid)
        d.rectangle(S(96, 784, 304, 796), fill=(120, 80, 20, 255))
        # ลำตัว: บีบเอวแล้วบานออกรับลูกโลก
        pts = []
        for i in range(41):
            y = 760 - i * (760 - 330) / 40
            k = (760 - y) / (760 - 330)
            half = 70 - 40 * np.sin(min(1, k * 1.6) * np.pi / 2) + 95 * max(0, k - 0.45) ** 1.6 * 3.2
            pts.append((200 + half, y))
        pts += [(400 - x, y) for x, y in reversed(pts)]
        d.polygon([(x * s, y * s) for x, y in pts], fill=mid)
        # เกลียวบนลำตัว
        for j in range(5):
            line = []
            for i in range(30):
                y = 740 - i * 12
                k = (760 - y) / 430
                half = 70 - 40 * np.sin(min(1, k * 1.6) * np.pi / 2) + 95 * max(0, k - 0.45) ** 1.6 * 3.2
                ph = (i / 30) * 2.2 * np.pi + j * 1.25
                line.append(((200 + half * 0.92 * np.sin(ph)) * s, y * s))
            d.line(line, fill=(150, 100, 24, 255), width=int(7 * s))
        # ลูกโลก
        d.ellipse(S(78, 150, 322, 394), fill=(232, 182, 66, 255))
        for k in (-0.55, 0.0, 0.55):
            yy = 272 + k * 122
            hw = 122 * np.sqrt(max(0.0, 1 - k * k))
            d.ellipse(S(200 - hw, yy - 9, 200 + hw, yy + 9), outline=(160, 108, 26, 255), width=int(5 * s))
        for k in (0.35, 0.75):
            d.ellipse(S(200 - 122 * k, 150, 200 + 122 * k, 394), outline=(160, 108, 26, 255), width=int(5 * s))

    im = _supersample(draw, W, H)
    sp = _to_sprite(im)
    # แสงทรงกระบอก + ไฮไลต์โลหะ
    xx = np.linspace(-1, 1, W, dtype=np.float32)[None, :]
    shade = 0.55 + 0.6 * np.clip(1 - (xx + 0.35) ** 2, 0, 1)
    spec = np.exp(-((xx + 0.42) / 0.07) ** 2) * 0.9 + np.exp(-((xx - 0.5) / 0.05) ** 2) * 0.35
    rgb = sp[..., :3] * shade[..., None] + spec[..., None] * sp[..., 3:4] * np.float32([1.0, 0.95, 0.8])
    return np.ascontiguousarray(np.dstack([np.clip(rgb, 0, None), sp[..., 3]]).astype(np.float32))


@functools.lru_cache(maxsize=8)
def star(h):
    W = 200

    def draw(d, s, im):
        pts = []
        for i in range(10):
            r = 96 if i % 2 == 0 else 40
            a = -np.pi / 2 + i * np.pi / 5
            pts.append(((100 + r * np.cos(a)) * s, (104 + r * np.sin(a)) * s))
        d.polygon(pts, fill=(242, 193, 78, 255))

    sp = _to_sprite(_supersample(draw, W, W))
    yy = np.linspace(-1, 1, W, dtype=np.float32)[:, None]
    sp[..., :3] *= (1.15 - 0.35 * yy)[..., None]
    return resize_sprite(sp, h)


@functools.lru_cache(maxsize=4)
def jersey(h):
    """เสื้อด้านหลัง MESSI 10 ลายฟ้า-ขาว (ไม่มีโลโก้ใด ๆ)"""
    W, H = 900, 1000

    def draw(d, s, im):
        S = lambda pts: [(x * s, y * s) for x, y in pts]
        body = [(250, 90), (370, 60), (450, 88), (530, 60), (650, 90), (880, 230), (790, 400),
                (700, 350), (705, 960), (195, 960), (200, 350), (110, 400), (20, 230)]
        mask = Image.new("L", im.size, 0)
        ImageDraw.Draw(mask).polygon(S(body), fill=255)
        st = Image.new("RGBA", im.size, (244, 246, 248, 255))
        sd = ImageDraw.Draw(st)
        for k, x in enumerate(range(130, 800, 96)):
            if k % 2 == 0:
                sd.rectangle([x * s, 0, (x + 52) * s, H * s], fill=(117, 170, 219, 255))
        im.paste(st, (0, 0), mask)
        d.arc([370 * s, 30 * s, 530 * s, 120 * s], 0, 180, fill=(20, 20, 26, 255), width=int(10 * s))
        fn = ImageFont.truetype(os.path.join(FONTS, FONT_FILES["display"]), int(96 * s))
        tw = d.textlength("MESSI", font=fn)
        d.text((450 * s - tw / 2, 180 * s), "MESSI", font=fn, fill=(18, 20, 30, 255))
        fn2 = ImageFont.truetype(os.path.join(FONTS, FONT_FILES["display"]), int(400 * s))
        tw = d.textlength("10", font=fn2)
        d.text((450 * s - tw / 2, 270 * s), "10", font=fn2, fill=(18, 20, 30, 255))

    sp = _to_sprite(_supersample(draw, W, H, s=2))
    xx = np.linspace(-1, 1, W, dtype=np.float32)[None, :]
    sp[..., :3] *= (0.78 + 0.28 * np.cos(xx * 1.2))[..., None]
    return resize_sprite(sp, h)


@functools.lru_cache(maxsize=4)
def armband(h):
    W, H = 260, 260

    def draw(d, s, im):
        d.ellipse([10 * s, 10 * s, 250 * s, 250 * s], fill=(244, 246, 248, 255), outline=(117, 170, 219, 255), width=int(14 * s))
        fn = ImageFont.truetype(os.path.join(FONTS, FONT_FILES["display"]), int(170 * s))
        tw = d.textlength("C", font=fn)
        d.text((130 * s - tw / 2, 6 * s), "C", font=fn, fill=(20, 24, 40, 255))

    return resize_sprite(_to_sprite(_supersample(draw, W, H)), h)


def flare(px):
    """แฟลชกล้อง: แสงกลม + แฉกสี่ทิศ (สำหรับบวกแสง)"""
    return _flare(_bucket(max(8, px)))


@functools.lru_cache(maxsize=96)
def _flare(px):
    yy, xx = np.mgrid[-1:1:complex(0, px), -1:1:complex(0, px)].astype(np.float32)
    r = np.sqrt(xx ** 2 + yy ** 2)
    core = np.exp(-(r / 0.08) ** 2) + 0.35 * np.exp(-(r / 0.3) ** 2)
    streak = np.exp(-(np.abs(yy) / 0.012)) * np.exp(-np.abs(xx) / 0.5) + np.exp(-(np.abs(xx) / 0.012)) * np.exp(-np.abs(yy) / 0.5)
    v = np.clip(core + 0.6 * streak, 0, 1.5)
    return v.astype(np.float32)


def soft_dot(px, hard=0.0):
    return _soft_dot(_bucket(px), hard)


@functools.lru_cache(maxsize=160)
def _soft_dot(px, hard=0.0):
    yy, xx = np.mgrid[-1:1:complex(0, px), -1:1:complex(0, px)].astype(np.float32)
    r = np.sqrt(xx ** 2 + yy ** 2)
    if hard > 0:  # วงโบเก้ขอบชัดนิด ๆ
        v = np.clip((1 - r) / (1 - hard + 1e-3), 0, 1) ** 0.8 * (0.75 + 0.25 * r)
    else:
        v = np.exp(-(r / 0.45) ** 2)
    return v.astype(np.float32)


@functools.lru_cache(maxsize=1)
def _ball_base():
    """ลูกฟุตบอลขาว-ดำทรงทั่วไป (ห้าเหลี่ยมกลาง + ห้าเหลี่ยมรอบ ๆ ที่เอียงตามผิวโลก)"""
    R = 256

    def draw(d, s, im):
        c = R * s
        d.ellipse([4 * s, 4 * s, (2 * R - 4) * s, (2 * R - 4) * s], fill=(240, 240, 236, 255))
        dark = (24, 24, 30, 255)

        def pent(cx, cy, r, rot, squash=1.0, ang=0.0):
            pts = []
            for i in range(5):
                a = rot + i * 2 * np.pi / 5
                x, y = np.cos(a) * r, np.sin(a) * r
                # ย่อในแนวรัศมีเพื่อให้ดูโค้งตามผิวลูก
                ca, sa = np.cos(ang), np.sin(ang)
                u, v = x * ca + y * sa, -x * sa + y * ca
                u *= squash
                x, y = u * ca - v * sa, u * sa + v * ca
                pts.append(((cx + x) * s, (cy + y) * s))
            d.polygon(pts, fill=dark)

        pent(R, R, 0.30 * R, -np.pi / 2)
        for i in range(5):
            a = np.pi / 2 + i * 2 * np.pi / 5
            dist = 0.78 * R
            pent(R + np.cos(a) * dist, R + np.sin(a) * dist, 0.27 * R, a + np.pi, squash=0.45, ang=a)

    sp = _to_sprite(_supersample(draw, 2 * R, 2 * R))
    yy, xx = np.mgrid[-1:1:complex(0, 2 * R), -1:1:complex(0, 2 * R)].astype(np.float32)
    r2 = xx ** 2 + yy ** 2
    z = np.sqrt(np.clip(1 - r2, 0, 1))
    light = np.clip(0.35 + 0.75 * (z * 0.7 - xx * 0.35 - yy * 0.45), 0.15, 1.15)
    spec = np.exp(-(((xx + 0.35) ** 2 + (yy + 0.4) ** 2) / 0.03)) * 0.6
    sp[..., :3] = sp[..., :3] * light[..., None] + spec[..., None] * sp[..., 3:4]
    return np.ascontiguousarray(sp.astype(np.float32))


def ball(h, rot=0.0):
    sp = resize_sprite(_ball_base(), h)
    if abs(rot) > 0.01:
        M = cv2.getRotationMatrix2D((sp.shape[1] / 2, sp.shape[0] / 2), rot, 1.0)
        sp = cv2.warpAffine(sp, M, (sp.shape[1], sp.shape[0]))
    return sp
