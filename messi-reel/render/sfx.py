"""เสียงประกอบต้นฉบับ (sound design) ที่วางใต้เพลง — สังเคราะห์ด้วยโค้ดทั้งหมด ไม่มีเสียงของใคร

ใช้เวลาจาก timeline เดียวกับภาพ (รวมการดึงเข้าบีต) จึงตรงกับภาพเสมอ
ตั้งระดับไว้ต่ำ: เพลง Politik เป็นตัวหลัก เสียงพวกนี้แค่ช่วยให้ภาพมีน้ำหนักและมีบรรยากาศสนาม

  python3 -m render.sfx                 → out/sfx_bed.wav (48 kHz stereo)
  python3 -m render.sfx --mux <video>   → <video>_sfx.mp4 (ภาพเดิม + เสียงประกอบ)

เสียงเป็นแบบไม่มีระดับเสียงดนตรี (noise / ต่ำมาก) เกือบทั้งหมด เพื่อไม่ให้ตีกับคีย์ของเพลง
ยกเว้นนกหวีดหมดเวลาตอนจบ ซึ่งสั้นและอยู่ไกล
"""
import argparse
import os
import subprocess
import wave

import numpy as np
from scipy import signal

from .timeline import ROOT, Timeline

SR = 48000
RNG = np.random.default_rng(1987)


# ---------------------------------------------------------------- building blocks
def _n(sec):
    return max(1, int(sec * SR))


def noise(sec):
    return RNG.standard_normal(_n(sec)).astype(np.float32)


def band(x, lo, hi, order=4):
    sos = signal.butter(order, [lo, hi], btype="band", fs=SR, output="sos")
    return signal.sosfilt(sos, x).astype(np.float32)


def low(x, f, order=4):
    return signal.sosfilt(signal.butter(order, f, btype="low", fs=SR, output="sos"), x).astype(np.float32)


def high(x, f, order=4):
    return signal.sosfilt(signal.butter(order, f, btype="high", fs=SR, output="sos"), x).astype(np.float32)


def env_exp(sec, tau, attack=0.002):
    t = np.arange(_n(sec)) / SR
    return (np.minimum(1, t / max(attack, 1e-4)) * np.exp(-t / tau)).astype(np.float32)


def reverb_ir(sec=2.2, tau=0.55):
    ir = noise(sec) * env_exp(sec, tau, 0.01)
    ir = low(ir, 5000)
    return ir / np.abs(ir).sum() * 40


class Bus:
    """ราง stereo ยาวเท่าคลิป วางเสียงด้วยเวลา (วินาที) + แพนซ้ายขวา"""

    def __init__(self, dur):
        self.x = np.zeros((2, _n(dur)), np.float32)

    def put(self, t, mono, gain=1.0, pan=0.0):
        i = int(t * SR)
        if i >= self.x.shape[1] or i + len(mono) <= 0:
            return
        a, b = max(0, i), min(self.x.shape[1], i + len(mono))
        seg = mono[a - i:b - i] * gain
        l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        self.x[0, a:b] += seg * l * 1.414
        self.x[1, a:b] += seg * r * 1.414


# ---------------------------------------------------------------- sounds
def shutter():
    c1 = high(noise(0.004), 2500) * env_exp(0.004, 0.0012)
    c2 = band(noise(0.03), 1200, 6000) * env_exp(0.03, 0.006)
    out = np.zeros(_n(0.05), np.float32)
    out[:len(c1)] += c1
    k = _n(0.012)
    out[k:k + len(c2)] += c2[:len(out) - k] * 0.6
    return out


def thunk():
    """ไฟสนามเปิด: เสียงสวิตช์ไฟฟ้าใหญ่"""
    t = np.arange(_n(0.5)) / SR
    tone = (np.sin(2 * np.pi * 55 * t) + 0.5 * np.sin(2 * np.pi * 110 * t)) * np.exp(-t / 0.12)
    hit = low(noise(0.5), 900) * env_exp(0.5, 0.03)
    return (tone * 0.8 + hit * 0.6).astype(np.float32)


def boom(sec=2.0):
    """กระแทกหนัก ๆ (สกอร์ 113', ทีวีดับ): ซับเบสกวาดลง + แรงอัดอากาศ"""
    t = np.arange(_n(sec)) / SR
    f = 62 * np.exp(-t / 0.8) + 34
    ph = 2 * np.pi * np.cumsum(f) / SR
    sub = np.sin(ph) * np.exp(-t / 0.75)
    air = low(noise(sec), 260) * env_exp(sec, 0.18, 0.004) * 1.4
    return (sub * 0.9 + air).astype(np.float32)


def whoosh(sec=0.7, rising=True):
    """ลมวูบตอนเปลี่ยนยุค: noise ที่ความถี่กลางกวาดขึ้น"""
    x = noise(sec)
    f, tt, Z = signal.stft(x, SR, nperseg=1024)
    prog = np.linspace(0, 1, Z.shape[1])
    center = 300 * (12 ** (prog if rising else 1 - prog))
    mask = np.exp(-((np.log(f[:, None] + 1) - np.log(center[None, :])) / 0.55) ** 2)
    _, y = signal.istft(Z * mask, SR, nperseg=1024)
    y = y[:_n(sec)].astype(np.float32)
    e = np.sin(np.linspace(0, np.pi, len(y))) ** 1.5
    return y * e.astype(np.float32) * 3.0


def brick_clack(n=3):
    """ตัวต่อเลโก้กระทบกัน (ตอนเลข 19 พลิกเป็น 10)"""
    out = np.zeros(_n(0.35), np.float32)
    t = np.arange(_n(0.06)) / SR
    for i in range(n):
        f0 = RNG.uniform(2200, 2900)
        c = sum(np.sin(2 * np.pi * f0 * m * t + RNG.uniform(0, 6)) * w for m, w in ((1, 1), (1.53, 0.6), (2.31, 0.35)))
        c = (c * np.exp(-t / 0.012) + high(noise(0.06), 3000) * env_exp(0.06, 0.003) * 0.8).astype(np.float32)
        k = _n(i * RNG.uniform(0.035, 0.06))
        out[k:k + len(c)] += c[:len(out) - k] * (1 - 0.2 * i)
    return out


def tick():
    """ป้ายเลขปีหมุน: เสียงแผ่นพลิกเล็ก ๆ"""
    return (band(noise(0.02), 1500, 7000) * env_exp(0.02, 0.003)).astype(np.float32)


def heartbeat():
    t = np.arange(_n(0.6)) / SR

    def thump(at, g):
        y = np.zeros_like(t)
        m = t >= at
        tt = t[m] - at
        y[m] = np.sin(2 * np.pi * 48 * tt) * np.exp(-tt / 0.07) * g
        return y
    return (thump(0, 1.0) + thump(0.19, 0.7)).astype(np.float32)


def bounce():
    t = np.arange(_n(0.2)) / SR
    return (np.sin(2 * np.pi * 120 * t) * np.exp(-t / 0.03) * 0.6 + low(noise(0.2), 1500) * env_exp(0.2, 0.01) * 0.5).astype(np.float32)


def crowd_layer(dur, lo=250, hi=2600, rate=(0.15, 1.2)):
    """เสียงฝูงชนพึมพำ: noise หลายย่านที่ดังเบาสลับกันช้า ๆ (stereo ไม่เหมือนกัน)"""
    out = np.zeros((2, _n(dur)), np.float32)
    t = np.arange(_n(dur)) / SR
    for ch in range(2):
        for (a, b) in ((lo, lo * 2.2), (lo * 2, hi * 0.6), (hi * 0.5, hi)):
            x = band(noise(dur), a, b, 2)
            am = 0.6 + 0.4 * np.sin(2 * np.pi * RNG.uniform(*rate) * t + RNG.uniform(0, 6))
            am *= 0.7 + 0.3 * np.sin(2 * np.pi * RNG.uniform(*rate) * 0.37 * t + RNG.uniform(0, 6))
            out[ch] += x * am.astype(np.float32)
    return out / 3


def applause(dur, density=380):
    """เสียงปรบมือ: เสียงตบมือสั้น ๆ จำนวนมากที่เวลาสุ่ม"""
    n = _n(dur)
    out = np.zeros((2, n), np.float32)
    kern = (band(noise(0.03), 900, 4200) * env_exp(0.03, 0.006)).astype(np.float32)
    for ch in range(2):
        imp = np.zeros(n, np.float32)
        k = int(density * dur)
        imp[RNG.integers(0, n, k)] = RNG.uniform(0.2, 1.0, k).astype(np.float32)
        out[ch] = signal.fftconvolve(imp, kern)[:n].astype(np.float32)
    return out


def whistle():
    """นกหวีดหมดเวลา 3 ครั้ง (สั้น สั้น ยาว) ได้ยินจากไกล ๆ ในสนาม"""
    parts = []
    for d in (0.22, 0.22, 0.95):
        t = np.arange(_n(d)) / SR
        trill = np.sin(2 * np.pi * 27 * t)
        f = 2850 + 140 * trill
        ph = 2 * np.pi * np.cumsum(f) / SR
        tone = np.sin(ph) + 0.25 * np.sin(2 * ph)
        am = (0.75 + 0.25 * trill) * np.minimum(1, t / 0.015) * np.minimum(1, (d - t) / 0.05)
        breath = band(noise(d), 2000, 6000) * 0.25
        parts.append(((tone * am) + breath * am).astype(np.float32))
        parts.append(np.zeros(_n(0.14), np.float32))
    y = np.concatenate(parts)
    y = low(y, 6500)
    wet = signal.fftconvolve(y, reverb_ir(2.4, 0.6))[:len(y) + _n(2.4)].astype(np.float32)
    out = np.zeros(len(wet), np.float32)
    out[:len(y)] += y * 0.35
    return out + wet * 0.65


# ---------------------------------------------------------------- score the timeline
def build(tl):
    dur = tl.duration
    bus = Bus(dur + 3)
    shot = {s["id"]: s for s in tl.shots}

    # --- 1 เสียงฝูงชน: ระดับตามความสว่างของสนามในแต่ละช็อต + จุดที่ตั้งใจให้เงียบ/ระเบิด
    keys = []  # (เวลา, ระดับ 0..1)
    for s in tl.shots:
        st = s.get("world", {}).get("stadium", 0.5)
        a, b = (st if isinstance(st, list) else [st, st])
        keys += [(s["start"] + 0.05, 0.55 * a), (s["end"] - 0.05, 0.55 * b)]
    over = {"S01": (0, 0), "S07": (0.15, 0.02), "S11": (0.12, 0.08), "S13": (0.06, 0.05), "S14": (0.15, 0.2),
            "S16": (0.35, 0.12), "S17": (1.0, 0.85), "S18": (0.8, 0.6), "S23": (0.5, 0.55), "S24": (0.3, 0.0)}
    for sid, (a, b) in over.items():
        s = shot[sid]
        keys = [k for k in keys if not (s["start"] <= k[0] <= s["end"])] + [(s["start"] + 0.05, a), (s["end"] - 0.05, b)]
    keys.sort()
    kt, kv = np.array([k[0] for k in keys]), np.array([k[1] for k in keys])
    t = np.arange(bus.x.shape[1]) / SR
    lvl = np.interp(t, kt, kv).astype(np.float32)
    lvl = signal.sosfiltfilt(signal.butter(1, 1.5, fs=SR, output="sos"), lvl).astype(np.float32).clip(0, 1)
    crowd = crowd_layer(bus.x.shape[1] / SR)
    # ปี 2006 = เสียงทีวีเก่า (ตัดเสียงสูง)
    s3, s4 = shot["S03"], shot["S04"]
    old = (t >= s3["start"]) & (t < s4["end"])
    for ch in range(2):
        muffled = low(crowd[ch], 1800, 2)
        crowd[ch] = np.where(old, muffled, crowd[ch])
    bus.x += crowd * lvl * 0.085

    # --- 2 ปรบมือ: ช่วงฉลอง 2022 และ Monumental
    for sid, g in (("S17", 0.07), ("S18", 0.05), ("S23", 0.085)):
        s = shot[sid]
        ap = applause(s["end"] - s["start"] + 1.5)
        fade = np.minimum(1, np.minimum(np.arange(ap.shape[1]) / _n(0.6), (ap.shape[1] - np.arange(ap.shape[1])) / _n(1.5)))
        bus.x[:, int(s["start"] * SR):int(s["start"] * SR) + ap.shape[1]] += (ap * fade * g)[:, :bus.x.shape[1] - int(s["start"] * SR)]

    # --- 3 เหตุการณ์จาก action
    sh = shutter()
    for a in tl.actions:
        d, t0 = a["do"], a["t"]
        if d == "odometer":
            bus.put(t0 - 0.35, whoosh(0.8), 0.10)
            for i in range(4):
                bus.put(t0 + 0.08 * i + 0.1, tick(), 0.06, RNG.uniform(-0.3, 0.3))
        elif d == "flashbulbs":
            rate = (a.get("rate", 4) + a.get("rate_end", a.get("rate", 4))) / 2
            for _ in range(int(min(rate, 10) * a["dur"] * 0.6)):
                bus.put(t0 + RNG.uniform(0, a["dur"]), sh, RNG.uniform(0.02, 0.06), RNG.uniform(-0.8, 0.8))
        elif d == "number" and a.get("flip"):
            f = a["flip"] if not isinstance(a["flip"], list) else a["flip"][0]
            bus.put(f + 0.04, brick_clack(4), 0.22)  # ตอนแผ่นป้ายพลิกแปะลง (compose.FLIP_POST)
        elif d in ("bignum", "score") and a.get("slam"):
            bus.put(t0, boom(), 0.5)
        elif d == "bignum" and a.get("flip"):
            for f in a["flip"]:
                bus.put(f, brick_clack(2), 0.12)
        elif d == "crt_off":
            bus.put(t0, (high(noise(0.08), 4000) * env_exp(0.08, 0.02)).astype(np.float32), 0.15)
            bus.put(t0 + 0.05, boom(1.2), 0.25)
        elif d == "ball":
            if a.get("mode") == "whip":
                bus.put(t0 - 0.1, whoosh(0.7, rising=False), 0.25, 0.0)
            else:
                for k, g in ((0.35, 0.5), (0.75, 0.3), (1.05, 0.15)):
                    bus.put(t0 + k, bounce(), 0.12 * g / 0.5)
        elif d == "lightbanks":
            n = a.get("count", 7)
            for i in range(n):
                tb = tl.beat.snap(t0 + i * a["dur"] * 0.85 / n, "beat", 0.3)
                bus.put(tb, thunk(), 0.16, -0.8 + 1.6 * i / (n - 1))
        elif d == "heartbeat":
            beats = ([b for b in tl.beat.beats if t0 <= b <= t0 + a["dur"]] if tl.beat.ok
                     else [t0 + i * 0.75 for i in range(int(a["dur"] / 0.75) + 1)])
            for b in beats:
                bus.put(b, heartbeat(), 0.45)
        elif d == "flash" and a["dur"] >= 0.4:  # แสงวาบใหญ่ก่อนแชมป์
            bus.put(t0 - 0.6, whoosh(0.65), 0.18)
            bus.put(t0, boom(2.5), 0.45)
        elif d == "lightpulse":
            for i in range(a.get("count", 4)):
                tp = tl.beat.snap(t0 + i * a.get("step", 0.7), "beat", 0.25)
                burst = crowd_layer(0.9, 600, 3500, (2, 4))
                e = env_exp(0.9, 0.35, 0.04)
                bus.x[:, int(tp * SR):int(tp * SR) + burst.shape[1]] += burst * e * 0.12
        elif d == "trophy" and a.get("mode") == "dissolve":
            bus.put(t0 + 1.4, whoosh(1.8), 0.08)

    # --- 4 นกหวีดหมดเวลา: จบ Monumental ก่อนกลับสู่ภาพถ่ายจริง
    bus.put(shot["S24"]["start"] - 0.1, whistle(), 0.15, 0.15)

    # --- 5 ช่วงภาพถ่ายต้นฉบับ = เงียบ (ต้นเรื่อง/ท้ายเรื่อง)
    mute = np.ones(bus.x.shape[1], np.float32)
    s1 = shot["S01"]
    mute[:int((s1["end"] + 0.3) * SR)] = np.clip((np.arange(int((s1["end"] + 0.3) * SR)) / SR - s1["end"] + 0.6) / 0.9, 0, 1)
    end_fade = shot["S24"]["start"] + 1.6
    tt = np.arange(bus.x.shape[1]) / SR
    mute *= np.clip(1 - (tt - end_fade) / 1.4, 0, 1).astype(np.float32)
    bus.x *= mute

    x = bus.x[:, :_n(dur)]
    peak = np.abs(x).max()
    if peak > 0.5:  # เพดาน -6 dBFS ให้เพลงเป็นตัวหลัก
        x *= 0.5 / peak
    return x


def write_wav(x, path):
    pcm = (np.clip(x.T, -1, 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mux", default=None, help="วิดีโอที่จะใส่เสียงประกอบ")
    a = ap.parse_args()
    tl = Timeline()
    os.makedirs(os.path.join(ROOT, "out"), exist_ok=True)
    wav = os.path.join(ROOT, "out", "sfx_bed.wav")
    x = build(tl)
    write_wav(x, wav)
    print(f"{wav} · {x.shape[1] / SR:.1f}s · peak {20 * np.log10(np.abs(x).max() + 1e-9):.1f} dBFS")
    if a.mux:
        out = os.path.splitext(a.mux)[0] + "_sfx.mp4"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", a.mux, "-i", wav, "-map", "0:v", "-map", "1:a",
                        "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-shortest", "-movflags", "+faststart", out], check=True)
        print(out)


if __name__ == "__main__":
    main()
