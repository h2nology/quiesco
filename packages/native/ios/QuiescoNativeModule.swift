import ExpoModulesCore
import UIKit

/**
 * Real touch / text input inside the app process (requirements.md §6.3, docs/spikes/04-ios-touch.md).
 * Uses private UIKit / IOKit API through QSTouchInjector: e2e builds only.
 * Targets are addressed by React view tag (Fabric sets `UIView.tag`); positions are read from the view
 * itself so native-driver animations count. Coordinates exchanged with JS are points in the window of
 * the view, the same space as `getBoundingClientRect()` (no density conversion on iOS).
 */
public class QuiescoNativeModule: Module {
  static let doubleTapGapMs = 80
  static let stepMs = 16

  public func definition() -> ModuleDefinition {
    Name("QuiescoNative")

    // docs/spikes/05: `xcrun simctl launch <udid> <bundle> -quiescoPort <p> -quiescoSession <id>`;
    // "-key value" launch arguments land in UserDefaults' NSArgumentDomain.
    Function("getLaunchParams") { () -> [String: String?] in
      let d = UserDefaults.standard
      return ["port": d.string(forKey: "quiescoPort"), "session": d.string(forKey: "quiescoSession")]
    }

    /** Where a view really is, and whether a touch at its center would reach it. */
    AsyncFunction("locate") { (tag: Int) -> [String: Any] in
      guard let view = QSTouchInjector.view(withReactTag: tag), view.window != nil else { return ["found": false] }
      return Self.describe(view)
    }.runOnQueue(.main)

    /** Tap the center of `tag` (or the point `x`,`y` of the key window when tag < 0). */
    AsyncFunction("tap") { (tag: Int, x: Double, y: Double, holdMs: Int, count: Int, promise: Promise) in
      if let missing = QSTouchInjector.missingPrivateAPI() {
        promise.reject("E_UNSUPPORTED", Self.unsupported(missing))
        return
      }
      guard let resolved = Self.target(tag: tag, x: x, y: y) else {
        promise.reject("E_NO_VIEW", "view \(tag) not found")
        return
      }
      let (window, point) = resolved
      var handled = true
      func one(_ i: Int) {
        handled = (QSTouchInjector.touchDown(at: point, in: window, tapCount: UInt(i + 1)) != nil) && handled
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(holdMs)) {
          handled = QSTouchInjector.touchUp() && handled
          if i + 1 < count {
            DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(Self.doubleTapGapMs)) { one(i + 1) }
          } else {
            promise.resolve(["x": point.x, "y": point.y, "handled": handled, "windowHasFocus": Self.reaches(window, point, tag)])
          }
        }
      }
      one(0)
    }.runOnQueue(.main)

    /** Drag from (fromX, fromY) to (toX, toY) in the window of `tag` over `durationMs`. */
    AsyncFunction("swipe") { (tag: Int, fromX: Double, fromY: Double, toX: Double, toY: Double, durationMs: Int, promise: Promise) in
      if let missing = QSTouchInjector.missingPrivateAPI() {
        promise.reject("E_UNSUPPORTED", Self.unsupported(missing))
        return
      }
      guard let window = (tag >= 0 ? QSTouchInjector.view(withReactTag: tag)?.window : nil) ?? QSTouchInjector.keyWindow() else {
        promise.reject("E_NO_VIEW", "no window for view \(tag)")
        return
      }
      let steps = max(4, durationMs / Self.stepMs)
      let interval = max(1, durationMs / steps)
      var handled = QSTouchInjector.touchDown(at: CGPoint(x: fromX, y: fromY), in: window, tapCount: 1) != nil
      func step(_ i: Int) {
        let t = Double(i) / Double(steps)
        let p = CGPoint(x: fromX + (toX - fromX) * t, y: fromY + (toY - fromY) * t)
        if i < steps {
          handled = QSTouchInjector.touchMove(to: p) && handled
          DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(interval)) { step(i + 1) }
        } else {
          handled = QSTouchInjector.touchMove(to: p) && handled
          handled = QSTouchInjector.touchUp() && handled
          promise.resolve(["handled": handled])
        }
      }
      DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(interval)) { step(1) }
    }.runOnQueue(.main)

    /**
     * Type into the text field `tag` through UIKeyInput (the path the software keyboard uses), so
     * RN's delegate callbacks and onChangeText fire. `replace` clears the field first.
     */
    AsyncFunction("typeText") { (tag: Int, text: String, replace: Bool, promise: Promise) in
      guard let view = QSTouchInjector.view(withReactTag: tag) else {
        promise.reject("E_NO_VIEW", "view \(tag) not found")
        return
      }
      guard let field = Self.findTextInput(view) else {
        promise.reject("E_NOT_TEXT_INPUT", "view \(tag) is not a text field")
        return
      }
      let focused = field.becomeFirstResponder()
      if replace, let all = field.textRange(from: field.beginningOfDocument, to: field.endOfDocument), !all.isEmpty {
        field.selectedTextRange = all
        field.deleteBackward()
      }
      field.insertText(text)
      let current = field.textRange(from: field.beginningOfDocument, to: field.endOfDocument).flatMap { field.text(in: $0) } ?? ""
      promise.resolve(["text": current, "inputConnection": true, "focused": focused])
    }.runOnQueue(.main)

    /**
     * Open a URL from inside the app. For the app's own scheme iOS routes it through the
     * SceneDelegate to RN Linking without the confirmation alert `simctl openurl` shows
     * (Phase 4.0 findings), so deep links behave as when a user follows one.
     */
    AsyncFunction("openUrl") { (url: String, promise: Promise) in
      guard let u = URL(string: url), u.scheme != nil else {
        promise.reject("E_BAD_URL", "invalid URL \(url)")
        return
      }
      UIApplication.shared.open(u, options: [:]) { opened in promise.resolve(["opened": opened]) }
    }.runOnQueue(.main)
  }

  // MARK: - helpers (main thread)

  static func unsupported(_ missing: String) -> String {
    let version = UIDevice.current.systemVersion
    return "touch injection needs private UIKit API that iOS \(version) does not have (\(missing)); use actions.mode 'js'"
  }

  static func target(tag: Int, x: Double, y: Double) -> (UIWindow, CGPoint)? {
    if tag < 0 {
      guard let w = QSTouchInjector.keyWindow() else { return nil }
      return (w, CGPoint(x: x, y: y))
    }
    guard let view = QSTouchInjector.view(withReactTag: tag), let window = view.window else { return nil }
    let r = view.convert(view.bounds, to: window)
    return (window, CGPoint(x: r.midX, y: r.midY))
  }

  /** Whether the topmost view at `point` (across all windows) belongs to the view `tag`. */
  static func reaches(_ window: UIWindow, _ point: CGPoint, _ tag: Int) -> Bool {
    let top = topmostHit(window.convert(point, to: nil))
    guard let target = tag >= 0 ? QSTouchInjector.view(withReactTag: tag) : nil else { return top?.window === window }
    guard let hit = top else { return false }
    return hit.isDescendant(of: target) || target.isDescendant(of: hit)
  }

  /** Hit test from the front-most window down, in screen coordinates. */
  static func topmostHit(_ screenPoint: CGPoint) -> UIView? {
    for w in QSTouchInjector.windows().reversed() {
      let p = w.convert(screenPoint, from: nil)
      if let hit = w.hitTest(p, with: nil) { return hit }
    }
    return nil
  }

  static func describe(_ view: UIView) -> [String: Any] {
    let window = view.window!
    let r = view.convert(view.bounds, to: window)
    let center = CGPoint(x: r.midX, y: r.midY)
    let top = topmostHit(window.convert(center, to: nil))
    let reaches = top.map { $0.isDescendant(of: view) || view.isDescendant(of: $0) } ?? false
    var shown = true
    var v: UIView? = view
    while let cur = v {
      if cur.isHidden || cur.alpha <= 0.01 { shown = false; break }
      v = cur.superview
    }
    let windows = QSTouchInjector.windows()
    let transitioning = isTransitioning(window)
    let animating = hasRunningAnimation(view)
    return [
      // UIKit ignores touches during a view controller transition (e.g. a Modal fading in), and a
      // Core Animation on the view or an ancestor changes what is on screen without a layout change.
      "settling": transitioning || animating,
      "transitioning": transitioning,
      "animating": animating,
      "found": true,
      "x": r.origin.x, "y": r.origin.y, "width": r.size.width, "height": r.size.height,
      "shown": shown,
      // iOS: RN Modals are presented in the same window, so "focus" is decided by a real hit test at
      // the center: false when another view (a Modal, an overlay, another window) would get the touch.
      "windowHasFocus": reaches,
      "windowIndex": windows.firstIndex(of: window) ?? -1,
      "windowCount": windows.count,
      "windowClass": String(describing: type(of: window)),
      "hitClass": top.map { String(describing: type(of: $0)) } ?? "",
    ]
  }

  /** A view controller of this window is being presented / dismissed, or has a running transition. */
  static func isTransitioning(_ window: UIWindow) -> Bool {
    var vc = window.rootViewController
    while let cur = vc {
      if cur.transitionCoordinator != nil || cur.isBeingPresented || cur.isBeingDismissed { return true }
      for child in cur.children where child.transitionCoordinator != nil { return true }
      vc = cur.presentedViewController
    }
    return false
  }

  /** A Core Animation is attached to the view or one of its ancestors (fades, presentation slides). */
  static func hasRunningAnimation(_ view: UIView) -> Bool {
    var v: UIView? = view
    while let cur = v {
      if let keys = cur.layer.animationKeys(), !keys.isEmpty { return true }
      v = cur.superview
    }
    return false
  }

  static func findTextInput(_ view: UIView) -> (UIView & UITextInput)? {
    if let f = view as? UITextField { return f }
    if let t = view as? UITextView { return t }
    for sub in view.subviews {
      if let f = findTextInput(sub) { return f }
    }
    return nil
  }
}
