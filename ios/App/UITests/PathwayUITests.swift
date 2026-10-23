import XCTest

/// The iOS twin of the Android emulator run, nothing mocked: seed a week into HealthKit, see the
/// invite, a clinician starts the check, sync, and the screen shows what the server decided.
/// Needs the server (BP_SERVER_URL) and a fresh simulator, because HealthKit keeps every seed.
@MainActor
final class PathwayUITests: XCTestCase {
  let server = URL(string: ProcessInfo.processInfo.environment["BP_SERVER_URL"] ?? "http://localhost:3100/")!

  func testAWeekFromHealthKitToTheCareTeam() async throws {
    let app = XCUIApplication()
    app.launchEnvironment["API_BASE"] = server.absoluteString
    app.launch()
    XCTAssert(text(app, "Not started").waitForExistence(timeout: 30), "server unreachable or HealthKit hung")

    app.buttons["Seed a week"].tap()
    allowHealth(app)
    app.buttons["Connect"].tap()
    allowHealth(app)
    // iOS 27 then asks how far back reads may go. Entry B scans 30 days, so the narrower choice loses nothing.
    let history = app.staticTexts["Past 30 Days and Future Data"]
    XCTAssert(history.waitForExistence(timeout: 10), app.debugDescription)
    history.tap()
    app.buttons["Allow"].tap()

    // Entry B: the scan ran on the phone over 30 days of readings; nothing has left it yet.
    XCTAssert(app.staticTexts["A free blood pressure check"].waitForExistence(timeout: 10))
    XCTAssert(text(app, containing: "above 130/80 on 7 days in the last 30 days").exists)
    XCTAssert(text(app, "Readings on this phone").exists)
    keep(app.screenshot(), "invite")

    // Entry C: the clinician starts the week, back-dated so the seeded readings fall inside it.
    try await post("v1/care/members/demo-member/enroll", ["at": Date.now.addingTimeInterval(-7 * 86_400)])
    app.buttons["Sync now"].tap()

    XCTAssert(text(app, "Done. Your care team will review it within 1 business day.").waitForExistence(timeout: 10))
    XCTAssert(text(app, containing: "Your average from").exists)
    XCTAssert(text(app, "Not in your average · typed in").exists)
    let ring = text(app, "Very high · not in your average (not a validated cuff)")
    XCTAssert(ring.exists)
    // Sync now sits at the bottom: back to the top for the progress card, then down to the ring.
    for _ in 0..<5 { app.swipeDown() }
    keep(app.screenshot(), "ready")
    for _ in 0..<5 where !ring.isHittable { app.swipeUp() }
    keep(app.screenshot(), "crisis")

    // The ring's 186/112 never counts toward the average, but it still reached the care team, once.
    let tasks = try await get("v1/care/tasks").filter { $0["member"] as? String == "demo-member" }
    XCTAssertEqual(tasks.count, 1)
  }

  /// HealthKit's own sheet: select every topic, then Allow. Matched by identifier, because the
  /// labels change between iOS versions ("Turn On All" became "Select All 1 Topic" in iOS 27).
  private func allowHealth(_ app: XCUIApplication) {
    let all = app.cells["UIA.Health.AuthSheet.AllCategoryButton"]
    XCTAssert(all.waitForExistence(timeout: 15), app.debugDescription)
    all.tap()
    // Below the fold, Allow isn't a button until scrolled to.
    let allow = app.buttons["UIA.Health.Allow.Button"]
    for _ in 0..<3 where !allow.exists { app.swipeUp() }
    XCTAssert(allow.waitForExistence(timeout: 5), app.debugDescription)
    allow.tap()
  }

  /// Passing runs drop attachments unless told to keep them.
  private func keep(_ screenshot: XCUIScreenshot, _ name: String) {
    let shot = XCTAttachment(screenshot: screenshot)
    shot.name = name
    shot.lifetime = .keepAlways
    add(shot)
  }

  private func text(_ app: XCUIApplication, _ label: String) -> XCUIElement {
    app.staticTexts[label].firstMatch
  }

  private func text(_ app: XCUIApplication, containing part: String) -> XCUIElement {
    app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", part)).firstMatch
  }

  private func post(_ path: String, _ body: [String: Date]) async throws {
    var req = URLRequest(url: server.appending(path: path))
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "content-type")
    req.httpBody = try JSONSerialization.data(withJSONObject: body.mapValues { $0.ISO8601Format() })
    let (_, response) = try await URLSession.shared.data(for: req)
    XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 201)
  }

  private func get(_ path: String) async throws -> [[String: Any]] {
    let (data, _) = try await URLSession.shared.data(from: server.appending(path: path))
    return try JSONSerialization.jsonObject(with: data) as? [[String: Any]] ?? []
  }
}
