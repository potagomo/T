"""สร้างหน้า Production Storyboard (HTML) จาก timeline.json + ภาพใน storyboard/

  python3 tools/make_board.py [--status-4k "rendered 312 MB"] → out/board/index.html + out/board/frames/*.jpg

หน้านี้เผยแพร่เป็น Artifact (ส่วนตัว) ได้ที่ลิงก์ใน TASKS.md — สั่งใหม่ทุกครั้งที่แก้ timeline แล้ว publish ทับ url เดิม
"""
import argparse
import html
import json
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# เส้นอารมณ์ที่ออกแบบไว้ (ไม่ใช่ข้อมูลวัด): −1 = อกหักที่สุด · +1 = ชัยชนะ
VALENCE = {"S01": 0.15, "S02": 0.35, "S03": 0.3, "S04": 0.45, "S05": 0.5, "S06": 0.35, "S07": -0.5, "S08": 0.45,
           "S09": 0.7, "S10": -0.85, "S11": -0.75, "S12": -0.55, "S13": -0.35, "S14": -0.4, "S15": 0.45, "S16": 0.3,
           "S17": 1.0, "S18": 0.85, "S19": 0.5, "S20": 0.65, "S21": 0.7, "S22": 0.05, "S23": 0.45, "S24": 0.25}
CHAPTER = {"intro": ("เปิด", "Prologue"), "e2006": ("2006", "The beginning"), "e2010": ("2010", "Weight of expectation"),
           "e2014": ("2014", "The dream within reach"), "e2018": ("2018", "Uncertainty"), "e2022": ("2022", "World champion"),
           "e2026": ("2026", "The farewell"), "outro": ("ปิด", "Epilogue")}
FIELDS = [("emotion", "อารมณ์"), ("camera", "กล้อง"), ("layers", "ชั้นภาพ หน้า · กลาง · หลัง"), ("light", "แสงและสี"),
          ("motion", "การเคลื่อนไหว / เอฟเฟกต์"), ("transition", "ต่อไปช็อตถัดไป"), ("music", "ความสัมพันธ์กับเพลง"),
          ("method", "วิธีผลิต / asset")]


def esc(s):
    return html.escape(str(s), quote=True)


def song_time(t):
    t = 240 + t
    return f"{int(t // 60)}:{t % 60:04.1f}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--status-4k", default="กำลังเรนเดอร์")
    ap.add_argument("--status-sync", default="รอไฟล์เพลง")
    a = ap.parse_args()
    tl = json.load(open(os.path.join(ROOT, "timeline.json"), encoding="utf-8"))
    out = os.path.join(ROOT, "out", "board")
    os.makedirs(os.path.join(out, "frames"), exist_ok=True)
    shots = tl["shots"]
    for s in shots:
        src = os.path.join(ROOT, "storyboard", f"{s['id']}.jpg")
        Image.open(src).resize((360, 640), Image.LANCZOS).save(os.path.join(out, "frames", f"{s['id']}.jpg"), quality=84)

    eras = tl["eras"]
    dur = tl["meta"]["duration"]
    fps = tl["meta"]["fps"]

    # ---------- ตัวหนังสือบนจอทั้งเรื่อง (ไว้โชว์ในการ์ด)
    def on_screen(s):
        out_ = []
        for x in s.get("actions", []):
            if x["do"] == "text":
                out_.append(x["text"].replace("\n", " "))
            elif x["do"] == "odometer":
                out_.append(x["to"])
            elif x["do"] == "bignum":
                out_.append(" → ".join(x["seq"]))
            elif x["do"] == "counter":
                out_.append(f"{x['from']}→{x['to']}{x.get('suffix', '')}")
            elif x["do"] == "stars":
                out_.append("★★★")
        return out_

    cards = []
    for s in shots:
        ch_short, ch_name = CHAPTER[s["era"]]
        n = s.get("notes", {})
        rows = "".join(f'<div class="f"><dt>{esc(lbl)}</dt><dd>{esc(n.get(k, "–"))}</dd></div>' for k, lbl in FIELDS)
        txt = on_screen(s)
        txt_html = "".join(f"<li>{esc(t)}</li>" for t in txt) if txt else '<li class="none">ไม่มีตัวหนังสือ</li>'
        d = s["end"] - s["start"]
        cards.append(f"""
<article class="shot" id="{esc(s['id'])}">
  <figure class="frame"><img src="frames/{esc(s['id'])}.jpg" alt="{esc(s['id'])} {esc(s['name'])}" loading="lazy" width="360" height="640"></figure>
  <div class="body">
    <header>
      <p class="eyebrow"><span class="chip ch-{esc(s['era'])}">{esc(ch_short)}</span> {esc(ch_name)}</p>
      <h3><span class="sid">{esc(s['id'])}</span> {esc(s['name'])}</h3>
      <p class="tc"><span>{s['start']:.1f}–{s['end']:.1f} s</span><span>{d:.1f} s · {round(d * fps)} เฟรม</span><span>เพลง {song_time(s['start'])}–{song_time(s['end'])}</span></p>
    </header>
    <dl>{rows}</dl>
    <div class="ost"><p class="lbl">ตัวหนังสือบนจอ</p><ul>{txt_html}</ul></div>
  </div>
</article>""")

    # ---------- แถบสัดส่วนบท
    segs = []
    for e in eras:
        ln = e["end"] - e["start"]
        short, name = CHAPTER[e["id"]]
        segs.append(dict(id=e["id"], short=short, name=name, start=e["start"], len=ln, pct=round(100 * ln / dur, 1)))
    bar = "".join(f'<div class="seg{" hi" if g["id"] == "e2026" else ""}" style="flex:{g["len"]}" title="{esc(g["short"])} · {g["len"]:g} s"></div>' for g in segs)
    legend = "".join(f'<li class="{"hi" if g["id"] == "e2026" else ""}"><b>{esc(g["short"])}</b><span>{g["len"]:g} s</span><span>{g["pct"]:g}%</span></li>' for g in segs)

    chart_data = [dict(id=s["id"], name=s["name"], t0=s["start"], t1=s["end"], v=VALENCE[s["id"]],
                       emo=s.get("notes", {}).get("emotion", ""), era=CHAPTER[s["era"]][0]) for s in shots]
    era_data = [dict(short=g["short"], t0=g["start"], t1=g["start"] + g["len"]) for g in segs]
    table_rows = "".join(f"<tr><td>{esc(c['id'])}</td><td>{c['t0']:.1f}–{c['t1']:.1f}</td><td>{c['v']:+.2f}</td><td>{esc(c['emo'])}</td></tr>" for c in chart_data)

    tpl = open(os.path.join(ROOT, "tools", "board_template.html"), encoding="utf-8").read()
    page = (tpl.replace("{{CARDS}}", "".join(cards))
               .replace("{{BAR}}", bar).replace("{{LEGEND}}", legend)
               .replace("{{CHART_DATA}}", json.dumps(chart_data, ensure_ascii=False))
               .replace("{{ERA_DATA}}", json.dumps(era_data, ensure_ascii=False))
               .replace("{{TABLE_ROWS}}", table_rows)
               .replace("{{STATUS_4K}}", esc(a.status_4k)).replace("{{STATUS_SYNC}}", esc(a.status_sync))
               .replace("{{FRAMES}}", f"{round(dur * fps):,}").replace("{{DUR}}", f"{dur:g}").replace("{{FPS}}", str(fps))
               .replace("{{NSHOTS}}", str(len(shots))))
    with open(os.path.join(out, "index.html"), "w", encoding="utf-8") as f:
        f.write(page)
    print(os.path.join(out, "index.html"))


if __name__ == "__main__":
    main()
