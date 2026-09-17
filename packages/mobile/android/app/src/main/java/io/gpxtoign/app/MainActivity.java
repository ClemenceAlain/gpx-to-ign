package io.gpxtoign.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.database.Cursor;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The whole native layer: hand shared GPX files to the web app.
 *
 * The WebView cannot read a `content://` URI, so this is the one job Java has to do. Output,
 * storage and the job itself all live in the web layer, which is why there is no plugin here
 * and no Storage Access Framework machinery either.
 */
public class MainActivity extends BridgeActivity {

    /** A share that launched the app arrives long before the page can listen for it. */
    private String pending = null;
    private boolean loaded = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Registered on the builder, not the bridge: BridgeActivity.onCreate creates the
        // bridge and starts the load, so a listener added afterwards can miss the first page.
        bridgeBuilder.addWebViewListener(
            new WebViewListener() {
                @Override
                public void onPageLoaded(WebView webView) {
                    loaded = true;
                    flush();
                }
            }
        );
        // BridgeActivity.load() calls onNewIntent(getIntent()) itself, which is what picks up
        // a share that launched the app.
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        read(intent);
    }

    /** Pulls every shared GPX out of the intent and queues it as JSON. */
    private void read(Intent intent) {
        if (intent == null) return;
        List<Uri> uris = new ArrayList<>();
        String action = intent.getAction();
        if (Intent.ACTION_SEND.equals(action) || Intent.ACTION_VIEW.equals(action)) {
            Uri one = intent.getData() != null
                ? intent.getData()
                : intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (one != null) uris.add(one);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> many = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (many != null) uris.addAll(many);
        }
        if (uris.isEmpty()) return;

        JSONArray files = new JSONArray();
        for (Uri uri : uris) {
            String text = readText(uri);
            if (text == null) continue;
            try {
                JSONObject file = new JSONObject();
                file.put("name", displayName(uri));
                file.put("text", text);
                files.put(file);
            } catch (Exception ignored) {
                // One unreadable share must not lose the others.
            }
        }
        if (files.length() == 0) return;
        pending = files.toString();
        flush();
    }

    /** Delivers on the UI thread, once the page exists to receive it. */
    private void flush() {
        if (pending == null || !loaded || getBridge() == null) return;
        final String payload = pending;
        pending = null;
        getBridge()
            .getWebView()
            .post(
                () ->
                    getBridge()
                        .getWebView()
                        .evaluateJavascript(
                            "window.dispatchEvent(new CustomEvent('gpxShared',{detail:" +
                            payload +
                            "}))",
                            null
                        )
            );
    }

    private String readText(Uri uri) {
        try (InputStream in = getContentResolver().openInputStream(uri)) {
            if (in == null) return null;
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        }
    }

    private String displayName(Uri uri) {
        try (Cursor cursor = getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (column >= 0) {
                    String name = cursor.getString(column);
                    if (name != null && !name.isEmpty()) return name;
                }
            }
        } catch (Exception ignored) {
            // Falls through to the URI's last path segment.
        }
        String last = uri.getLastPathSegment();
        return last == null ? "trace.gpx" : last;
    }
}
