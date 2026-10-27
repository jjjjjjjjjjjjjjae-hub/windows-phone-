package com.ekiekran.remote;

import android.content.Context;
import android.graphics.Point;
import android.os.Handler;
import android.os.Looper;
import android.view.WindowManager;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;

/** Runs only fixed screen input commands after a local root grant and an active screen-share session. */
final class RootControl {
    private static final ExecutorService WORKER = Executors.newSingleThreadExecutor();
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final AtomicInteger SESSION = new AtomicInteger();
    private static final Object ACTION_GUARD = new Object();
    private static Process activeAction;
    private static volatile boolean granted;

    private RootControl() { }
    static boolean isGranted() { return granted; }

    static void request(Consumer<Boolean> result) {
        WORKER.execute(() -> {
            boolean allowed = probe();
            granted = allowed;
            MAIN.post(() -> result.accept(allowed));
        });
    }
    private static boolean probe() {
        Process process = null;
        try {
            process = new ProcessBuilder("su", "-c", "id -u").redirectErrorStream(true).start();
            if (!process.waitFor(40, TimeUnit.SECONDS)) return false;
            if (process.exitValue() != 0) return false;
            try (BufferedReader output = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = output.readLine()) != null) if ("0".equals(line.trim())) return true;
            }
        } catch (Exception ignored) { }
        finally { if (process != null) process.destroyForcibly(); }
        return false;
    }

    static void stopSession() {
        synchronized (ACTION_GUARD) {
            SESSION.incrementAndGet();
            if (activeAction != null) activeAction.destroyForcibly();
        }
    }
    static void perform(Context context, JSONObject input, Runnable failure) {
        if (!granted || !ScreenCaptureService.isRunning()) return;
        Point size = new Point();
        ((WindowManager) context.getSystemService(Context.WINDOW_SERVICE)).getDefaultDisplay().getRealSize(size);
        String command = commandFor(input, size);
        if (command == null) return;
        int session = SESSION.get();
        WORKER.execute(() -> {
            Process process = null;
            boolean success = false;
            try {
                synchronized (ACTION_GUARD) {
                    if (session != SESSION.get() || !ScreenCaptureService.isRunning() || !granted) return;
                    process = new ProcessBuilder("su", "-c", command).redirectErrorStream(true).start();
                    activeAction = process;
                }
                success = process.waitFor(5, TimeUnit.SECONDS) && process.exitValue() == 0;
            } catch (Exception ignored) { }
            finally {
                synchronized (ACTION_GUARD) { if (activeAction == process) activeAction = null; }
                if (process != null) process.destroyForcibly();
            }
            if (!success && session == SESSION.get()) {
                granted = false;
                MAIN.post(() -> { if (session == SESSION.get()) failure.run(); });
            }
        });
    }

    private static String commandFor(JSONObject input, Point size) {
        if (size.x <= 0 || size.y <= 0) return null;
        switch (input.optString("kind")) {
            case "back": return "/system/bin/input keyevent 4";
            case "home": return "/system/bin/input keyevent 3";
            case "recents": return "/system/bin/input keyevent 187";
            case "tap": case "swipe": break;
            default: return null;
        }
        double x = input.optDouble("x", Double.NaN), y = input.optDouble("y", Double.NaN);
        if (!valid(x) || !valid(y)) return null;
        int px = (int) Math.round(x * (size.x - 1)), py = (int) Math.round(y * (size.y - 1));
        if ("tap".equals(input.optString("kind"))) return "/system/bin/input tap " + px + " " + py;
        double x2 = input.optDouble("x2", Double.NaN), y2 = input.optDouble("y2", Double.NaN);
        if (!valid(x2) || !valid(y2)) return null;
        int px2 = (int) Math.round(x2 * (size.x - 1)), py2 = (int) Math.round(y2 * (size.y - 1));
        long duration = Math.max(100, Math.min(1500, input.optLong("duration", 350)));
        return "/system/bin/input swipe " + px + " " + py + " " + px2 + " " + py2 + " " + duration;
    }
    private static boolean valid(double value) { return Double.isFinite(value) && value >= 0 && value <= 1; }
}
