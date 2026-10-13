"""ดึงภาพถ่ายจริงจาก Wikimedia Commons สำหรับจอยักษ์ — ตรวจสิทธิ์จาก API ก่อนดาวน์โหลดทุกครั้ง

  python3 tools/archive_fetch.py "File:Lionel Messi 2010.jpg" --as 2010_cape_town.jpg
  python3 tools/archive_fetch.py --check "File:Messi vs Nigeria1.jpg"        # ตรวจอย่างเดียว ไม่โหลด
  python3 tools/archive_fetch.py --owner my_photo.jpg --as 2006_owner.jpg --credit "ภาพจากเจ้าของงาน"
  python3 tools/archive_fetch.py --url https://.../photo.jpg --as 2022_trophy.jpg --credit "ช่างภาพ / สำนักข่าว"

โหมด Commons ตรวจสัญญาอนุญาตให้ด้วย (รับ PD · CC0 · CC BY · CC BY-SA)
โหมด --url / --owner ไม่ตรวจสิทธิ์ (เจ้าของงานยืนยันว่ามีสิทธิ์ใช้ภาพทุกแหล่ง 2026-10-13) แต่ต้องใส่ --credit เสมอ
ผลลัพธ์: ไฟล์ใน input/archive/ (ไม่เข้า git) + บรรทัดเครดิตต่อท้าย input/archive/credits.md
ต้องเปิดโดเมน commons.wikimedia.org และ upload.wikimedia.org ใน network ของ environment ก่อน
"""
import argparse
import html
import json
import os
import re
import shutil
import sys
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARCH = os.path.join(ROOT, "input", "archive")
API = "https://commons.wikimedia.org/w/api.php"
UA = "messi-reel-archive/1.0 (fan tribute; contact via repo owner)"
MAX_W = 4000  # ภาพใหญ่กว่านี้ขอ thumbnail ขนาดนี้แทน (จอยักษ์ใช้กว้างสุด ~1800 px ที่ 4K)


def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def _plain(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", s or ""))).strip()


def info(title):
    q = dict(action="query", titles=title, prop="imageinfo", iiprop="url|size|extmetadata", iiurlwidth=MAX_W, format="json")
    d = json.loads(_get(API + "?" + urllib.parse.urlencode(q)))
    page = next(iter(d["query"]["pages"].values()))
    if "imageinfo" not in page:
        raise SystemExit(f"ไม่พบไฟล์: {title}")
    ii = page["imageinfo"][0]
    md = {k: _plain(v.get("value", "")) for k, v in ii.get("extmetadata", {}).items()}
    return ii, md


def verdict(md):
    lic = md.get("LicenseShortName", "")
    low = lic.lower()
    if not lic:
        return False, "ไม่มีข้อมูลสัญญาอนุญาต"
    if "nd" in re.findall(r"[a-z]+", low) or "noderiv" in low:
        return False, f"{lic}: ห้ามดัดแปลง (ND)"
    if "nc" in re.findall(r"[a-z]+", low) or "noncommercial" in low:
        return False, f"{lic}: ห้ามใช้เชิงพาณิชย์ (NC) — ต้องให้เจ้าของงานตัดสินใจเอง"
    ok = (low.startswith("cc by") or low.startswith("cc-by") or low in ("cc0", "cc zero") or "public domain" in low or low.startswith("pd"))
    return ok, lic


def credit_line(title, md):
    who = md.get("Artist") or md.get("Credit") or "ไม่ระบุ"
    lic = md.get("LicenseShortName", "")
    name = title.replace("File:", "")
    return f"- {name} — {who} · {lic} · via Wikimedia Commons · https://commons.wikimedia.org/wiki/{urllib.parse.quote(title.replace(' ', '_'))}"


def append_credit(line):
    p = os.path.join(ARCH, "credits.md")
    s = open(p, encoding="utf-8").read() if os.path.exists(p) else "# เครดิตภาพถ่ายจริง (ใส่ในแคปชันโพสต์)\n\n"
    s = s.replace("ยังไม่มีภาพ\n", "")
    if line not in s:
        s = s.rstrip("\n") + "\n" + line + "\n"
    open(p, "w", encoding="utf-8").write(s)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("title", nargs="?", help='ชื่อไฟล์บน Commons เช่น "File:Lionel Messi 2010.jpg"')
    ap.add_argument("--as", dest="name", help="ชื่อไฟล์ปลายทางใน input/archive/")
    ap.add_argument("--check", action="store_true", help="ตรวจสิทธิ์อย่างเดียว")
    ap.add_argument("--owner", help="ไฟล์ภาพที่เจ้าของงานส่งมาเอง (เจ้าของงานรับผิดชอบเรื่องสิทธิ์)")
    ap.add_argument("--credit", default="ภาพจากเจ้าของงาน", help="บรรทัดเครดิตสำหรับ --owner / --url")
    ap.add_argument("--url", help="ลิงก์ภาพโดยตรง (ไม่ตรวจสิทธิ์)")
    ap.add_argument("--source", default="", help="ที่มาของไฟล์ --owner (ลิงก์หน้าเว็บ) — ไม่ใส่ = ภาพที่เจ้าของงานส่งมาเอง")
    a = ap.parse_args()
    os.makedirs(ARCH, exist_ok=True)

    if a.owner:
        dst = os.path.join(ARCH, a.name or os.path.basename(a.owner))
        shutil.copyfile(a.owner, dst)
        note = f" · {a.source}" if a.source else " (เจ้าของงานส่งมาเอง)"
        append_credit(f"- {os.path.basename(dst)} — {a.credit}{note}")
        print(dst)
        return
    if a.url:
        if not a.name:
            ap.error("--url ต้องมี --as")
        dst = os.path.join(ARCH, a.name)
        with open(dst, "wb") as f:
            f.write(_get(a.url))
        append_credit(f"- {a.name} — {a.credit} · {a.url}")
        print(dst)
        return
    if not a.title:
        ap.error("ต้องระบุชื่อไฟล์บน Commons, --url หรือ --owner")
    title = a.title if a.title.startswith("File:") else "File:" + a.title
    ii, md = info(title)
    ok, why = verdict(md)
    print(f"{title}\n  สิทธิ์: {why}  ({'ใช้ได้' if ok else 'ใช้ไม่ได้'})\n  ผู้ถ่าย: {md.get('Artist', '-')}\n"
          f"  วันที่: {md.get('DateTimeOriginal', '-')}\n  ขนาด: {ii['width']}x{ii['height']}\n  คำบรรยาย: {md.get('ImageDescription', '-')[:300]}")
    if not ok or a.check:
        sys.exit(0 if ok else 2)
    url = ii.get("thumburl") if ii["width"] > MAX_W else ii["url"]
    dst = os.path.join(ARCH, a.name or title.replace("File:", "").replace(" ", "_"))
    with open(dst, "wb") as f:
        f.write(_get(url))
    append_credit(credit_line(title, md))
    print(dst)


if __name__ == "__main__":
    main()
