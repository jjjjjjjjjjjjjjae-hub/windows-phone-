package com.ekiekran.remote;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.graphics.Path;
import android.graphics.Point;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;

import org.json.JSONObject;

public final class RemoteAccessibilityService extends AccessibilityService {
    private static RemoteAccessibilityService instance;

    static RemoteAccessibilityService current() { return instance; }
    @Override protected void onServiceConnected() { super.onServiceConnected(); instance = this; }
    @Override public void onDestroy() { if (instance == this) instance = null; super.onDestroy(); }
    @Override public void onAccessibilityEvent(AccessibilityEvent event) { }
    @Override public void onInterrupt() { }

    static void perform(JSONObject input) {
        RemoteAccessibilityService service = instance;
        if (service == null || !ScreenCaptureService.isRunning()) return;
        String kind = input.optString("kind");
        switch (kind) {
            case "back": service.performGlobalAction(GLOBAL_ACTION_BACK); return;
            case "home": service.performGlobalAction(GLOBAL_ACTION_HOME); return;
            case "recents": service.performGlobalAction(GLOBAL_ACTION_RECENTS); return;
            case "tap": case "swipe": break;
            default: return;
        }
        double x = input.optDouble("x", Double.NaN), y = input.optDouble("y", Double.NaN);
        double x2 = input.optDouble("x2", Double.NaN), y2 = input.optDouble("y2", Double.NaN);
        if (!valid(x) || !valid(y) || ("swipe".equals(kind) && (!valid(x2) || !valid(y2)))) return;
        Point size = new Point();
        ((WindowManager) service.getSystemService(WINDOW_SERVICE)).getDefaultDisplay().getRealSize(size);
        if (size.x <= 0 || size.y <= 0) return;
        Path path = new Path();
        path.moveTo((float) x * (size.x - 1), (float) y * (size.y - 1));
        if ("swipe".equals(kind)) path.lineTo((float) x2 * (size.x - 1), (float) y2 * (size.y - 1));
        long duration = "swipe".equals(kind) ? Math.max(100, Math.min(1500, input.optLong("duration", 350))) : 70;
        GestureDescription gesture = new GestureDescription.Builder()
            .addStroke(new GestureDescription.StrokeDescription(path, 0, duration)).build();
        service.dispatchGesture(gesture, null, null);
    }
    private static boolean valid(double value) { return Double.isFinite(value) && value >= 0 && value <= 1; }
}
