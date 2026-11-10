// 6.7 batch C spike: a long-running UI test serving SpringBoard's UI over HTTP (like WebDriverAgent).
//   GET  /nodes            → alerts' texts and buttons, banners (label, identifier, frame, type)
//   POST /tap?label=…      → tap the first hittable button / element with that label
//   POST /quit             → end the test
// The port comes from TEST_RUNNER_QUIESCO_PORT (xcodebuild strips the TEST_RUNNER_ prefix).
import Network
import XCTest

final class SystemUIServer: XCTestCase {
  private let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
  private var done = false

  func testServe() throws {
    let port = UInt16(ProcessInfo.processInfo.environment["QUIESCO_PORT"] ?? "8222") ?? 8222
    let listener = try NWListener(using: .tcp, on: NWEndpoint.Port(rawValue: port)!)
    listener.newConnectionHandler = { [weak self] c in
      c.start(queue: .main)
      self?.receive(c)
    }
    listener.start(queue: .main)
    NSLog("QUIESCO_RUNNER_READY port=%d", port)
    while !done {
      RunLoop.current.run(until: Date().addingTimeInterval(0.05))
    }
    listener.cancel()
  }

  private func receive(_ c: NWConnection) {
    c.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, _, _ in
      guard let self, let data, let req = String(data: data, encoding: .utf8) else { c.cancel(); return }
      let line = req.split(separator: "\r\n").first.map(String.init) ?? ""
      let parts = line.split(separator: " ")
      let path = parts.count > 1 ? String(parts[1]) : "/"
      let t0 = Date()
      let body = self.handle(path)
      let ms = Int(Date().timeIntervalSince(t0) * 1000)
      let json = (try? JSONSerialization.data(withJSONObject: ["ms": ms, "result": body])) ?? Data()
      let head = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: \(json.count)\r\nConnection: close\r\n\r\n"
      c.send(content: head.data(using: .utf8)! + json, completion: .contentProcessed { _ in c.cancel() })
    }
  }

  private func handle(_ path: String) -> Any {
    let comps = URLComponents(string: "http://x\(path)")
    let q = Dictionary(uniqueKeysWithValues: (comps?.queryItems ?? []).map { ($0.name, $0.value ?? "") })
    switch comps?.path ?? "" {
    case "/nodes":
      return nodes()
    case "/tap":
      return tap(label: q["label"] ?? "")
    case "/quit":
      done = true
      return "bye"
    default:
      return "unknown \(path)"
    }
  }

  private func describe(_ e: XCUIElement, _ type: String) -> [String: Any] {
    let f = e.frame
    return ["type": type, "label": e.label, "id": e.identifier, "frame": [f.minX, f.minY, f.width, f.height], "hittable": e.isHittable]
  }

  private func nodes() -> [[String: Any]] {
    var out: [[String: Any]] = []
    for a in springboard.alerts.allElementsBoundByIndex {
      out.append(describe(a, "alert"))
      for t in a.staticTexts.allElementsBoundByIndex { out.append(describe(t, "text")) }
      for b in a.buttons.allElementsBoundByIndex { out.append(describe(b, "button")) }
    }
    // Banners and other SpringBoard UI: buttons / other elements whose label is set.
    for b in springboard.buttons.allElementsBoundByIndex where !b.label.isEmpty && b.isHittable {
      out.append(describe(b, "sb-button"))
    }
    return out
  }

  private func tap(label: String) -> Any {
    let candidates = [springboard.alerts.buttons[label], springboard.buttons[label], springboard.otherElements[label], springboard.staticTexts[label]]
    for e in candidates where e.exists && e.isHittable {
      e.tap()
      return "tapped"
    }
    let partial = springboard.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", label)).firstMatch
    if partial.exists && partial.isHittable {
      partial.tap()
      return "tapped (contains)"
    }
    return "not found"
  }
}
