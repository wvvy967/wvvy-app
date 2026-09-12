package org.wvvy.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // iOS discovers WvvyPlayerPlugin automatically via CAPBridgedPlugin;
        // Android needs it registered explicitly before the bridge starts.
        registerPlugin(WvvyPlayerPlugin.class);
        super.onCreate(savedInstanceState);

        // Android 13+ hides the media-playback notification — and with it the only
        // way to pause/stop background audio from outside the app — unless
        // POST_NOTIFICATIONS is granted. Without this the stream can keep playing
        // after the app is closed with no visible control. Ask once on launch.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[] { Manifest.permission.POST_NOTIFICATIONS }, 1001);
        }
    }
}
