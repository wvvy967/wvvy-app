# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Keep line numbers but hide the source file name, so Play-symbolicated crash
# stack traces stay readable (upload the mapping.txt with each release) without
# leaking original filenames.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# --- Chromecast -------------------------------------------------------------
# CastOptionsProvider is referenced only by its fully-qualified name in a
# manifest <meta-data> string (OPTIONS_PROVIDER_CLASS_NAME), which R8 cannot
# see as a class reference. Without this it gets renamed or stripped and
# CastContext fails to initialize — PlaybackService then silently runs
# local-only with no Cast. The interface rule covers it defensively.
-keep class org.wvvy.app.CastOptionsProvider { *; }
-keep class * implements com.google.android.gms.cast.framework.OptionsProvider { *; }
