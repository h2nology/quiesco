// Quiesco's iOS system-UI runner (Phase 6.7 batch C): a long-running UI test that serves SpringBoard's UI
// over HTTP on 127.0.0.1, so the host can see and tap what is outside the app (permission alerts, Face ID's
// retry alert, notification banners). Started by @quiesco/core (src/devices/ios-runner.ts) with
// `xcodebuild test-without-building`; the port comes from TEST_RUNNER_QUIESCO_PORT.
//   GET  /screen                 → { alerts: [{ label, id, frame, texts, buttons }], others: [{ label, id, frame }] }
//   POST /tap?x=…&y=…            → tap at a point of the screen (points)
//   POST /notificationCenter     → swipe the Notification Center down from the top edge
//   POST /quit                   → end the test
import Network
import XCTest

final class SystemUIServer: XCTestCase {
  private let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
  private var done = false

  func testServe() throws {
    let port = UInt16(ProcessInfo.processInfo.environment["QUIESCO_PORT"] ?? "") ?? 8222
    let params = NWParameters.tcp
    params.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!)
    let listener = try NWListener(using: params)
    listener.newConnectionHandler = { [weak self] c in
      c.start(queue: .main)
      self?.receive(c)
    }
    listener.start(queue: .main)
    while !done {
      RunLoop.current.run(until: Date().addingTimeInterval(0.05))
    }
    listener.cancel()
  }

  private func receive(_ c: NWConnection) {
    c.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, _, _ in
      guard let self, let data, let req = String(data: data, encoding: .utf8) else {
        c.cancel()
        return
      }
      let line = req.split(separator: "\r\n").first.map(String.init) ?? ""
      let parts = line.split(separator: " ")
      let (status, body) = self.handle(parts.count > 1 ? String(parts[1]) : "/")
      let json = (try? JSONSerialization.data(withJSONObject: body)) ?? Data("{}".utf8)
      let head = "HTTP/1.1 \(status)\r\nContent-Type: application/json\r\nContent-Length: \(json.count)\r\nConnection: close\r\n\r\n"
      c.send(content: Data(head.utf8) + json, completion: .contentProcessed { _ in c.cancel() })
    }
  }

  private func handle(_ path: String) -> (String, Any) {
    let comps = URLComponents(string: "http://x\(path)")
    let q = Dictionary((comps?.queryItems ?? []).map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { a, _ in a })
    switch comps?.path ?? "" {
    case "/screen":
      return ("200 OK", screen())
    case "/tap":
      guard let x = Double(q["x"] ?? ""), let y = Double(q["y"] ?? "") else { return ("400 Bad Request", ["error": "x and y"]) }
      springboard.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: x, dy: y)).tap()
      return ("200 OK", ["ok": true])
    case "/notificationCenter":
      let top = springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.0))
      top.press(forDuration: 0.05, thenDragTo: springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.7)))
      return ("200 OK", ["ok": true])
    case "/quit":
      done = true
      return ("200 OK", ["ok": true])
    default:
      return ("404 Not Found", ["error": "unknown \(path)"])
    }
  }

  private func frame(_ e: XCUIElement) -> [Double] {
    let f = e.frame
    return [f.minX, f.minY, f.width, f.height].map { Double($0) }
  }

  private func screen() -> [String: Any] {
    var alerts: [[String: Any]] = []
    var inAlerts = Set<String>()
    for a in springboard.alerts.allElementsBoundByIndex where a.exists {
      let texts = a.staticTexts.allElementsBoundByIndex.map { ["label": $0.label, "frame": frame($0)] as [String: Any] }
      let buttons = a.buttons.allElementsBoundByIndex.map { b -> [String: Any] in
        inAlerts.insert("\(b.label)|\(frame(b))")
        return ["label": b.label, "id": b.identifier, "frame": frame(b)]
      }
      alerts.append(["label": a.label, "id": a.identifier, "frame": frame(a), "texts": texts, "buttons": buttons])
    }
    // Banners and Notification Center cells: SpringBoard buttons with a label, outside the alerts.
    var others: [[String: Any]] = []
    for b in springboard.buttons.allElementsBoundByIndex where !b.label.isEmpty && b.isHittable {
      if inAlerts.contains("\(b.label)|\(frame(b))") { continue }
      others.append(["label": b.label, "id": b.identifier, "frame": frame(b)])
    }
    return ["alerts": alerts, "others": others]
  }
}
