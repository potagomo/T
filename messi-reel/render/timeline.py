"""โหลด timeline.json + beatmap แล้วจัดเวลาให้ลงจังหวะ

หลักการ
- เวลาใน timeline.json คือ "เวลาตามแผน" (วินาทีของคลิป)
- ถ้ามี sync/beatmap.json: ขอบช็อตถูกดึงเข้าหา downbeat ที่ใกล้ที่สุด (ภายใน snap_tolerance)
  แล้วเวลาทุกอย่างในช็อตถูกยืด/หดตามสัดส่วน (time-warp แบบเส้นตรงเป็นช่วง ๆ)
  จากนั้นจุดเริ่มของ action แต่ละตัวถูกดึงเข้าหา beat ที่ใกล้ที่สุดอีกชั้น
- ถ้าไม่มี beatmap: ใช้เวลาตามแผนตรง ๆ และปิดเอฟเฟกต์ที่เต้นตามบีต
  (ดีกว่าเต้นผิดจังหวะเมื่อใส่เพลงจริง)
"""
import bisect
import copy
import json
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# ---------- easing ----------
def clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x


def smooth(x):
    x = clamp(x)
    return x * x * (3 - 2 * x)


def ease_out(x):
    x = clamp(x)
    return 1 - (1 - x) ** 3


def ease_in(x):
    x = clamp(x)
    return x ** 3


def ease_in_out(x):
    x = clamp(x)
    return 4 * x ** 3 if x < 0.5 else 1 - (-2 * x + 2) ** 3 / 2


def back_out(x, s=1.7):
    x = clamp(x)
    x -= 1
    return x * x * ((s + 1) * x + s) + 1


def lerp(a, b, t):
    return a + (b - a) * t


def env(t, t0, dur, fade_in=0.35, fade_out=0.3):
    """ซองความดังของ element: 0 ก่อนเริ่ม → 1 → 0 หลังจบ"""
    if dur <= 0 or t < t0 or t > t0 + dur:
        return 0.0
    a = smooth((t - t0) / fade_in) if fade_in > 0 else 1.0
    b = smooth((t0 + dur - t) / fade_out) if fade_out > 0 else 1.0
    return min(a, b)


# ---------- beatmap ----------
class Beatmap:
    def __init__(self, data=None):
        self.ok = bool(data and data.get("beats"))
        self.beats = sorted(float(b) for b in (data or {}).get("beats", []))
        db = (data or {}).get("downbeats")
        self.downbeats = sorted(float(b) for b in db) if db else self.beats[::4]
        self.energy = (data or {}).get("energy") or []
        self.energy_rate = float((data or {}).get("energy_rate", 10))
        self.markers = (data or {}).get("markers") or {}
        self.bpm = (data or {}).get("bpm")

    @classmethod
    def load(cls, path):
        if path and os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                return cls(json.load(f))
        return cls(None)

    @staticmethod
    def _nearest(arr, t, tol):
        if not arr:
            return t
        i = bisect.bisect_left(arr, t)
        best = None
        for j in (i - 1, i):
            if 0 <= j < len(arr):
                d = abs(arr[j] - t)
                if best is None or d < best[0]:
                    best = (d, arr[j])
        return best[1] if best and best[0] <= tol else t

    def snap(self, t, kind, tol):
        if not self.ok or kind in (None, "none"):
            return t
        return self._nearest(self.downbeats if kind == "downbeat" else self.beats, t, tol)

    def level(self, t):
        """พลังงานเพลง 0..1 (ไม่มี beatmap → 0.5)"""
        if not self.energy:
            return 0.5
        x = t * self.energy_rate
        i = int(math.floor(x))
        if i < 0:
            return float(self.energy[0])
        if i >= len(self.energy) - 1:
            return float(self.energy[-1])
        f = x - i
        return float(self.energy[i]) * (1 - f) + float(self.energy[i + 1]) * f

    def pulse(self, t, decay=0.18, downbeat_only=False):
        """แรงกระตุ้นที่พุ่งขึ้นตรงบีตแล้วค่อย ๆ จาง (0..1) — ไม่มี beatmap → 0"""
        if not self.ok:
            return 0.0
        arr = self.downbeats if downbeat_only else self.beats
        i = bisect.bisect_right(arr, t) - 1
        if i < 0:
            return 0.0
        dt = t - arr[i]
        return math.exp(-dt / decay) if dt < decay * 5 else 0.0


# ---------- timeline ----------
class Timeline:
    def __init__(self, path=None, beatmap_path=None):
        path = path or os.path.join(ROOT, "timeline.json")
        with open(path, encoding="utf-8") as f:
            self.raw = json.load(f)
        m = self.raw["music"]
        bm = beatmap_path if beatmap_path is not None else os.path.join(ROOT, m.get("beatmap", ""))
        self.beat = Beatmap.load(bm)
        self.meta = self.raw["meta"]
        self.duration = float(self.meta["duration"])
        self.fps = int(self.meta["fps"])
        tol = float(m.get("snap_tolerance", 0.6))

        plan_shots = self.raw["shots"]
        # 1) ขอบช็อตตามแผน → ขอบที่ลงจังหวะ
        plan_edges = [float(s["start"]) for s in plan_shots] + [float(plan_shots[-1]["end"])]
        edges = []
        for k, e in enumerate(plan_edges):
            if k in (0, len(plan_edges) - 1):
                edges.append(e)  # ต้นคลิปกับท้ายคลิปไม่ขยับ
            else:
                edges.append(self.beat.snap(e, m.get("shot_snap", "downbeat"), tol))
        for k in range(1, len(edges)):  # กันช็อตกลับหัว / สั้นเกิน
            edges[k] = max(edges[k], edges[k - 1] + 0.4)
        self.plan_edges, self.edges = plan_edges, edges

        # 2) ทุก action: warp ตามช็อต แล้ว snap เข้าบีต
        self.shots = []
        for k, s in enumerate(plan_shots):
            s = copy.deepcopy(s)
            s["start"], s["end"] = edges[k], edges[k + 1]
            for a in s.get("actions", []):
                t0 = self.warp(float(a["t"]))
                t1 = self.warp(float(a["t"]) + float(a.get("dur", 0)))
                if a.get("snap", True):
                    t0 = self.beat.snap(t0, m.get("event_snap", "beat"), min(tol, 0.35))
                a["t"], a["dur"] = t0, max(0.05, t1 - t0)
                for key in ("flip",):
                    if key in a:
                        v = a[key]
                        a[key] = [self._wsnap(x, tol) for x in v] if isinstance(v, list) else self._wsnap(v, tol)
            self.shots.append(s)

        # 3) ยุค: ขอบยุค = ขอบช็อตแรกของยุคนั้น
        self.eras = []
        for e in self.raw["eras"]:
            e = dict(e)
            e["start"], e["end"] = self.warp(float(e["start"])), self.warp(float(e["end"]))
            self.eras.append(e)
        self.actions = [a | {"_shot": s["id"], "_era": s["era"]} for s in self.shots for a in s.get("actions", [])]

    def _wsnap(self, t, tol):
        return self.beat.snap(self.warp(float(t)), self.raw["music"].get("event_snap", "beat"), min(tol, 0.35))

    def warp(self, t):
        pe, e = self.plan_edges, self.edges
        if t <= pe[0]:
            return e[0] + (t - pe[0])
        if t >= pe[-1]:
            return e[-1] + (t - pe[-1])
        i = bisect.bisect_right(pe, t) - 1
        f = (t - pe[i]) / (pe[i + 1] - pe[i])
        return e[i] + f * (e[i + 1] - e[i])

    def shot_at(self, t):
        for s in self.shots:
            if s["start"] <= t < s["end"]:
                return s
        return self.shots[-1]

    def era_at(self, t):
        for e in self.eras:
            if e["start"] <= t < e["end"]:
                return e
        return self.eras[-1]

    def era_blend(self, t, width=0.22):
        """คืน (era_a, era_b, w) — w>0 ช่วงรอยต่อยุค ใช้ไล่ค่าสี/ฉากให้เนียน"""
        cur = self.era_at(t)
        idx = self.eras.index(cur)
        if idx + 1 < len(self.eras):
            nxt = self.eras[idx + 1]
            d = nxt["start"] - t
            if d < width:
                return cur, nxt, smooth(0.5 - d / (2 * width))
        if idx > 0:
            prv = self.eras[idx - 1]
            d = t - cur["start"]
            if d < width:
                return prv, cur, smooth(0.5 + d / (2 * width))
        return cur, cur, 0.0

    def active(self, t, kinds=None, pad=0.0):
        out = []
        for a in self.actions:
            if kinds and a["do"] not in kinds:
                continue
            if a["t"] - pad <= t <= a["t"] + a["dur"] + pad:
                out.append(a)
        return out

    def report(self):
        lines = [f"beatmap: {'ใช้' if self.beat.ok else 'ไม่มี (ใช้เวลาตามแผน)'}"]
        for s, pe in zip(self.shots, self.plan_edges):
            d = s["start"] - pe
            lines.append(f"{s['id']:>4} {s['era']:<6} {s['start']:6.2f}–{s['end']:6.2f}  ({s['end']-s['start']:4.2f}s){'  snap %+.2f' % d if abs(d) > 1e-6 else ''}  {s['name']}")
        return "\n".join(lines)
