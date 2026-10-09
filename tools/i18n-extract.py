#!/usr/bin/env python3
"""ดึงข้อความภาษาไทยจาก lesson/index.html (รวมชั้นเว็บแอป) ไว้ทำพจนานุกรมแปล

    python3 tools/i18n-extract.py OUT_DIR

ได้ OUT_DIR/segments.json = [{"th": ข้อความ, "ctx": [บรรทัดโค้ดตัวอย่าง]}]
"ข้อความ" มีสองแบบ ให้ตรงกับที่ตัวแปลในแอป (05-i18n.js) ค้นหา:
  1) ข้อความเต็มระหว่างแท็ก HTML / ระหว่างการต่อสตริง (ตัดช่องว่างหัวท้าย)
  2) ช่วงตัวอักษรไทยล้วน (ตัดที่ตัวเลข เครื่องหมาย ตัวอักษรอังกฤษ) — ใช้เมื่อข้อความเต็มมีค่าที่เปลี่ยนไปมาแทรกอยู่
"""
import io, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THAI = re.compile(r"[฀-๿]")
RUN = re.compile(r"[฀-๿](?:[฀-๿ ]*[฀-๿])?")


def literals(src):
    for m in re.finditer(r'"((?:[^"\\\n]|\\.)*)"|\'((?:[^\'\\\n]|\\.)*)\'|`((?:[^`\\]|\\.)*)`', src):
        s = m.group(1) if m.group(1) is not None else (m.group(2) if m.group(2) is not None else m.group(3))
        if s and THAI.search(s):
            yield s, m.start()


def unescape(s):
    s = re.sub(r"\\u([0-9a-fA-F]{4})", lambda m: chr(int(m.group(1), 16)), s)
    s = s.encode("utf-16", "surrogatepass").decode("utf-16", "replace")   # รวมคู่ \ud83d\udcbe เป็นอีโมจิ
    return s.replace("\\'", "'").replace('\\"', '"').replace("\\n", "\n").replace("\\\\", "\\")


def main():
    out = sys.argv[1]
    src = io.open(os.path.join(ROOT, "lesson", "index.html"), encoding="utf-8").read()
    lines = src.split("\n")
    # ข้อความใน HTML ตรง ๆ (นอกสคริปต์) ด้วย
    html_only = re.sub(r"<script\b.*?</script>", "", src, flags=re.S)
    html_only = re.sub(r"<style\b.*?</style>", "", html_only, flags=re.S)
    seg = {}

    def add(t, ctx):
        t = re.sub(r"\s+", " ", t).strip()
        if not t or not THAI.search(t) or len(t) > 400:
            return
        e = seg.setdefault(t, set())
        if len(e) < 2 and ctx:
            e.add(ctx[:220])

    for raw, pos in literals(src):
        s = unescape(raw)
        line = lines[src.count("\n", 0, pos)].strip()
        for piece in re.split(r"<[^>]*>|&[a-z]+;", s):
            add(piece, line)
            for r in RUN.findall(piece):
                add(r, line)
        for a in re.findall(r'(?:placeholder|title|aria-label|alt)="([^"]*)"', s):
            add(a, line)
    for piece in re.split(r"<[^>]*>", html_only):
        add(piece, "")
        for r in RUN.findall(piece):
            add(r, "")
    items = [{"th": k, "ctx": sorted(v)} for k, v in sorted(seg.items())]
    os.makedirs(out, exist_ok=True)
    json.dump(items, io.open(os.path.join(out, "segments.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    print(len(items), "ข้อความ")


if __name__ == "__main__":
    main()
