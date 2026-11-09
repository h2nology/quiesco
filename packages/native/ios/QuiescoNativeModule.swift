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

    OnCreate {
      KeyboardMotion.shared.start()
      DispatchQueue.main.async { NativeSettleMonitor.shared.start() }
      Self.deliverLaunchUrl()
    }

    /** Phase 6.6 spike: rotate the app's window scene (iOS 16+ geometry request). */
    AsyncFunction("spikeOrientation") { (landscape: Bool, promise: Promise) in
      guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else {
        promise.resolve("no window scene")
        return
      }
      scene.keyWindow?.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
      let mask: UIInterfaceOrientationMask = landscape ? .landscapeRight : .portrait
      var failure: String? = nil
      scene.requestGeometryUpdate(.iOS(interfaceOrientations: mask)) { error in failure = error.localizedDescription }
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
        promise.resolve(failure.map { "error: \($0)" } ?? "requested; interface orientation \(scene.interfaceOrientation.rawValue)")
      }
    }.runOnQueue(.main)

    /**
     * `app.device.sendToBackground()` (Phase 6.5): leave for the home screen like the Home button, via
     * the private `-[UIApplication suspend]` (e2e builds only). `simctl launch` brings the app back.
     */
    AsyncFunction("suspend") { () -> Bool in
      let sel = NSSelectorFromString("suspend")
      guard UIApplication.shared.responds(to: sel) else { return false }
      UIApplication.shared.perform(sel)
      return true
    }.runOnQueue(.main)

    /**
     * Synchronous (JS thread): whether native UI is still settling — a view controller transition in
     * a window (navigation push / pop, Modal presentation) or the keyboard moving / just used. Sampled
     * on the main thread every frame; read by the agent's `native` idle tracker.
     */
    Function("idleState") { () -> [String: Any] in
      let s = NativeSettleMonitor.shared.snapshot()
      return ["settling": !s.isEmpty, "reasons": s]
    }

    // docs/spikes/05: `xcrun simctl launch <udid> <bundle> -quiescoPort <p> -quiescoSession <id>`;
    // "-key value" launch arguments land in UserDefaults' NSArgumentDomain.
    // `quiescoArgs`: base64 of the test's launch arguments as JSON (Phase 6.5).
    Function("getLaunchParams") { () -> [String: String?] in
      let d = UserDefaults.standard
      return ["port": d.string(forKey: "quiescoPort"), "session": d.string(forKey: "quiescoSession"), "args": d.string(forKey: "quiescoArgs")]
    }

    /** Where a view really is, and whether a touch at its center would reach it. */
    AsyncFunction("locate") { (tag: Int) -> [String: Any] in
      guard let view = QSTouchInjector.view(withReactTag: tag), view.window != nil else { return ["found": false] }
      return Self.describe(view)
    }.runOnQueue(.main)

    /** Like `locate`'s reach fields, for a window point of `tag`'s window (taps at a point). */
    AsyncFunction("hitAt") { (tag: Int, x: Double, y: Double) -> [String: Any] in
      return Self.hit(tag: tag, x: x, y: y) ?? ["found": false]
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
      // Phase 4.5 experiment: the first touch after the keyboard appears is swallowed; prime with a
      // cancelled touch (a cancelled touch never completes a tap, even if delivered).
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
     * One finger along a timed path in the window of `tag` (key window when tag < 0): `path` is flat
     * [x, y, tMs, x, y, tMs, ...] with t from 0, increasing. Down at the first point, up at the last;
     * moves are interpolated every `stepMs` between points that differ, none while the finger rests
     * (a hold). Covers taps / long presses at a point, press-and-drag and swipes from a start point.
     */
    AsyncFunction("gesture") { (tag: Int, path: [Double], promise: Promise) in
      if let missing = QSTouchInjector.missingPrivateAPI() {
        promise.reject("E_UNSUPPORTED", Self.unsupported(missing))
        return
      }
      guard path.count >= 6, path.count % 3 == 0 else {
        promise.reject("E_BAD_ARGS", "path needs at least two [x, y, tMs] points")
        return
      }
      guard let window = (tag >= 0 ? QSTouchInjector.view(withReactTag: tag)?.window : nil) ?? QSTouchInjector.keyWindow() else {
        promise.reject("E_NO_VIEW", "no window for view \(tag)")
        return
      }
      let points = stride(from: 0, to: path.count, by: 3).map { (CGPoint(x: path[$0], y: path[$0 + 1]), path[$0 + 2]) }
      // Expand into timed events: (point, ms from start).
      var events: [(CGPoint, Double)] = []
      for i in 1..<points.count {
        let (a, ta) = points[i - 1]
        let (b, tb) = points[i]
        let steps = a == b ? 1 : max(1, Int((tb - ta) / Double(Self.stepMs)))
        for k in 1...steps {
          let t = Double(k) / Double(steps)
          events.append((CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t), ta + (tb - ta) * t))
        }
      }
      let start = DispatchTime.now()
      var handled = QSTouchInjector.touchDown(at: points[0].0, in: window, tapCount: 1) != nil
      func fire(_ i: Int) {
        let (p, _) = events[i]
        if i == events.count - 1 {
          handled = QSTouchInjector.touchMove(to: p) && handled
          handled = QSTouchInjector.touchUp() && handled
          promise.resolve(["handled": handled])
          return
        }
        handled = QSTouchInjector.touchMove(to: p) && handled
        DispatchQueue.main.asyncAfter(deadline: start + .milliseconds(Int(events[i + 1].1))) { fire(i + 1) }
      }
      DispatchQueue.main.asyncAfter(deadline: start + .milliseconds(Int(events[0].1))) { fire(0) }
    }.runOnQueue(.main)

    /**
     * Several fingers along timed paths in the window of `tag` (key window when tag < 0). `frames` is flat:
     * per frame [tMs, down0, x0, y0, down1, x1, y1, ...] for `fingerCount` fingers (down = 1 while the
     * finger touches), t from 0 and increasing. A finger goes down in the first frame it is down, lifts
     * in the first frame it is not; every finger is lifted after the last frame.
     */
    AsyncFunction("multiGesture") { (tag: Int, fingerCount: Int, frames: [Double], promise: Promise) in
      if let missing = QSTouchInjector.missingPrivateAPI() {
        promise.reject("E_UNSUPPORTED", Self.unsupported(missing))
        return
      }
      let stride = 1 + 3 * fingerCount
      guard fingerCount >= 1, frames.count >= stride, frames.count % stride == 0 else {
        promise.reject("E_BAD_ARGS", "frames must be [t, down, x, y, ...] for \(fingerCount) fingers")
        return
      }
      guard let window = (tag >= 0 ? QSTouchInjector.view(withReactTag: tag)?.window : nil) ?? QSTouchInjector.keyWindow() else {
        promise.reject("E_NO_VIEW", "no window for view \(tag)")
        return
      }
      let count = frames.count / stride
      let start = DispatchTime.now()
      func fire(_ f: Int) {
        let base = f * stride
        var points: [Any] = []
        for i in 0..<fingerCount {
          let o = base + 1 + 3 * i
          points.append(frames[o] > 0.5 ? NSValue(cgPoint: CGPoint(x: frames[o + 1], y: frames[o + 2])) : NSNull())
        }
        QSTouchInjector.sendFingers(points, in: window)
        if f + 1 < count {
          DispatchQueue.main.asyncAfter(deadline: start + .milliseconds(Int(frames[(f + 1) * stride]))) { fire(f + 1) }
        } else {
          QSTouchInjector.liftAllFingers()
          promise.resolve(["handled": true])
        }
      }
      DispatchQueue.main.asyncAfter(deadline: start + .milliseconds(Int(frames[0]))) { fire(0) }
    }.runOnQueue(.main)

    /**
     * A key of the software keyboard on the text field `tag`: `enter` (the return key: a single-line
     * field asks its delegate `textFieldShouldReturn`, which is what UIKit does for the return key and
     * where React Native submits; a multi-line field gets a newline through UIKeyInput, where RN applies
     * its submit behavior) or `backspace` (UIKeyInput.deleteBackward, which RN reports to onKeyPress).
     */
    AsyncFunction("pressKey") { (tag: Int, key: String, promise: Promise) in
      guard let view = QSTouchInjector.view(withReactTag: tag) else {
        promise.reject("E_NO_VIEW", "view \(tag) not found")
        return
      }
      guard let field = Self.findTextInput(view) else {
        promise.reject("E_NOT_TEXT_INPUT", "view \(tag) is not a text field")
        return
      }
      let focused = field.isFirstResponder || field.becomeFirstResponder()
      switch key {
      case "enter":
        if let single = field as? UITextField {
          _ = single.delegate?.textFieldShouldReturn?(single)
        } else {
          field.insertText("\n")
        }
      case "backspace":
        field.deleteBackward()
      default:
        promise.reject("E_BAD_ARGS", "unknown key \(key)")
        return
      }
      KeyboardMotion.shared.touch()
      let current = field.textRange(from: field.beginningOfDocument, to: field.endOfDocument).flatMap { field.text(in: $0) } ?? ""
      promise.resolve(["text": current, "focused": focused])
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
      KeyboardMotion.shared.touch()
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

    /**
     * Geometry of the UISlider in `tag`'s view: window x of the thumb center at the minimum and at the
     * maximum value (UISlider insets its track by half a thumb), the thumb's current x and its y.
     * UISlider only starts tracking on a touch near the thumb, so a drag must start at `thumbX`.
     */
    AsyncFunction("sliderInfo") { (tag: Int) -> [String: Any] in
      guard let view = QSTouchInjector.view(withReactTag: tag), let window = view.window,
            let slider = Self.find(UISlider.self, in: view) else { return ["found": false] }
      let track = slider.trackRect(forBounds: slider.bounds)
      func center(_ value: Float) -> CGPoint {
        let r = slider.thumbRect(forBounds: slider.bounds, trackRect: track, value: value)
        return slider.convert(CGPoint(x: r.midX, y: r.midY), to: window)
      }
      let lo = center(slider.minimumValue)
      let hi = center(slider.maximumValue)
      let cur = center(slider.value)
      return [
        "found": true, "minX": lo.x, "maxX": hi.x, "y": cur.y, "thumbX": cur.x,
        "value": slider.value, "minimum": slider.minimumValue, "maximum": slider.maximumValue,
      ]
    }.runOnQueue(.main)

    /**
     * The wheels (UIPickerView, also the one inside a UIDatePicker in wheels style) in `tag`'s view: per
     * component the selected row, row count, row height, the column's window rect and the selected row's
     * title; for a UIDatePicker also its date (ms since epoch). `tree` lists the picker's view hierarchy
     * (diagnostics: column views are private UIKit classes).
     */
    AsyncFunction("wheelInfo") { (tag: Int) -> [String: Any] in
      guard let view = QSTouchInjector.view(withReactTag: tag), let window = view.window else { return ["found": false] }
      guard let picker = Self.find(UIPickerView.self, in: view) else {
        return ["found": false, "tree": Self.viewTree(view, depth: 0, maxDepth: 8)]
      }
      let columns = Self.columnViews(picker, in: window)
      var components: [[String: Any]] = []
      for c in 0..<picker.numberOfComponents {
        let row = picker.selectedRow(inComponent: c)
        var item: [String: Any] = [
          "selectedRow": row,
          "rows": picker.numberOfRows(inComponent: c),
          "rowHeight": picker.rowSize(forComponent: c).height,
          "title": Self.title(picker, row: row, component: c) ?? NSNull(),
        ]
        if c < columns.count {
          let r = columns[c]
          item["x"] = r.origin.x; item["y"] = r.origin.y; item["width"] = r.size.width; item["height"] = r.size.height
        }
        components.append(item)
      }
      let pr = picker.convert(picker.bounds, to: window)
      // A wheel is moving while one of its scroll views is tracking a finger, dragging or decelerating
      // (UIDatePicker.date and selectedRow update only once it stops).
      var moving = false
      var queue: [UIView] = [picker]
      while let v = queue.popLast() {
        if let sv = v as? UIScrollView, sv.isTracking || sv.isDragging || sv.isDecelerating || !(sv.layer.animationKeys() ?? []).isEmpty { moving = true; break }
        queue.append(contentsOf: v.subviews)
      }
      var out: [String: Any] = [
        "found": true, "components": components, "columnCount": columns.count, "moving": moving,
        "x": pr.origin.x, "y": pr.origin.y, "width": pr.size.width, "height": pr.size.height,
        "tree": Self.viewTree(picker, depth: 0, maxDepth: 6),
      ]
      if let dp = Self.ancestor(UIDatePicker.self, of: picker) {
        out["date"] = dp.date.timeIntervalSince1970 * 1000
        out["datePickerMode"] = dp.datePickerMode.rawValue
        out["locale"] = (dp.locale ?? Locale.current).identifier
      }
      return out
    }.runOnQueue(.main)

    /**
     * Perform the accessibility action `name` on `tag`'s view the way VoiceOver does: `increment` /
     * `decrement` through UIAccessibilityAction (the adjustable swipe), `magicTap` / `escape` through
     * their perform methods, any other through the view's accessibilityCustomActions (the VoiceOver
     * "Actions" rotor) at `index` — React Native lists every declared action there, named by its label
     * (`label`, or the name when it has none).
     */
    AsyncFunction("accessibilityAction") { (tag: Int, name: String, label: String, index: Int, _customIndex: Int, promise: Promise) in
      guard let view = QSTouchInjector.view(withReactTag: tag) else {
        promise.reject("E_NO_VIEW", "view \(tag) not found")
        return
      }
      switch name {
      case "increment":
        view.accessibilityIncrement()
        promise.resolve(["performed": true, "via": "accessibilityIncrement"])
      case "decrement":
        view.accessibilityDecrement()
        promise.resolve(["performed": true, "via": "accessibilityDecrement"])
      case "magicTap":
        promise.resolve(["performed": view.accessibilityPerformMagicTap(), "via": "accessibilityPerformMagicTap"])
      case "escape":
        promise.resolve(["performed": view.accessibilityPerformEscape(), "via": "accessibilityPerformEscape"])
      default:
        let actions = view.accessibilityCustomActions ?? []
        let byIndex = index >= 0 && index < actions.count && actions[index].name == label ? actions[index] : nil
        guard let action = byIndex ?? actions.first(where: { $0.name == label }) else {
          promise.reject("E_NO_ACTION", "view \(tag) has no accessibility custom action \"\(label)\" (has: \(actions.map { $0.name }))")
          return
        }
        var performed = false
        if let handler = action.actionHandler {
          performed = handler(action)
        } else if let target = action.target as? NSObject, target.responds(to: action.selector) {
          _ = target.perform(action.selector, with: action)
          performed = true
        }
        promise.resolve(["performed": performed, "via": "accessibilityCustomActions"])
      }
    }.runOnQueue(.main)
  }

  // MARK: - helpers (main thread)

  /**
   * `app.device.relaunch({ url })` (Phase 6.5): `-quiescoUrl <url>` at launch becomes the URL the app was
   * opened with. The dev client takes `--initialUrl` as the bundle URL, and `simctl openurl` shows a
   * confirmation alert and cannot pass launch arguments, so the link is handed to expo-linking's
   * app-delegate subscriber (what expo-router reads on iOS: `getLinkingURL()`) before JS renders. Looked up
   * at runtime: no build dependency on expo-linking. React Native's `Linking.getInitialURL()` reads launch
   * options and does not see it (platforms.md).
   */
  static func deliverLaunchUrl() {
    guard let raw = UserDefaults.standard.string(forKey: "quiescoUrl"), let url = URL(string: raw) else { return }
    // App-delegate subscribers are @MainActor (creating one off the main thread traps); OnCreate runs on
    // the module registry's thread, before the bundle runs. Async to main: in the Phase 6.5 spike it
    // always landed before expo-router's first read (the main queue is free while JS starts).
    DispatchQueue.main.async {
      guard let cls = NSClassFromString("ExpoLinking.LinkingAppDelegateSubscriber") as? NSObject.Type,
            let subscriber = cls.init() as? UIApplicationDelegate else {
        NSLog("[quiesco] -quiescoUrl given but expo-linking's LinkingAppDelegateSubscriber was not found")
        return
      }
      _ = subscriber.application?(UIApplication.shared, open: url, options: [:])
      NSLog("[quiesco] launch URL delivered to expo-linking: \(raw)")
    }
  }

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
    let keyboardMoving = KeyboardMotion.shared.moving || KeyboardMotion.shared.recentlyActive
    return [
      // UIKit ignores touches during a view controller transition (e.g. a Modal fading in), and a
      // Core Animation on the view or an ancestor changes what is on screen without a layout change.
      // The software keyboard slides in / out in its own window, which can cover the view mid-way, and
      // iOS drops touches right after keyboard activity (KeyboardMotion.quietSeconds).
      "settling": transitioning || animating || keyboardMoving,
      "keyboardMoving": keyboardMoving,
      "animatingLayers": runningAnimations(view),
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
      // Diagnostics for ELEMENT_OBSCURED: the hit view up to its window, and the presented controllers.
      "hitChain": top.map(superviewChain) ?? [],
      // React tags from the hit view up. Fabric does not mount every React child inside its React
      // parent's native view (children of views that form no stacking context are mounted higher up),
      // so "is the hit view a native descendant" is not enough: JS compares these tags with the
      // element's React subtree.
      "hitTags": top.map(tagChain) ?? [],
      "presented": presentedChain(window),
    ]
  }

  /** `tag` of the hit view and its superviews (React tags on Fabric component views; 0 for plain UIKit views). */
  static func tagChain(_ view: UIView) -> [Int] {
    var out: [Int] = []
    var v: UIView? = view
    while let cur = v, out.count < 40 {
      out.append(cur.tag)
      v = cur.superview
    }
    return out
  }

  /** Who would receive a touch at the window point (x, y) of `tag`'s window. */
  static func hit(tag: Int, x: Double, y: Double) -> [String: Any]? {
    guard let view = QSTouchInjector.view(withReactTag: tag), let window = view.window else { return nil }
    let top = topmostHit(window.convert(CGPoint(x: x, y: y), to: nil))
    let reaches = top.map { $0.isDescendant(of: view) || view.isDescendant(of: $0) } ?? false
    return [
      "windowHasFocus": reaches,
      "hitClass": top.map { String(describing: type(of: $0)) } ?? "",
      "hitChain": top.map(superviewChain) ?? [],
      "hitTags": top.map(tagChain) ?? [],
    ]
  }

  /** A view controller of this window is being presented / dismissed, or has a running transition. */
  static func isTransitioning(_ window: UIWindow) -> Bool {
    guard let root = window.rootViewController else { return false }
    return isTransitioning(root, depth: 0)
  }

  /**
   * The whole view controller tree: react-native-screens nests its UINavigationController several
   * levels below the root, and UIKit refuses to present a Modal while a push / pop is running (the
   * Modal then never appears), so a tap must wait for those transitions too.
   */
  static func isTransitioning(_ vc: UIViewController, depth: Int) -> Bool {
    if depth > 32 { return false }
    if vc.transitionCoordinator != nil || vc.isBeingPresented || vc.isBeingDismissed || vc.isMovingToParent || vc.isMovingFromParent {
      return true
    }
    for child in vc.children where isTransitioning(child, depth: depth + 1) { return true }
    if let presented = vc.presentedViewController, presented.presentingViewController === vc {
      return isTransitioning(presented, depth: depth + 1)
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

  static func superviewChain(_ view: UIView) -> [String] {
    var out: [String] = []
    var v: UIView? = view
    while let cur = v, out.count < 12 {
      let f = cur.frame
      out.append("\(String(describing: type(of: cur)))(\(Int(f.minX)),\(Int(f.minY)),\(Int(f.width))x\(Int(f.height)))")
      v = cur.superview
    }
    return out
  }

  static func presentedChain(_ window: UIWindow) -> [String] {
    var out: [String] = []
    var vc = window.rootViewController
    while let cur = vc, out.count < 8 {
      out.append(String(describing: type(of: cur)))
      vc = cur.presentedViewController
    }
    return out
  }

  /** Diagnostics: "<view class>: <animation keys>" for the view and its ancestors. */
  static func runningAnimations(_ view: UIView) -> [String] {
    var out: [String] = []
    var v: UIView? = view
    while let cur = v {
      if let keys = cur.layer.animationKeys(), !keys.isEmpty {
        out.append("\(String(describing: type(of: cur))): \(keys.joined(separator: ","))")
      }
      v = cur.superview
    }
    return out
  }

  /** The first view of class `T` in `view`'s subtree, breadth first (the view itself included). */
  static func find<T: UIView>(_ type: T.Type, in view: UIView) -> T? {
    var queue: [UIView] = [view]
    var i = 0
    while i < queue.count {
      if let hit = queue[i] as? T { return hit }
      queue.append(contentsOf: queue[i].subviews)
      i += 1
    }
    return nil
  }

  static func ancestor<T: UIView>(_ type: T.Type, of view: UIView) -> T? {
    var v: UIView? = view
    while let cur = v {
      if let hit = cur as? T { return hit }
      v = cur.superview
    }
    return nil
  }

  /**
   * Where each column of a picker takes touches, left to right in component order: window rects whose
   * x range is found by hit testing along the selection band. The column views are private
   * (`UIPickerColumnView`), all span the whole picker and are laid out with 3D transforms, so their
   * frames do not tell where a column is (measured on iOS 27); a hit test does. `.zero` when a column
   * takes no touch at any x.
   */
  static func columnViews(_ picker: UIPickerView, in window: UIWindow) -> [CGRect] {
    var columns: [UIView] = []
    func walk(_ v: UIView) {
      for sub in v.subviews {
        if String(describing: type(of: sub)).contains("PickerColumnView") { columns.append(sub) } else { walk(sub) }
      }
    }
    walk(picker)
    let pr = picker.convert(picker.bounds, to: window)
    var lo = [CGFloat](repeating: .infinity, count: columns.count)
    var hi = [CGFloat](repeating: -.infinity, count: columns.count)
    var x = pr.minX + 1
    while x < pr.maxX {
      if let hit = window.hitTest(CGPoint(x: x, y: pr.midY), with: nil) {
        var v: UIView? = hit
        while let cur = v, cur !== picker {
          if let i = columns.firstIndex(where: { $0 === cur }) {
            lo[i] = min(lo[i], x)
            hi[i] = max(hi[i], x)
            break
          }
          v = cur.superview
        }
      }
      x += 2
    }
    return columns.indices.map { i in
      lo[i] <= hi[i] ? CGRect(x: lo[i], y: pr.minY, width: hi[i] - lo[i], height: pr.height) : .zero
    }
  }

  /** Title of a row: the delegate's title, else the text of the labels in the row's view. */
  static func title(_ picker: UIPickerView, row: Int, component: Int) -> String? {
    if row < 0 { return nil }
    if let d = picker.delegate {
      if let t = d.pickerView?(picker, titleForRow: row, forComponent: component) { return t }
      if let t = d.pickerView?(picker, attributedTitleForRow: row, forComponent: component) { return t.string }
    }
    guard let rowView = picker.view(forRow: row, forComponent: component) else { return nil }
    var texts: [String] = []
    func walk(_ v: UIView) {
      if let l = v as? UILabel, let t = l.text, !t.isEmpty { texts.append(t) }
      v.subviews.forEach(walk)
    }
    walk(rowView)
    return texts.isEmpty ? nil : texts.joined(separator: " ")
  }

  static func viewTree(_ view: UIView, depth: Int, maxDepth: Int) -> [String] {
    let f = view.frame
    var out = ["\(String(repeating: "  ", count: depth))\(String(describing: type(of: view)))(\(Int(f.minX)),\(Int(f.minY)),\(Int(f.width))x\(Int(f.height)))"]
    if depth < maxDepth {
      for sub in view.subviews.prefix(12) { out.append(contentsOf: viewTree(sub, depth: depth + 1, maxDepth: maxDepth)) }
    }
    return out
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

/**
 * Whether the software keyboard is sliding in or out: between UIKeyboardWill{Show,Hide} and the matching
 * Did notification. Its window covers part of the screen while it moves; afterwards a hit test sees
 * its final frame.
 */
final class KeyboardMotion {
  static let shared = KeyboardMotion()
  private(set) var moving = false
  /** Between UIKeyboardWillShow and UIKeyboardDidHide. */
  private(set) var visible = false
  /**
   * iOS ignores touches outside the keyboard shortly after keyboard activity (typing, the keyboard
   * appearing or changing): measured on iOS 27, a tap 0 ms after typing is dropped, 300 ms later it
   * is delivered. Taps wait until the keyboard has been quiet for this long.
   */
  static let quietSeconds: CFTimeInterval = 0.4
  private var lastActivity: CFTimeInterval = 0

  /** Keyboard input happened (typeText) or the keyboard changed. */
  func touch() {
    lastActivity = CACurrentMediaTime()
  }

  /** Within the quiet period after keyboard activity, while the keyboard is shown. */
  var recentlyActive: Bool {
    visible && CACurrentMediaTime() - lastActivity < Self.quietSeconds
  }
  private var observers: [NSObjectProtocol] = []

  func start() {
    guard observers.isEmpty else { return }
    let center = NotificationCenter.default
    observers.append(center.addObserver(forName: UIResponder.keyboardWillShowNotification, object: nil, queue: .main) { [weak self] _ in
      self?.moving = true
      self?.visible = true
      self?.touch()
    })
    observers.append(center.addObserver(forName: UIResponder.keyboardWillHideNotification, object: nil, queue: .main) { [weak self] _ in self?.moving = true; self?.touch() })
    observers.append(center.addObserver(forName: UIResponder.keyboardDidShowNotification, object: nil, queue: .main) { [weak self] _ in self?.moving = false; self?.touch() })
    // The keyboard also changes height while shown (e.g. a secure field switches the suggestion bar).
    observers.append(center.addObserver(forName: UIResponder.keyboardWillChangeFrameNotification, object: nil, queue: .main) { [weak self] _ in self?.moving = true; self?.touch() })
    observers.append(center.addObserver(forName: UIResponder.keyboardDidChangeFrameNotification, object: nil, queue: .main) { [weak self] _ in self?.moving = false; self?.touch() })
    observers.append(center.addObserver(forName: UIResponder.keyboardDidHideNotification, object: nil, queue: .main) { [weak self] _ in
      self?.moving = false
      self?.visible = false
      self?.touch()
    })
  }
}

/**
 * Samples native settling state on the main thread every frame (CADisplayLink) and publishes it for
 * synchronous reads from the JS thread. UIKit state must not be read off the main thread.
 */
final class NativeSettleMonitor: NSObject {
  static let shared = NativeSettleMonitor()
  private var link: CADisplayLink?
  private let lock = NSLock()
  private var reasons: [String] = []

  /** Main thread. */
  func start() {
    guard link == nil else { return }
    let l = CADisplayLink(target: self, selector: #selector(tick))
    l.add(to: .main, forMode: .common)
    link = l
    tick()
  }

  @objc private func tick() {
    var r: [String] = []
    for w in QSTouchInjector.windows() where QuiescoNativeModule.isTransitioning(w) {
      r.append("view controller transition in \(String(describing: type(of: w)))")
    }
    if KeyboardMotion.shared.moving { r.append("keyboard moving") } else if KeyboardMotion.shared.recentlyActive { r.append("keyboard just used") }
    lock.lock()
    reasons = r
    lock.unlock()
  }

  /** Any thread. Empty when settled. */
  func snapshot() -> [String] {
    lock.lock()
    defer { lock.unlock() }
    return reasons
  }
}
