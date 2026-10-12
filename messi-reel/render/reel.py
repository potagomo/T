"""คำสั่ง render ทั้งหมด

  python3 -m render.reel report                      ดูเวลาช็อตหลังลงจังหวะ
  python3 -m render.reel still 23.6 47.5            ภาพนิ่งเฉพาะวินาที (ขนาด storyboard)
  python3 -m render.reel storyboard                  สตอรีบอร์ด 24 ช็อต → storyboard/*.png
  python3 -m render.reel preview                     คลิปร่าง 540x960 (H.264) → out/preview.mp4
  python3 -m render.reel final                       ตัวจริง 2160x3840 HEVC → out/messi_reel_4k_hevc.mp4
      --from 20 --to 30      render เฉพาะช่วง (ไว้ตรวจงาน)
      --workers 4            จำนวน process ที่ render พร้อมกัน
      --audio song.m4a       (ไม่บังคับ) ใส่เพลงเพื่อดูเองเท่านั้น ห้ามอัปขึ้น git — ตัดจาก --song-in วินาที
      --clicks               ใส่เสียงเคาะตาม beatmap แทนเพลง (ไว้เช็กว่าภาพตัดลงบีต โดยไม่ต้องมีไฟล์เพลง)
"""
import argparse
import multiprocessing as mp
import os
import subprocess
import sys
import time

import numpy as np
from PIL import Image, ImageDraw

from . import gfx
from .timeline import ROOT, Timeline

OUT = os.path.join(ROOT, "out")


def _renderer(w, h, beatmap=None):
    from .compose import Renderer
    tl = Timeline(beatmap_path=beatmap)
    return tl, Renderer(tl, w, h)


# ---------------------------------------------------------------- encoding
def _ffmpeg_cmd(path, w, h, fps, codec):
    base = ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-r", str(fps), "-i", "-"]
    color = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"]
    if codec == "hevc":
        v = ["-c:v", "libx265", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", "-profile:v", "main", "-tag:v", "hvc1",
             "-x265-params", "keyint=60:min-keyint=30:aq-mode=3:pools=2:log-level=error"]
    else:
        v = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p", "-g", "60"]
    return base + v + color + ["-movflags", "+faststart", path]


def _work(args):
    i, f0, f1, w, h, codec, path, beatmap, threads = args
    import cv2
    import numexpr
    cv2.setNumThreads(threads)  # หลาย process พร้อมกัน → แบ่งคอร์กัน ไม่แย่งกันจนช้า
    numexpr.set_num_threads(threads)
    tl, r = _renderer(w, h, beatmap)
    fps = tl.fps
    p = subprocess.Popen(_ffmpeg_cmd(path, w, h, fps, codec), stdin=subprocess.PIPE)
    t0 = time.time()
    for f in range(f0, f1):
        p.stdin.write(r.frame(f / fps, f).tobytes())
        if i == 0 and (f - f0) % 30 == 0:
            done = f - f0 + 1
            print(f"  [{done}/{f1 - f0}] {(time.time() - t0) / done:.2f}s/เฟรม", flush=True)
    p.stdin.close()
    if p.wait() != 0:
        raise RuntimeError(f"ffmpeg ล้มเหลว: {path}")
    return path


def click_track(tl, path, t_from, t_to, sr=48000):
    """เสียงเคาะจาก beatmap: บีตธรรมดาเสียงต่ำ downbeat เสียงสูง"""
    import wave
    n = int((t_to - t_from) * sr)
    x = np.zeros(n, np.float32)
    tt = np.arange(int(0.05 * sr)) / sr
    downs = set(round(b, 3) for b in tl.beat.downbeats)
    for b in tl.beat.beats:
        i = int((b - t_from) * sr)
        if 0 <= i < n:
            f = 1568 if round(b, 3) in downs else 1046
            c = np.sin(2 * np.pi * f * tt) * np.exp(-tt * 70) * (0.6 if f > 1100 else 0.35)
            x[i:i + len(c)] += c[:n - i]
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((np.clip(x, -1, 1) * 32000).astype(np.int16).tobytes())


def render_video(name, w, h, codec, t_from=0.0, t_to=None, workers=4, beatmap=None, audio=None, song_in=240.0, clicks=False):
    os.makedirs(OUT, exist_ok=True)
    tl = Timeline(beatmap_path=beatmap)
    fps = tl.fps
    t_to = tl.duration if t_to is None else t_to
    f0, f1 = int(round(t_from * fps)), int(round(t_to * fps))
    print(tl.report().splitlines()[0])
    # สร้าง cache ของหุ่นก่อน แล้วค่อยแตก process
    from .hero import build_source
    build_source(os.path.join(ROOT, tl.raw["hero"]["image"]), os.path.join(ROOT, tl.raw["hero"]["rig"]))
    n = max(1, min(workers, (f1 - f0) // 30))
    edges = np.linspace(f0, f1, n + 1).astype(int)
    tmp = os.path.join(OUT, f".{name}_parts")
    os.makedirs(tmp, exist_ok=True)
    threads = max(1, (os.cpu_count() or 4) // n)
    jobs = [(i, edges[i], edges[i + 1], w, h, codec, os.path.join(tmp, f"part{i:02d}.mp4"), beatmap, threads) for i in range(n)]
    t0 = time.time()
    print(f"render {name}: {w}x{h} · เฟรม {f0}–{f1} ({(f1 - f0) / fps:.1f}s) · {n} process")
    with mp.get_context("fork").Pool(n) as pool:
        parts = pool.map(_work, jobs)
    lst = os.path.join(tmp, "list.txt")
    with open(lst, "w") as f:
        f.writelines(f"file '{p}'\n" for p in parts)
    out = os.path.join(OUT, f"{name}.mp4")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy",
                    "-movflags", "+faststart", out], check=True)
    for p in parts:
        os.remove(p)
    os.remove(lst)
    os.rmdir(tmp)
    print(f"เสร็จ {out} · {(time.time() - t0) / 60:.1f} นาที · {os.path.getsize(out) / 1e6:.1f} MB")
    if audio:
        out_a = os.path.join(OUT, f"{name}_with_audio.mp4")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", out, "-ss", str(song_in + t_from), "-t", str(t_to - t_from),
                        "-i", audio, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "256k",
                        "-af", f"afade=t=out:st={max(0, t_to - t_from - 1.2)}:d=1.2", "-shortest", out_a], check=True)
        print(f"พร้อมเพลง (ดูเองเท่านั้น) → {out_a}")
    elif clicks and tl.beat.ok:
        wav = os.path.join(OUT, f".{name}_clicks.wav")
        click_track(tl, wav, t_from, t_to)
        out_c = os.path.join(OUT, f"{name}_clicks.mp4")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", out, "-i", wav, "-map", "0:v", "-map", "1:a", "-c:v", "copy",
                        "-c:a", "aac", "-b:a", "128k", "-shortest", out_c], check=True)
        os.remove(wav)
        print(f"พร้อมเสียงเคาะตามบีต → {out_c}")
    return out


# ---------------------------------------------------------------- stills / storyboard
def stills(times, w, h, beatmap=None, label=True):
    tl, r = _renderer(w, h, beatmap)
    out = []
    for t in times:
        out.append(Image.fromarray(r.frame(t, int(t * tl.fps))))
    return tl, out


def storyboard(beatmap=None):
    tl = Timeline(beatmap_path=beatmap)
    w, h = tl.meta["storyboard"]["w"], tl.meta["storyboard"]["h"]
    picks = []
    for s in tl.shots:
        bt = s.get("board")
        t = bt if bt is not None else s["start"] + (s["end"] - s["start"]) * 0.62
        picks.append((s, t))
    _, ims = stills([t for _, t in picks], w, h, beatmap)
    os.makedirs(os.path.join(ROOT, "storyboard"), exist_ok=True)
    for im, (s, t) in zip(ims, picks):
        im.save(os.path.join(ROOT, "storyboard", f"{s['id']}.jpg"), quality=88)

    # แผ่นรวม 2 แผ่น แผ่นละ 12 ช็อต (4 x 3)
    cols, rows = 4, 3
    tw, th = 300, int(300 * h / w)
    cap = 92
    pad = 18
    era_names = {e["id"]: e for e in tl.eras}
    sheets = []
    for sh in range(0, len(picks), cols * rows):
        chunk = picks[sh:sh + cols * rows]
        Wd = cols * tw + (cols + 1) * pad
        Hd = 120 + rows * (th + cap + pad) + pad
        sheet = Image.new("RGB", (Wd, Hd), (12, 16, 26))
        d = ImageDraw.Draw(sheet)
        f_t = gfx.font("display", 46)
        f_c = gfx.font("ui", 17)
        f_s = gfx.font("ui_medium", 15)
        d.text((pad, 30), f"THE LAST DANCE OF A GENERATION — {sh // 12 + 1}/2", font=f_t, fill=(240, 240, 240))
        d.text((pad, 86), f"LEGO Messi · 9:16 · {tl.duration:g}s · {tl.fps} fps · Coldplay — Politik 4:00–5:19", font=f_s, fill=(117, 170, 219))
        for k, (s, t) in enumerate(chunk):
            cx = pad + (k % cols) * (tw + pad)
            cy = 120 + (k // cols) * (th + cap + pad)
            im = Image.open(os.path.join(ROOT, "storyboard", f"{s['id']}.jpg")).resize((tw, th), Image.LANCZOS)
            sheet.paste(im, (cx, cy))
            e = era_names[s["era"]]
            yr = s["era"][1:] if s["era"].startswith("e") else s["era"].upper()
            d.text((cx, cy + th + 8), f"{s['id']} · {yr} · {s['name']}", font=f_c, fill=(245, 245, 245))
            d.text((cx, cy + th + 32), f"{s['start']:.1f}–{s['end']:.1f}s  ({s['end'] - s['start']:.1f}s)", font=f_s, fill=(117, 170, 219))
            emo = s.get("notes", {}).get("emotion", e.get("emotion", "")).split(" — ")[0]
            f_e = gfx.font("thai", 16)
            while emo and d.textlength(emo, font=f_e) > tw:
                emo = emo[:-1]
            d.text((cx, cy + th + 52), emo, font=f_e, fill=(242, 193, 78))
        p = os.path.join(ROOT, "storyboard", f"storyboard_{sh // 12 + 1}.jpg")
        sheet.save(p, quality=90)
        sheets.append(p)
    return sheets


def main(argv=None):
    ap = argparse.ArgumentParser(prog="render.reel")
    ap.add_argument("cmd", choices=["report", "still", "storyboard", "preview", "final"])
    ap.add_argument("times", nargs="*", type=float)
    ap.add_argument("--from", dest="t_from", type=float, default=0.0)
    ap.add_argument("--to", dest="t_to", type=float, default=None)
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 4)))
    ap.add_argument("--beatmap", default=None, help="ใช้ beatmap ไฟล์อื่น (ค่าเริ่มต้น sync/beatmap.json)")
    ap.add_argument("--audio", default=None)
    ap.add_argument("--song-in", type=float, default=240.0)
    ap.add_argument("--clicks", action="store_true")
    ap.add_argument("--size", default="storyboard", choices=["storyboard", "preview", "final"])
    a = ap.parse_args(argv)
    tl = Timeline(beatmap_path=a.beatmap)
    if a.cmd == "report":
        print(tl.report())
    elif a.cmd == "still":
        sz = tl.meta[a.size]
        _, ims = stills(a.times, sz["w"], sz["h"], a.beatmap)
        os.makedirs(OUT, exist_ok=True)
        for t, im in zip(a.times, ims):
            p = os.path.join(OUT, f"still_{t:06.2f}.png")
            im.save(p)
            print(p)
    elif a.cmd == "storyboard":
        for p in storyboard(a.beatmap):
            print(p)
    elif a.cmd == "preview":
        sz = tl.meta["preview"]
        render_video("preview", sz["w"], sz["h"], "h264", a.t_from, a.t_to, a.workers, a.beatmap, a.audio, a.song_in, a.clicks)
    elif a.cmd == "final":
        sz = tl.meta["final"]
        name = "messi_reel_4k_hevc" if a.t_from == 0 and a.t_to is None else f"final_{a.t_from:g}-{a.t_to:g}"
        render_video(name, sz["w"], sz["h"], "hevc", a.t_from, a.t_to, a.workers, a.beatmap, a.audio, a.song_in, a.clicks)


if __name__ == "__main__":
    sys.exit(main())
