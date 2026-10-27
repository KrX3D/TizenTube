package app.tizentube.androidtv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

public final class MainActivity extends Activity {
    private static final String START_URL = "https://www.youtube.com/tv";
    private static final String TV_USER_AGENT =
            "Mozilla/5.0 (Linux; Android 11; BRAVIA 4K VH2) "
                    + "AppleWebKit/537.36 (KHTML, like Gecko) "
                    + "Chrome/120.0.0.0 Safari/537.36 TV";

    private FrameLayout root;
    private WebView webView;
    private View fullscreenView;
    private WebChromeClient.CustomViewCallback fullscreenCallback;
    private String userScript;
    private boolean injectionStatusShown;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        enterImmersiveMode();

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        setContentView(root);

        userScript = buildInjectedScript(readAsset("tizentube.js"));
        createWebView();
        installDocumentStartScript();
        webView.loadUrl(START_URL);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void createWebView() {
        webView = new WebView(this);
        webView.setBackgroundColor(Color.BLACK);
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setUserAgentString(TV_USER_AGENT);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                return !("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme));
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                if (!supportsDocumentStartScript() && isYouTubeUrl(url)) {
                    view.evaluateJavascript(userScript, null);
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (injectionStatusShown || !isYouTubeUrl(url)) return;

                view.evaluateJavascript("window.__ttAndroidInjected === true", result -> {
                    if (injectionStatusShown) return;
                    injectionStatusShown = true;
                    int message = "true".equals(result)
                            ? R.string.injection_active
                            : R.string.injection_failed;
                    Toast.makeText(MainActivity.this, message, Toast.LENGTH_LONG).show();
                });
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (request.isForMainFrame()) {
                    Toast.makeText(MainActivity.this, R.string.load_failed, Toast.LENGTH_LONG).show();
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (fullscreenView != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                fullscreenView = view;
                fullscreenCallback = callback;
                webView.setVisibility(View.GONE);
                root.addView(view, new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT));
                enterImmersiveMode();
            }

            @Override
            public void onHideCustomView() {
                hideCustomView();
            }
        });

        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        webView.requestFocus();
    }

    private void installDocumentStartScript() {
        if (!supportsDocumentStartScript()) {
            Toast.makeText(this, R.string.webview_too_old, Toast.LENGTH_LONG).show();
            return;
        }

        Set<String> origins = new HashSet<>(Arrays.asList(
                "https://youtube.com",
                "https://*.youtube.com"
        ));
        WebViewCompat.addDocumentStartJavaScript(webView, userScript, origins);
    }

    private static boolean supportsDocumentStartScript() {
        return WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT);
    }

    private static boolean isYouTubeUrl(String url) {
        try {
            String host = Uri.parse(url).getHost();
            return host != null && (host.equals("youtube.com") || host.endsWith(".youtube.com"));
        } catch (RuntimeException ignored) {
            return false;
        }
    }

    private String readAsset(String name) {
        try (InputStream input = getAssets().open(name);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[16 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        } catch (IOException error) {
            throw new IllegalStateException("Could not read " + name, error);
        }
    }

    private static String buildInjectedScript(String bundle) {
        return "window.__ttAndroidHost=true;"
                + "window.__tizenTubeStandaloneVersion='Android TV 1.0.2';"
                + "(function(){"
                + "var started=false;"
                + "function startTizenTube(){"
                + "if(started)return;started=true;"
                + "try {\n"
                + bundle
                + "\n;window.__ttAndroidInjected=true;"
                + "} catch (error) {"
                + "window.__ttAndroidInjectionError=String(error&&error.stack||error);"
                + "console.error('[TizenTube Android] injection failed',error);"
                + "}"
                + "}"
                + "if(document.body||document.readyState!=='loading'){startTizenTube();}"
                + "else{document.addEventListener('DOMContentLoaded',startTizenTube,{once:true});}"
                + "}());";
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        String colorKey = androidColorKey(event.getKeyCode());
        if (colorKey != null) {
            if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
                dispatchColorKey(colorKey);
            }
            return true;
        }

        if (webView != null && webView.getVisibility() == View.VISIBLE
                && event.getKeyCode() != KeyEvent.KEYCODE_BACK
                && webView.dispatchKeyEvent(event)) {
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    private static String androidColorKey(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_PROG_RED:
                return "r";
            case KeyEvent.KEYCODE_PROG_GREEN:
                return "g";
            case KeyEvent.KEYCODE_PROG_YELLOW:
                return "y";
            case KeyEvent.KEYCODE_PROG_BLUE:
                return "b";
            default:
                return null;
        }
    }

    private void dispatchColorKey(String key) {
        if (webView == null) return;
        String upper = key.toUpperCase();
        String script = "(function(){var e=new KeyboardEvent('keydown',{"
                + "key:'" + key + "',code:'Key" + upper + "',bubbles:true,cancelable:true"
                + "});document.dispatchEvent(e);}());";
        webView.evaluateJavascript(script, null);
    }

    @Override
    public void onBackPressed() {
        if (fullscreenView != null) {
            hideCustomView();
        } else if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    private void hideCustomView() {
        if (fullscreenView == null) return;
        root.removeView(fullscreenView);
        fullscreenView = null;
        webView.setVisibility(View.VISIBLE);
        webView.requestFocus();
        if (fullscreenCallback != null) {
            fullscreenCallback.onCustomViewHidden();
            fullscreenCallback = null;
        }
        enterImmersiveMode();
    }

    private void enterImmersiveMode() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    @Override
    protected void onResume() {
        super.onResume();
        enterImmersiveMode();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            root.removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
