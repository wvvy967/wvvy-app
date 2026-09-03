import Capacitor

/// The app's Capacitor bridge view controller. Its only job beyond the default is
/// to register WvvyPlayerPlugin.
///
/// Capacitor auto-discovers plugins that ship as their own Swift Package (the
/// @capacitor/* ones do), but a plugin defined in the app target isn't on that
/// list and the linker dead-strips its class before the runtime ever sees it. So
/// we register it by hand here — the documented hook for app-local plugins — which
/// both references the class (keeping it in the binary) and adds it to the bridge.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        // Must be registerPluginInstance, not registerPluginType: with
        // autoRegisterPlugins on (the default — plugins come from
        // capacitor.config.json), registerPluginType is a no-op, whereas
        // registerPluginInstance registers, load()s, and exports the JS directly.
        bridge?.registerPluginInstance(WvvyPlayerPlugin())
    }
}
