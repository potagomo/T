package th.kruta.widget;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** ค่าตั้ง (ที่อยู่ตัวส่ง + รหัสวิดเจ็ต) และตารางสอนที่ดึงมาเก็บไว้ในเครื่อง */
final class Store {
    private static final String P = "kruta";
    static final long STALE_MS = 15 * 60 * 1000L;

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences(P, Context.MODE_PRIVATE); }

    static boolean configured(Context c) {
        SharedPreferences p = prefs(c);
        return p.getString("url", null) != null && p.getString("key", null) != null;
    }

    /** รหัสจากแอปครูต้า: KRUTAW1:base64({"u":"https://…","k":"…"}) */
    static boolean saveCode(Context c, String code) {
        try {
            String s = code == null ? "" : code.trim();
            int i = s.indexOf("KRUTAW1:");
            if (i < 0) return false;
            String b64 = s.substring(i + 8).split("\\s")[0];
            JSONObject j = new JSONObject(new String(Base64.decode(b64, Base64.DEFAULT), StandardCharsets.UTF_8));
            String u = j.optString("u", ""), k = j.optString("k", "");
            if (!u.startsWith("https://") || k.length() < 20) return false;
            prefs(c).edit().putString("url", u.replaceAll("/+$", "")).putString("key", k)
                    .remove("data").putLong("fetched", 0).apply();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** ดึงตารางใหม่ถ้าเก่ากว่า 15 นาที (หรือบังคับ) — คืน null ถ้าสำเร็จ หรือข้อความผิดพลาด */
    static String maybeFetch(Context c, boolean force) {
        SharedPreferences p = prefs(c);
        String url = p.getString("url", null), key = p.getString("key", null);
        if (url == null || key == null) return "ยังไม่ได้ตั้งค่า";
        if (!force && System.currentTimeMillis() - p.getLong("fetched", 0) < STALE_MS) return null;
        HttpURLConnection con = null;
        try {
            con = (HttpURLConnection) new URL(url + "/widget?k=" + URLEncoder.encode(key, "UTF-8")).openConnection();
            con.setConnectTimeout(7000);
            con.setReadTimeout(7000);
            int code = con.getResponseCode();
            InputStream in = code >= 400 ? con.getErrorStream() : con.getInputStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while (in != null && (n = in.read(buf)) > 0) out.write(buf, 0, n);
            JSONObject j = new JSONObject(out.toString("UTF-8"));
            if (!j.optBoolean("ok")) {
                String err = j.optString("error", "ตัวส่งปฏิเสธ");
                p.edit().putString("error", err).apply();
                return err;
            }
            p.edit().putString("data", j.toString()).putLong("fetched", System.currentTimeMillis()).remove("error").apply();
            return null;
        } catch (Exception e) {
            return "ไม่มีเน็ต — ใช้ข้อมูลล่าสุด";
        } finally {
            if (con != null) con.disconnect();
        }
    }

    static final class Lesson {
        String date, time, name, kind, place, status;
        long start, end;
    }

    static List<Lesson> lessons(Context c) {
        List<Lesson> out = new ArrayList<>();
        try {
            String raw = prefs(c).getString("data", null);
            if (raw == null) return out;
            JSONArray a = new JSONObject(raw).optJSONArray("lessons");
            if (a == null) return out;
            ZoneId z = ZoneId.systemDefault();
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.getJSONObject(i);
                Lesson l = new Lesson();
                l.date = o.optString("d");
                l.time = o.optString("t");
                l.name = o.optString("n");
                l.kind = o.optString("k");
                l.place = o.optString("p");
                l.status = o.optString("s", "planned");
                if (l.date.length() != 10 || l.time.length() < 4) continue;
                String[] hm = l.time.split(":");
                LocalDateTime st = LocalDate.parse(l.date).atTime(Integer.parseInt(hm[0]), Integer.parseInt(hm[1]));
                l.start = st.atZone(z).toInstant().toEpochMilli();
                int m = o.optInt("m", 60);
                l.end = l.start + (m > 0 ? m : 60) * 60000L;
                out.add(l);
            }
        } catch (Exception ignored) {
        }
        Collections.sort(out, (x, y) -> Long.compare(x.start, y.start));
        return out;
    }
}
