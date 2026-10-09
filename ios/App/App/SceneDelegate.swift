import UIKit
import Capacitor

/// UIScene lifecycle adoption. Required on multi-display devices — the iPhone
/// Duo traps any app that hasn't adopted it (EXC_BREAKPOINT in
/// UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption) — and the
/// modern default on every current iPhone and iPad. Capacitor's own URL /
/// Universal Link / Handoff delivery moves here from AppDelegate via
/// SceneDelegateProxy.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        // Main.storyboard's initial controller is MainViewController, which
        // registers WvvyPlayerPlugin in capacitorDidLoad(). Instantiate it from
        // the storyboard rather than a bare CAPBridgeViewController so the native
        // audio plugin still loads under the scene lifecycle.
        let storyboard = UIStoryboard(name: "Main", bundle: nil)
        window?.rootViewController = storyboard.instantiateInitialViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
