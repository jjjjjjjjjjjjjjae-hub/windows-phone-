package com.ekiekran.remote;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.graphics.Point;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.util.Base64;
import android.view.WindowManager;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;

public final class ScreenCaptureService extends Service {
    static final String ACTION_START = "com.ekiekran.remote.START";
    static final String ACTION_STOP = "com.ekiekran.remote.STOP";
    static final String RESULT_CODE = "resultCode";
    static final String RESULT_DATA = "resultData";
    private static final String CHANNEL = "screen-share";
    private static volatile boolean running;
    private static volatile ScreenCaptureService active;

    private HandlerThread thread;
    private Handler handler;
    private MediaProjection projection;
    private VirtualDisplay display;
    private ImageReader reader;
    private int width, height, captureWidth, captureHeight, density;
    private long lastFrame;
    private volatile boolean frameReady = true;

    static boolean isRunning() { return running; }
    static void allowNextFrame() {
        ScreenCaptureService service = active;
        if (service != null && running) service.frameReady = true;
    }
    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || ACTION_STOP.equals(intent.getAction())) { stopSelf(); return START_NOT_STICKY; }
        if (!ACTION_START.equals(intent.getAction()) || running || projection != null) return START_NOT_STICKY;
        NotificationManager notifications = getSystemService(NotificationManager.class);
        notifications.createNotificationChannel(new NotificationChannel(CHANNEL, "Экранды бөлісу", NotificationManager.IMPORTANCE_LOW));
        Intent stop = new Intent(this, ScreenCaptureService.class).setAction(ACTION_STOP);
        PendingIntent stopAction = PendingIntent.getService(this, 0, stop, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentTitle(getString(R.string.capture_notification))
            .setContentText("Тоқтату әрекетін қолдан")
            .setOngoing(true)
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel, getString(R.string.stop_capture), stopAction).build())
            .build();
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
            else startForeground(1, notification);
            Intent consent = Build.VERSION.SDK_INT >= 33
                ? intent.getParcelableExtra(RESULT_DATA, Intent.class)
                : intent.getParcelableExtra(RESULT_DATA);
            if (consent == null) throw new IllegalStateException("No screen share consent");
            MediaProjectionManager manager = getSystemService(MediaProjectionManager.class);
            projection = manager.getMediaProjection(intent.getIntExtra(RESULT_CODE, 0), consent);
            if (projection == null) throw new IllegalStateException("No screen projection");
            thread = new HandlerThread("ScreenCapture"); thread.start();
            handler = new Handler(thread.getLooper());
            projection.registerCallback(new MediaProjection.Callback() {
                @Override public void onStop() { stopSelf(); }
            }, handler);
            Point size = screenSize(); width = size.x; height = size.y;
            density = getResources().getDisplayMetrics().densityDpi;
            resizeCapture();
            reader = newReader(captureWidth, captureHeight);
            display = projection.createVirtualDisplay("EkiEkran", captureWidth, captureHeight, density,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, reader.getSurface(), null, handler);
            active = this; running = true;
            MainActivity.started();
        } catch (Exception e) {
            MainActivity.failed("Экранды бөлісу іске қосылмады: " + e.getClass().getSimpleName());
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    private Point screenSize() {
        Point size = new Point();
        ((WindowManager) getSystemService(WINDOW_SERVICE)).getDefaultDisplay().getRealSize(size);
        return size;
    }
    private void resizeCapture() {
        captureWidth = Math.min(width, 480);
        captureHeight = Math.max(1, Math.round((float) height * captureWidth / width));
    }
    private ImageReader newReader(int w, int h) {
        ImageReader next = ImageReader.newInstance(w, h, PixelFormat.RGBA_8888, 2);
        next.setOnImageAvailableListener(this::onFrame, handler);
        return next;
    }
    private void onFrame(ImageReader source) {
        Image image = null;
        try {
            image = source.acquireLatestImage();
            if (image == null || !running) return;
            Point size = screenSize();
            if (size.x != width || size.y != height) {
                width = size.x; height = size.y;
                resizeCapture();
                ImageReader next = newReader(captureWidth, captureHeight);
                display.resize(captureWidth, captureHeight, density);
                display.setSurface(next.getSurface());
                reader = next;
                frameReady = true;
                source.close();
                return;
            }
            long now = android.os.SystemClock.elapsedRealtime();
            if (now - lastFrame < 220 || (!frameReady && now - lastFrame < 4200)) return;
            frameReady = false; lastFrame = now;
            Image.Plane plane = image.getPlanes()[0];
            int rowPixels = plane.getRowStride() / plane.getPixelStride();
            ByteBuffer bytes = plane.getBuffer();
            Bitmap padded = Bitmap.createBitmap(rowPixels, captureHeight, Bitmap.Config.ARGB_8888);
            padded.copyPixelsFromBuffer(bytes);
            Bitmap cropped = Bitmap.createBitmap(padded, 0, 0, captureWidth, captureHeight);
            if (cropped != padded) padded.recycle();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            cropped.compress(Bitmap.CompressFormat.JPEG, 45, out);
            cropped.recycle();
            if (out.size() < 250000) MainActivity.frame(Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP), width, height);
            else frameReady = true;
        } catch (Exception ignored) {
            // Frames can race with screen rotation or the user stopping projection.
            frameReady = true;
        } finally {
            if (image != null) image.close();
        }
    }

    @Override public void onDestroy() {
        running = false; active = null;
        RootControl.stopSession();
        if (reader != null) { reader.close(); reader = null; }
        if (display != null) { display.release(); display = null; }
        if (projection != null) {
            MediaProjection previous = projection; projection = null;
            previous.stop();
        }
        if (thread != null) { thread.quitSafely(); thread = null; }
        MainActivity.stopped();
        super.onDestroy();
    }
}
