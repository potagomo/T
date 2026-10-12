"""เครื่องมือวางภาพซ้อนชั้น + เอฟเฟกต์หลังถ่าย (เกรดสี บลูม เกรน ทีวีเก่า กลิตช์)

ภาพทำงานเป็น float32 0..1 ขนาด (H, W, 3) ตลอดทาง แล้วค่อยแปลงเป็น uint8 ตอนท้าย
"""
import functools
import math

import cv2
import numexpr as ne
import numpy as np


# ---------------------------------------------------------------- compositing
def _roi(dst_h, dst_w, x0, y0, w, h):
    X0, Y0 = max(0, x0), max(0, y0)
    X1, Y1 = min(dst_w, x0 + w), min(dst_h, y0 + h)
    if X1 <= X0 or Y1 <= Y0:
        return None
    return X0, Y0, X1, Y1, X0 - x0, Y0 - y0


def blit(dst, sp, cx, cy, alpha=1.0, add=False, tint=None):
    """วาง sprite (premultiplied RGBA) ให้จุดกึ่งกลางอยู่ที่ (cx, cy) พิกเซล"""
    if alpha <= 0.002:
        return
    h, w = sp.shape[:2]
    x0, y0 = int(round(cx - w / 2)), int(round(cy - h / 2))
    r = _roi(dst.shape[0], dst.shape[1], x0, y0, w, h)
    if r is None:
        return
    X0, Y0, X1, Y1, sx, sy = r
    s = sp[sy:sy + (Y1 - Y0), sx:sx + (X1 - X0)]
    rgb = s[..., :3] if tint is None else s[..., 3:4] * np.float32(tint)
    d = dst[Y0:Y1, X0:X1]
    if add:
        d += rgb * alpha
    else:
        d *= 1 - s[..., 3:4] * alpha
        d += rgb * alpha


def add_mono(dst, mono, cx, cy, color, gain=1.0):
    """บวกแสงจาก sprite ช่องเดียว (เช่นแฟลช โบเก้) ด้วยสี color"""
    if gain <= 0.002:
        return
    h, w = mono.shape
    x0, y0 = int(round(cx - w / 2)), int(round(cy - h / 2))
    r = _roi(dst.shape[0], dst.shape[1], x0, y0, w, h)
    if r is None:
        return
    X0, Y0, X1, Y1, sx, sy = r
    m = mono[sy:sy + (Y1 - Y0), sx:sx + (X1 - X0)]
    dst[Y0:Y1, X0:X1] += m[..., None] * (np.float32(color) * gain)


def warp_into(dst_shape, sp, M):
    """warp sprite ด้วยเมทริกซ์ affine M (2x3) แต่คำนวณเฉพาะกรอบที่ตกลงในจอ

    คืน (ROI slice, ชิ้นภาพที่ warp แล้ว) หรือ None
    """
    H, W = dst_shape[:2]
    h, w = sp.shape[:2]
    pts = np.float32([[0, 0, 1], [w, 0, 1], [0, h, 1], [w, h, 1]]) @ M.T
    x0, y0 = np.floor(pts.min(0)).astype(int)
    x1, y1 = np.ceil(pts.max(0)).astype(int)
    X0, Y0, X1, Y1 = max(0, x0), max(0, y0), min(W, x1 + 1), min(H, y1 + 1)
    if X1 <= X0 or Y1 <= Y0:
        return None
    M2 = M.copy()
    M2[:, 2] -= (X0, Y0)
    out = cv2.warpAffine(sp, M2, (X1 - X0, Y1 - Y0), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    return (slice(Y0, Y1), slice(X0, X1)), out


def affine(scale, rot_deg, src_pivot, dst_pos):
    """เมทริกซ์ที่ย่อ/หมุนรอบ src_pivot แล้ววางที่ dst_pos"""
    a = math.radians(rot_deg)
    c, s = math.cos(a) * scale, math.sin(a) * scale
    px, py = src_pivot
    tx = dst_pos[0] - (c * px - s * py)
    ty = dst_pos[1] - (s * px + c * py)
    return np.float32([[c, -s, tx], [s, c, ty]])


def blur_fast(img, sigma):
    """เบลอแรง ๆ แบบถูก: ย่อ → เบลอ → ขยาย"""
    if sigma < 0.6:
        return img
    f = max(1, int(sigma / 3))
    if f > 1:
        small = cv2.resize(img, (max(1, img.shape[1] // f), max(1, img.shape[0] // f)), interpolation=cv2.INTER_AREA)
        small = cv2.GaussianBlur(small, (0, 0), sigma / f)
        return cv2.resize(small, (img.shape[1], img.shape[0]), interpolation=cv2.INTER_LINEAR)
    return cv2.GaussianBlur(img, (0, 0), sigma)


# ---------------------------------------------------------------- grading
_LUMA = np.float32([0.2126, 0.7152, 0.0722])


@functools.lru_cache(maxsize=64)
def _curve(gamma, contrast):
    """เส้นโค้ง gamma + contrast ต่อช่องสี ประมาณด้วยพหุนามดีกรี 5 (เร็วกว่า pow มาก)"""
    x = np.linspace(0, 1, 512)
    co = []
    for g in gamma:
        y = np.clip(0.5 + (x ** (1 / g) - 0.5) * contrast, 0, 1)
        co.append(np.polyfit(x, y, 5))
    return np.float32(co).T  # (6, 3) สัมประสิทธิ์จากดีกรีสูงไปต่ำ


def grade(img, look, desat=0.0):
    """ความอิ่มสี + gain/lift (เส้นตรง ทำทีเดียวด้วย cv2.transform) แล้ว gamma/contrast ด้วยพหุนาม"""
    sat = float(look["sat"]) * (1 - desat)
    lift, gain = np.float32(look["lift"]), np.float32(look["gain"])
    S = (1 - sat) * np.tile(_LUMA, (3, 1)) + sat * np.eye(3, dtype=np.float32)
    M = np.zeros((3, 4), np.float32)
    M[:, :3] = (gain - lift)[:, None] * S
    M[:, 3] = lift
    x = cv2.transform(img, M)
    c = _curve(tuple(round(float(v), 3) for v in look["gamma"]), round(float(look["contrast"]), 3))
    t = ne.evaluate("where(x < 0, 0, where(x > 1, 1, x))")
    c5, c4, c3, c2, c1, c0 = c
    return ne.evaluate("((((c5 * t + c4) * t + c3) * t + c2) * t + c1) * t + c0")


def bloom(img, amount, thresh=0.62):
    if amount <= 0.01:
        return img
    h, w = img.shape[:2]
    small = cv2.resize(img, (w // 8, h // 8), interpolation=cv2.INTER_AREA)
    br = np.clip(small - thresh, 0, None)
    g = cv2.GaussianBlur(br, (0, 0), max(1.0, h / 8 * 0.012)) + cv2.GaussianBlur(br, (0, 0), max(2.0, h / 8 * 0.04)) * 0.6
    g = cv2.resize(g, (w, h), interpolation=cv2.INTER_LINEAR)
    return cv2.scaleAdd(g, float(amount), img)


@functools.lru_cache(maxsize=4)
def _vignette(h, w):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    nx, ny = (xx / w - 0.5) * 2 * (w / h), (yy / h - 0.52) * 2
    r = np.sqrt(nx ** 2 * 1.6 + ny ** 2)
    return np.clip(1 - 0.5 * np.clip(r - 0.35, 0, None) ** 1.5, 0, 1).astype(np.float32)[..., None]


def vignette(img, amount):
    v = _vignette(img.shape[0], img.shape[1])
    k0, k1 = np.float32(1 - amount), np.float32(amount)
    return ne.evaluate("img * (k0 + k1 * v)")


@functools.lru_cache(maxsize=4)
def _grain_tiles(h, w, n=6):
    rng = np.random.default_rng(7)
    tiles = []
    for _ in range(n):
        g = rng.standard_normal((h, w)).astype(np.float32)
        if h > 1500:  # 4K: เม็ดเกรนใหญ่ขึ้นนิดให้ดูเหมือนฟิล์ม ไม่ใช่สัญญาณรบกวนดิจิทัล
            g = cv2.GaussianBlur(g, (0, 0), 1.0) * 1.9
        tiles.append(g)
    return tiles


def grain(img, amount, frame_idx):
    if amount <= 0.002:
        return img
    t = _grain_tiles(img.shape[0], img.shape[1])
    g = t[frame_idx % len(t)]
    # เกรนชัดในโทนกลาง จางในที่มืดสนิท/สว่างจ้า
    lum = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
    a = np.float32(amount)
    gw = ne.evaluate("g * a * where(4 * lum * (1 - lum) < 0.15, 0.15, where(4 * lum * (1 - lum) > 1, 1, 4 * lum * (1 - lum)))")[..., None]
    return ne.evaluate("img + gw")


def soften(img, amount):
    """ทำให้ภาพนุ่มแบบภาพ SD (ใช้กับยุคเก่า)"""
    if amount <= 0.02:
        return img
    h, w = img.shape[:2]
    f = 1 - 0.78 * amount
    small = cv2.resize(img, (max(2, int(w * f)), max(2, int(h * f))), interpolation=cv2.INTER_AREA)
    return cv2.resize(small, (w, h), interpolation=cv2.INTER_LINEAR)


def crt(img, amount, t, off=0.0):
    """ภาพทีวีหลอด: สแกนไลน์ สีเหลื่อม ขอบมืดโค้ง และปิดจอเป็นเส้น (off 0→1)"""
    if amount <= 0.01 and off <= 0:
        return img
    h, w = img.shape[:2]
    out = img
    if amount > 0.01:
        sh = max(1, int(w * 0.0025))
        r = np.roll(img[..., 0], sh, axis=1)
        b = np.roll(img[..., 2], -sh, axis=1)
        out = np.dstack([r, img[..., 1], b])
        period = max(3, h // 320)
        rows = (np.arange(h) % period) < max(1, period // 2)
        scan = np.where(rows, 1.0, 1 - 0.32 * amount).astype(np.float32)
        out = out * scan[:, None, None]
        flick = 1 + 0.025 * amount * math.sin(t * 61.0)
        out = out * np.float32(flick)
        out = vignette(out, 0.55 * amount)
    if off > 0:
        # ยุบลงเป็นเส้นแนวนอนแล้วเหลือจุด
        k1 = min(1.0, off / 0.6)
        k2 = max(0.0, (off - 0.6) / 0.4)
        sy = max(2.0 / h, 1 - k1)
        sx = max(2.0 / w, 1 - k2)
        M = np.float32([[sx, 0, w / 2 * (1 - sx)], [0, sy, h / 2 * (1 - sy)]])
        out = cv2.warpAffine(out, M, (w, h), flags=cv2.INTER_LINEAR, borderValue=0)
        out = out * (1 + 2.5 * k1)
        if k2 > 0.95:
            out = out * (1 - (k2 - 0.95) / 0.05)
    return out


def glitch(img, strength, seed):
    if strength <= 0.01:
        return img
    rng = np.random.default_rng(seed)
    h, w = img.shape[:2]
    out = img.copy()
    for _ in range(int(3 + 7 * strength)):
        y0 = rng.integers(0, h)
        hh = int(rng.integers(h // 120 + 1, h // 18 + 2))
        dx = int(rng.normal(0, w * 0.04 * strength))
        out[y0:y0 + hh] = np.roll(out[y0:y0 + hh], dx, axis=1)
    sh = int(w * 0.008 * strength)
    if sh:
        out[..., 0] = np.roll(out[..., 0], sh, axis=1)
        out[..., 2] = np.roll(out[..., 2], -sh, axis=1)
    return out


def chroma(img, amount):
    """ขอบสีเหลื่อมเบา ๆ แบบเลนส์ (ขยายช่องแดงออกนิดเดียว)"""
    if amount <= 0.0005:
        return img
    h, w = img.shape[:2]
    sc = 1 + amount
    M = np.float32([[sc, 0, w / 2 * (1 - sc)], [0, sc, h / 2 * (1 - sc)]])
    img[..., 0] = cv2.warpAffine(np.ascontiguousarray(img[..., 0]), M, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    return img


def to_u8(img):
    return ne.evaluate("where(img < 0, 0, where(img > 1, 255, img * 255 + 0.5))").astype(np.uint8)
