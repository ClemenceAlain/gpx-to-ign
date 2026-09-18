package io.gpxtoign.app;

import android.content.Intent;
import android.net.Uri;
import androidx.core.content.FileProvider;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

/**
 * Shows a file the app just wrote, in whatever the phone uses to read it.
 *
 * Filesystem hands back a `file://` URI, and Android has refused to let one cross an intent
 * since Nougat — so the path is handed to the FileProvider the manifest already declares and
 * the receiving app is granted a read on the `content://` URI that comes back.
 *
 * This exists instead of `@capacitor/share` because a share sheet is the wrong answer to
 * "the book is ready": it asks where to send a file nobody has looked at yet.
 */
@CapacitorPlugin(name = "FileOpener")
public class FileOpenerPlugin extends Plugin {

    @PluginMethod
    public void open(PluginCall call) {
        String uri = call.getString("uri");
        String mimeType = call.getString("mimeType", "application/octet-stream");
        if (uri == null || uri.isEmpty()) {
            call.reject("aucun fichier à ouvrir");
            return;
        }
        String path = Uri.parse(uri).getPath();
        if (path == null) {
            call.reject("chemin illisible : " + uri);
            return;
        }
        try {
            Uri shared = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                new File(path)
            );
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(shared, mimeType);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            // A phone with no PDF reader would otherwise crash the app on an unhandled
            // intent; the chooser says "no app can open this" instead.
            getContext().startActivity(Intent.createChooser(intent, "Ouvrir le PDF"));
            call.resolve();
        } catch (Exception e) {
            call.reject("ouverture impossible : " + e.getMessage(), e);
        }
    }
}
