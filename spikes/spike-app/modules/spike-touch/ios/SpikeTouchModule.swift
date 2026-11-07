import ExpoModulesCore

// Phase 0 / S4 spike: iOS touch injection via QSTouchInjector (private APIs, e2e builds only).
// Coordinates are window points (pt), as returned by getBoundingClientRect() in JS.
public class SpikeTouchModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SpikeTouch")

    Function("ping") { () -> String in
      return "ios"
    }

    // S5: connection params passed as process launch arguments
    // (xcrun simctl launch <udid> <bundleId> -quiescoPort 7777 -quiescoSession abc).
    // "-key value" pairs are also exposed through UserDefaults' NSArgumentDomain.
    Function("getLaunchParams") { () -> [String: Any?] in
      let d = UserDefaults.standard
      return [
        "port": d.string(forKey: "quiescoPort"),
        "session": d.string(forKey: "quiescoSession"),
        "args": ProcessInfo.processInfo.arguments.joined(separator: " "),
      ]
    }

    AsyncFunction("tap") { (x: Double, y: Double, holdMs: Int, promise: Promise) in
      guard let hit = QSTouchInjector.touchDown(at: CGPoint(x: x, y: y)) else {
        promise.reject("E_NO_WINDOW", "no key window")
        return
      }
      DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(holdMs)) {
        let up = QSTouchInjector.touchUp()
        promise.resolve(["x": x, "y": y, "down": true, "up": up, "hit": hit])
      }
    }.runOnQueue(.main)

    AsyncFunction("touchDown") { (x: Double, y: Double) -> [String: Any] in
      let hit = QSTouchInjector.touchDown(at: CGPoint(x: x, y: y))
      return ["x": x, "y": y, "handled": hit != nil, "hit": hit ?? ""]
    }.runOnQueue(.main)

    AsyncFunction("touchUp") { () -> [String: Any] in
      return ["handled": QSTouchInjector.touchUp()]
    }.runOnQueue(.main)
  }
}
