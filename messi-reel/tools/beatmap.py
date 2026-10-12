"""หาบีตจากไฟล์เพลงในเครื่อง → sync/beatmap.json (อัลกอริทึมเดียวกับ tools/beatmap.html)

ใช้เมื่อมีไฟล์เพลงอยู่ในเครื่องที่รันอยู่ (เช่นเจ้าของงานแนบไฟล์ให้ session นี้)
ไฟล์เพลงห้ามขึ้น git — ผลลัพธ์มีแค่ตัวเลขเวลา ไม่มีเสียง

  python3 tools/beatmap.py /path/to/politik.m4a                 # ช่วง 4:00 ยาว 79 วินาที
  python3 tools/beatmap.py song.m4a --start 4:00 --len 79 --out sync/beatmap.json
  python3 tools/beatmap.py song.m4a --bpm-x2     # ถ้าบีตห่างไปครึ่งหนึ่ง
  python3 tools/beatmap.py song.m4a --phase 1    # เลื่อนจังหวะ 1 (downbeat)
"""
import argparse
import json
import os
import subprocess

import numpy as np

FPS = 100
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def decode(path, start, length, sr=22050):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", str(start), "-t", str(length), "-i", path,
                          "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).copy(), sr


def _normalize(e, w=25):
    cs = np.concatenate([[0], np.cumsum(e, dtype=np.float64)])
    i = np.arange(len(e))
    a, b = np.maximum(0, i - w), np.minimum(len(e), i + w + 1)
    out = np.maximum(0, e - (cs[b] - cs[a]) / (b - a))
    sd = np.sqrt(np.mean(out ** 2)) or 1.0
    return (out / sd).astype(np.float32)


def onset(x, sr, n=2048):
    hop = sr / FPS
    frames = int(len(x) // hop)
    win = np.hanning(n + 1)[:-1].astype(np.float32)
    pad = np.concatenate([np.zeros(n // 2, np.float32), x, np.zeros(n, np.float32)])
    idx = (np.round(np.arange(frames) * hop)).astype(int)
    k_hi = min(n // 2, round(8000 / sr * n))
    k_lo = max(2, round(150 / sr * n))
    env, low = np.zeros(frames, np.float32), np.zeros(frames, np.float32)
    prev = np.zeros(n // 2 + 1, np.float32)
    for c0 in range(0, frames, 512):  # ทีละก้อน ประหยัดแรม
        sl = idx[c0:c0 + 512]
        seg = np.stack([pad[s:s + n] for s in sl]) * win
        m = np.log1p(100 * np.abs(np.fft.rfft(seg, axis=1))).astype(np.float32)
        d = np.diff(np.vstack([prev[None], m]), axis=0)
        d = np.maximum(d, 0)
        env[c0:c0 + len(sl)] = d[:, 1:k_hi].sum(1)
        low[c0:c0 + len(sl)] = d[:, 1:k_lo + 1].sum(1)
        prev = m[-1]
    lat = 0.7 * (n / 2) / sr  # ชดเชยหน้าต่างที่อยู่กึ่งกลางเฟรม (เหมือนในหน้าเว็บ)
    return _normalize(env), _normalize(low), lat


def tempo(env, center=90.0):
    best, best_lag, ac = -1.0, 60, {}
    for lag in range(int(FPS * 60 / 200), int(np.ceil(FPS * 60 / 50)) + 1):
        s = float(np.dot(env[:-lag], env[lag:])) / (len(env) - lag)
        ac[lag] = s
        bpm = FPS * 60 / lag
        w = np.exp(-0.5 * (np.log2(bpm / center) / 0.9) ** 2)
        if s * w > best:
            best, best_lag = s * w, lag
    a, b, c = ac.get(best_lag - 1, ac[best_lag]), ac[best_lag], ac.get(best_lag + 1, ac[best_lag])
    den = a - 2 * b + c
    off = 0.5 * (a - c) / den if den else 0.0
    return FPS * 60 / (best_lag + max(-0.5, min(0.5, off)))


def track(env, bpm, tight=100.0):
    p, n = FPS * 60 / bpm, len(env)
    score = np.zeros(n, np.float32)
    back = np.full(n, -1)
    for i in range(n):
        j0, j1 = max(0, round(i - 2 * p)), i - round(p / 2)
        if j1 >= j0:
            js = np.arange(j0, j1 + 1)
            v = score[js] - tight * np.log((i - js) / p) ** 2
            k = int(np.argmax(v))
            if v[k] > 0:
                score[i] = env[i] + v[k]
                back[i] = js[k]
                continue
        score[i] = env[i]
    end = n - round(p) + int(np.argmax(score[max(0, n - round(p)):]))
    beats = []
    i = end
    while i >= 0:
        beats.append(i / FPS)
        i = back[i]
    return beats[::-1]


def downbeat_phase(beats, low, env):
    sc = []
    for k in range(4):
        f = [round(b * FPS) for i, b in enumerate(beats) if i % 4 == k]
        f = [x for x in f if x < len(env)]
        sc.append(float(low[f].sum() + 0.3 * env[f].sum()))
    return int(np.argmax(sc))


def energy(x, sr, rate=10):
    hop = sr // rate
    n = len(x) // hop
    e = np.sqrt((x[:n * hop].reshape(n, hop) ** 2).mean(1))
    lo, hi = np.quantile(e, 0.05), np.quantile(e, 0.97)
    return [round(float(v), 2) for v in np.clip((e - lo) / ((hi - lo) or 1), 0, 1) ** 0.8]


def parse_start(s):
    if ":" in s:
        m, sec = s.split(":")
        return int(m) * 60 + float(sec)
    return float(s)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("--start", default="4:00")
    ap.add_argument("--len", type=float, default=79.0)
    ap.add_argument("--out", default=os.path.join(ROOT, "sync", "beatmap.json"))
    ap.add_argument("--bpm-x2", action="store_true")
    ap.add_argument("--bpm-half", action="store_true")
    ap.add_argument("--phase", type=int, default=None)
    ap.add_argument("--nudge-ms", type=float, default=0.0)
    a = ap.parse_args()
    start = parse_start(a.start)
    x, sr = decode(a.audio, start, a.len)
    env, low, lat = onset(x, sr)
    bpm = tempo(env) * (2 if a.bpm_x2 else 1) / (2 if a.bpm_half else 1)
    raw = track(env, bpm)
    ph = downbeat_phase(raw, low, env) if a.phase is None else a.phase % 4
    beats = [round(b + lat + a.nudge_ms / 1000, 3) for b in raw]
    dur = len(x) / sr
    out = dict(source=f"Coldplay — Politik ({os.path.basename(a.audio)})", song_in=start, duration=round(dur, 2), bpm=round(bpm, 2),
               beats=beats, downbeats=[b for i, b in enumerate(beats) if i % 4 == ph], energy_rate=10, energy=energy(x, sr),
               markers={}, made_with="tools/beatmap.py v1")
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    print(f"{len(beats)} บีต · {bpm:.1f} BPM · downbeat phase {ph} → {a.out}")


if __name__ == "__main__":
    main()
