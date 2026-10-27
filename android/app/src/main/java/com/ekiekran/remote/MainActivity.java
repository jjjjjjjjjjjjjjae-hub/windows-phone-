package com.ekiekran.remote;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONException;
import org.json.JSONObject;

import java.lang.ref.WeakReference;
import java.util.Collections;

public final class MainActivity extends Activity {
    private static final String HOST = "jjjjjjjjjjjjjjae-hub.github.io";
    private static final String URL = "https://" + HOST + "/windows-phone-/ui/";
    private static final int CAPTURE_REQUEST = 41;
    private static final int CAMERA_REQUEST = 42;
    private static final int FILE_REQUEST = 43;
    private static WeakReference<MainActivity> current = new WeakReference<>(null);

    private WebView webView;
    private boolean capturePending;
    private PermissionRequest cameraRequest;
    private ValueCallback<Uri[]> fileCallback;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        current = new WeakReference<>(this);
        webView = new WebView(this);
        setContentView(webView);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, android.webkit.WebResourceRequest request) {
                if (trustedPage(request.getUrl().toString())) return false;
                if (request.isForMainFrame()) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl())); } catch (Exception ignored) { }
                }
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    if (!trustedOrigin(request.getOrigin()) || !java.util.Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) {
                        request.deny(); return;
                    }
                    cameraRequest = request;
                    if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) grantCamera();
                    else requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_REQUEST);
                });
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try { startActivityForResult(params.createIntent(), FILE_REQUEST); return true; }
                catch (Exception e) { fileCallback = null; callback.onReceiveValue(null); return false; }
            }
        });
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            webView.loadData("<h2>Android System WebView жаңартылуы керек</h2>", "text/html", "UTF-8");
            return;
        }
        WebViewCompat.addWebMessageListener(webView, "PhoneControlNative", Collections.singleton("https://" + HOST),
            (view, message, origin, isMainFrame, replyProxy) -> {
                if (!isMainFrame || view != webView || !trustedOrigin(origin) || !trustedPage(view.getUrl())) return;
                String payload = message.getData();
                if (payload != null && payload.length() <= 2048) runOnUiThread(() -> handleMessage(payload));
            });
        webView.loadUrl(URL);
    }

    private static boolean trustedOrigin(Uri uri) {
        return uri != null && "https".equals(uri.getScheme()) && HOST.equals(uri.getHost()) && uri.getPort() == -1;
    }
    private static boolean trustedPage(String value) {
        if (value == null) return false;
        Uri uri = Uri.parse(value);
        String path = uri.getPath();
        return trustedOrigin(uri) && ("/windows-phone-/ui/".equals(path) || "/windows-phone-/ui/index.html".equals(path));
    }
    private void handleMessage(String payload) {
        if (!trustedPage(webView.getUrl())) return;
        try {
            JSONObject input = new JSONObject(payload);
            switch (input.optString("type")) {
                case "accessibility":
                    startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
                    break;
                case "start":
                    if (capturePending || ScreenCaptureService.isRunning()) return;
                    if (RemoteAccessibilityService.current() == null) {
                        notifyError("Алдымен Android баптауынан «Екі экран» басқару рұқсатын қос."); return;
                    }
                    capturePending = true;
                    MediaProjectionManager manager = (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
                    startActivityForResult(manager.createScreenCaptureIntent(), CAPTURE_REQUEST);
                    break;
                case "stop":
                    capturePending = false;
                    stopService(new Intent(this, ScreenCaptureService.class));
                    break;
                case "gesture":
                    if (ScreenCaptureService.isRunning()) RemoteAccessibilityService.perform(input);
                    break;
                default: break;
            }
        } catch (JSONException ignored) { }
    }
    private void grantCamera() {
        if (cameraRequest != null) {
            if (trustedPage(webView.getUrl())) cameraRequest.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            else cameraRequest.deny();
            cameraRequest = null;
        }
    }
    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(request, permissions, grants);
        if (request == CAMERA_REQUEST && cameraRequest != null) {
            if (grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED) grantCamera();
            else { cameraRequest.deny(); cameraRequest = null; }
        }
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == FILE_REQUEST) {
            if (fileCallback != null) fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            fileCallback = null; return;
        }
        if (request != CAPTURE_REQUEST) return;
        if (!capturePending) return;
        capturePending = false;
        if (result != RESULT_OK || data == null) { notifyError("Экран бөлісу рұқсаты берілмеді."); return; }
        Intent service = new Intent(this, ScreenCaptureService.class).setAction(ScreenCaptureService.ACTION_START);
        service.putExtra(ScreenCaptureService.RESULT_CODE, result);
        service.putExtra(ScreenCaptureService.RESULT_DATA, data);
        try { startForegroundService(service); }
        catch (Exception e) { notifyError("Экранды бөлісу іске қосылмады."); }
    }
    private void js(String expression) {
        runOnUiThread(() -> { if (webView != null && trustedPage(webView.getUrl())) webView.evaluateJavascript(expression, null); });
    }
    private void notifyError(String value) { js("window.PhoneRemote?.nativeError(" + JSONObject.quote(value) + ")"); }
    static void started() { MainActivity activity = current.get(); if (activity != null) activity.js("window.PhoneRemote?.nativeStarted()"); }
    static void stopped() { MainActivity activity = current.get(); if (activity != null) activity.js("window.PhoneRemote?.nativeStopped()"); }
    static void failed(String message) { MainActivity activity = current.get(); if (activity != null) activity.notifyError(message); }
    static void frame(String jpeg, int width, int height) {
        MainActivity activity = current.get();
        if (activity == null) return;
        try {
            JSONObject object = new JSONObject().put("data", "data:image/jpeg;base64," + jpeg).put("width", width).put("height", height);
            activity.js("window.PhoneRemote?.nativeFrame(" + object + ")");
        } catch (JSONException ignored) { }
    }
    @Override public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }
    @Override protected void onDestroy() {
        if (isFinishing()) stopService(new Intent(this, ScreenCaptureService.class));
        if (current.get() == this) current.clear();
        if (webView != null) { webView.destroy(); webView = null; }
        super.onDestroy();
    }
}
