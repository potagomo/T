package th.kruta.widget;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.util.SizeF;
import android.view.View;
import android.widget.RemoteViews;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.TextStyle;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** วิดเจ็ตคาบถัดไป + คาบทั้งวันนี้ · ข้อมูลมาจากตัวส่งของครูต้า (GET /widget) */
public class KrutaWidget extends AppWidgetProvider {
    static final String ACTION_REFRESH = "th.kruta.widget.REFRESH";
    static final String ACTION_TICK = "th.kruta.widget.TICK";
    static final String APP_URL = "https://potagomo.github.io/T/lesson/";

    @Override
    public void onReceive(Context ctx, Intent intent) {
        String a = intent.getAction();
        boolean ours = ACTION_REFRESH.equals(a) || ACTION_TICK.equals(a)
                || AppWidgetManager.ACTION_APPWIDGET_UPDATE.equals(a)
                || AppWidgetManager.ACTION_APPWIDGET_OPTIONS_CHANGED.equals(a);
        if (!ours) { super.onReceive(ctx, intent); return; }
        final boolean force = ACTION_REFRESH.equals(a);
        final Context app = ctx.getApplicationContext();
        final PendingResult pr = goAsync();
        // วาดจากข้อมูลเดิมทันที แล้วค่อยดึงใหม่ (ไม่ให้วิดเจ็ตว่างระหว่างรอเน็ต)
        new Thread(() -> {
            try {
                renderAll(app, force ? "กำลังโหลด…" : null);
                String err = Store.maybeFetch(app, force);
                renderAll(app, err);
            } finally {
                pr.finish();
            }
        }).start();
    }

    static void requestRefresh(Context c) {
        c.sendBroadcast(new Intent(c, KrutaWidget.class).setAction(ACTION_REFRESH));
    }

    static void renderAll(Context c, String note) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        int[] ids = m.getAppWidgetIds(new ComponentName(c, KrutaWidget.class));
        if (ids.length == 0) return;
        Model md = new Model(c, note);
        for (int id : ids) {
            Map<SizeF, RemoteViews> map = new HashMap<>();
            map.put(new SizeF(110f, 100f), build(c, md, R.layout.widget_small, 0));
            map.put(new SizeF(200f, 190f), build(c, md, R.layout.widget_large, 2));
            map.put(new SizeF(200f, 280f), build(c, md, R.layout.widget_large, 5));
            map.put(new SizeF(200f, 380f), build(c, md, R.layout.widget_large, 9));
            m.updateAppWidget(id, new RemoteViews(map));
        }
        scheduleTick(c, md);
    }

    /** สิ่งที่ต้องแสดง คำนวณจากเวลาปัจจุบันทุกครั้งที่วาด */
    static final class Model {
        final boolean configured, hasData;
        final String note;
        final Theme theme;
        final long now = System.currentTimeMillis();
        Store.Lesson next;
        final List<Store.Lesson> today = new ArrayList<>();
        int done;

        Model(Context c, String note) {
            this.configured = Store.configured(c);
            this.hasData = Store.prefs(c).getString("data", null) != null;
            this.note = note == null ? Store.prefs(c).getString("error", null) : note;
            this.theme = Theme.of(c);
            String todayIso = LocalDate.now().toString();
            for (Store.Lesson l : Store.lessons(c)) {
                boolean off = "sick".equals(l.status) || "lateCancel".equals(l.status);
                if (next == null && !off && l.end > now) next = l;
                if (todayIso.equals(l.date)) {
                    today.add(l);
                    if ("present".equals(l.status)) done++;
                }
            }
        }
    }

    static String mins(long ms) {
        long m = Math.max(1, Math.round(ms / 60000.0));
        if (m < 60) return m + " นาที";
        long h = m / 60, r = m % 60;
        return h + " ชม." + (r > 0 ? " " + r + " นาที" : "");
    }

    static String dayLabel(Store.Lesson l, long now) {
        LocalDate d = LocalDate.parse(l.date), t = LocalDate.now();
        if (d.equals(t)) return null;
        if (d.equals(t.plusDays(1))) return "พรุ่งนี้";
        return d.getDayOfWeek().getDisplayName(TextStyle.SHORT, new Locale("th")) + " " + d.getDayOfMonth();
    }

    static RemoteViews build(Context c, Model md, int layout, int rows) {
        RemoteViews v = new RemoteViews(c.getPackageName(), layout);
        // แตะวิดเจ็ต = เปิดแอปครูต้า (Chrome ส่งต่อให้แอปที่ติดตั้งไว้เอง) · ยังไม่ตั้งค่า = เปิดหน้าตั้งค่า
        Intent open = md.configured
                ? new Intent(Intent.ACTION_VIEW, Uri.parse(APP_URL))
                : new Intent(c, MainActivity.class);
        v.setOnClickPendingIntent(android.R.id.background, PendingIntent.getActivity(c, 1, open,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        v.setOnClickPendingIntent(R.id.refresh, PendingIntent.getBroadcast(c, 2,
                new Intent(c, KrutaWidget.class).setAction(ACTION_REFRESH),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));

        Theme th = md.theme;
        th.apply(v);
        String summary = md.today.isEmpty() ? "" : "วันนี้ " + md.done + "/" + md.today.size() + " ยืนยันแล้ว";
        v.setTextViewText(R.id.summary, md.note != null && md.hasData ? md.note : (rows > 0 ? summary : ""));

        if (!md.configured) {
            v.setTextViewText(R.id.label, "ยังไม่ได้ตั้งค่า");
            v.setTextViewText(R.id.time, "แตะที่นี่");
            v.setTextViewText(R.id.name, "วางรหัสวิดเจ็ตจากแอปครูต้า");
            v.setViewVisibility(R.id.place, View.GONE);
        } else if (!md.hasData) {
            // ยังไม่เคยโหลดสำเร็จ — บอกตรง ๆ ว่าโหลดไม่ได้ ไม่ใช่ "ไม่มีคาบ"
            v.setTextViewText(R.id.label, "โหลดตารางไม่ได้");
            v.setTextViewText(R.id.time, "⚠");
            v.setTextViewText(R.id.name, md.note != null ? md.note : "แตะ ↻ เพื่อลองใหม่");
            v.setViewVisibility(R.id.place, View.GONE);
        } else if (md.next == null) {
            v.setTextViewText(R.id.label, md.today.isEmpty() ? "วันนี้ไม่มีคาบ" : "สอนครบแล้ววันนี้");
            v.setTextViewText(R.id.time, md.today.isEmpty() ? "☕" : "🎉");
            v.setTextViewText(R.id.name, "พักผ่อนให้เต็มที่");
            v.setViewVisibility(R.id.place, View.GONE);
        } else {
            Store.Lesson n = md.next;
            String day = dayLabel(n, md.now);
            String label = n.start <= md.now ? "กำลังสอน · เหลือ " + mins(n.end - md.now)
                    : day != null ? day : "ถัดไป · อีก " + mins(n.start - md.now);
            v.setTextViewText(R.id.label, label);
            v.setTextViewText(R.id.time, n.time);
            v.setTextViewText(R.id.name, n.name);
            v.setTextViewText(R.id.place, n.place);
            v.setViewVisibility(R.id.place, n.place.isEmpty() ? View.GONE : View.VISIBLE);
        }

        if (rows > 0) {
            v.removeAllViews(R.id.list);
            int shown = 0;
            for (Store.Lesson l : md.today) {
                if (shown >= rows) break;
                RemoteViews r = new RemoteViews(c.getPackageName(), R.layout.widget_row);
                boolean past = l.end <= md.now && !"planned".equals(l.status);
                int ink = past ? Theme.MUTED : Theme.INK;
                r.setTextViewText(R.id.r_time, l.time);
                th.text(r, R.id.r_time, ink);
                r.setTextViewText(R.id.r_name, l == md.next ? "▶ " + l.name : l.name);
                th.text(r, R.id.r_name, ink);
                String st; int col;
                switch (l.status) {
                    case "present": st = "✓ มาแล้ว"; col = Theme.OK; break;
                    case "sick": st = "ลาป่วย"; col = Theme.OFF; break;
                    case "lateCancel": st = "ลาด่วน"; col = Theme.OFF; break;
                    default: st = "รอยืนยัน"; col = Theme.WAIT;
                }
                r.setTextViewText(R.id.r_status, st);
                th.text(r, R.id.r_status, col);
                v.addView(R.id.list, r);
                shown++;
            }
            v.setTextViewText(R.id.today_title, !md.hasData ? "" : md.today.isEmpty() ? "วันนี้ไม่มีคาบ" : "วันนี้ " + md.today.size() + " คาบ");
            th.text(v, R.id.today_title, Theme.MUTED);
            th.text(v, R.id.more, Theme.MUTED);
            int more = md.today.size() - shown;
            v.setTextViewText(R.id.more, more > 0 ? "+" + more + " คาบ · แตะเพื่อดูทั้งหมด" : "");
            v.setViewVisibility(R.id.more, more > 0 ? View.VISIBLE : View.GONE);
        }
        return v;
    }

    /** ปลุกตัวเองให้ "อีก N นาที" ไม่ค้าง — ถี่ขึ้นเมื่อใกล้คาบ ระบบอาจเลื่อนได้นิดหน่อย (ไม่ใช้ alarm แม่นยำ ประหยัดแบต) */
    static void scheduleTick(Context c, Model md) {
        long now = System.currentTimeMillis(), at;
        if (md.next != null && md.next.start - now < 3 * 3600 * 1000L) at = now + 5 * 60 * 1000L;
        else at = now + 30 * 60 * 1000L;
        if (md.next != null) {
            long edge = md.next.start > now ? md.next.start : md.next.end;
            if (edge + 15000 < at) at = edge + 15000;
        }
        AlarmManager am = c.getSystemService(AlarmManager.class);
        PendingIntent pi = PendingIntent.getBroadcast(c, 3, new Intent(c, KrutaWidget.class).setAction(ACTION_TICK),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        if (am != null) am.set(AlarmManager.RTC, at, pi);
    }

    @Override
    public void onDisabled(Context c) {
        AlarmManager am = c.getSystemService(AlarmManager.class);
        PendingIntent pi = PendingIntent.getBroadcast(c, 3, new Intent(c, KrutaWidget.class).setAction(ACTION_TICK),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        if (am != null) am.cancel(pi);
    }
}
