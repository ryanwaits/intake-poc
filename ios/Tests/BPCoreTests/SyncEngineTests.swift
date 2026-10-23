import Foundation
import Synchronization
import Testing

@testable import BPCore

/// Silent-bug tests only: a sync that loses data or moves the anchor backwards raises no error and
/// no flow would notice. HealthKit itself is exercised end to end on a device; here the health
/// store is a list of pages and the server is a list of what arrived.

private final class Pages: ChangeSource {
  let pages: [Page]
  /// Reads in flight right now, and the most ever seen at once.
  let reading = Mutex((now: 0, most: 0))
  init(_ pages: [Page]) { self.pages = pages }

  func page(after anchor: Data?) async throws -> Page {
    reading.withLock { $0.now += 1; $0.most = max($0.most, $0.now) }
    try await Task.sleep(for: .milliseconds(5))
    reading.withLock { $0.now -= 1 }
    let next = anchor.map { Int($0[0]) + 1 } ?? 0
    return pages[min(next, pages.count - 1)]
  }
}

private final class Server: ChangeSink {
  let received = Mutex<[Changes]>([])
  let failOnCall = Mutex<Int?>(nil)

  func send(_ changes: Changes) async throws {
    try received.withLock { r in
      if failOnCall.withLock({ $0 == r.count }) { throw URLError(.notConnectedToInternet) }
      r.append(changes)
    }
  }
}

private final class Anchors: AnchorStore {
  let saved = Mutex<[Data]>([])
  func load() -> Data? { saved.withLock { $0.last } }
  func save(_ anchor: Data) { saved.withLock { $0.append(anchor) } }
}

private func reading(_ id: String) -> Reading {
  Reading(
    id: id, platform: .healthkit, systolic: 130, diastolic: 82, measuredAt: .now, tzOffsetMin: -300,
    source: .init(appId: "com.example.cuffapp", appName: "Cuff App", deviceModel: "HEM-7155T"),
    method: .device
  )
}

/// Page n carries readings r{n}a, r{n}b and moves the anchor to n. The last page is empty.
private func pages(_ n: Int) -> [Page] {
  (0..<n).map { i in
    Page(
      changes: Changes(readings: [reading("r\(i)a"), reading("r\(i)b")], tombstones: []),
      anchor: Data([UInt8(i)]),
      more: i < n - 1
    )
  }
}

@Test func anchorMovesOnlyAfterTheServerAccepts() async throws {
  let server = Server()
  let anchors = Anchors()
  server.failOnCall.withLock { $0 = 1 }
  let engine = SyncEngine(source: Pages(pages(3)), sink: server, anchors: anchors)

  await #expect(throws: URLError.self) { try await engine.run() }
  #expect(anchors.saved.withLock { $0 } == [Data([0])], "page 1 failed, so the anchor stays on page 0")

  server.failOnCall.withLock { $0 = nil }
  #expect(try await engine.run() == 4, "resumes at page 1: nothing lost, nothing resent from page 0")
  #expect(server.received.withLock { $0.flatMap(\.readings).map(\.id) } == ["r0a", "r0b", "r1a", "r1b", "r2a", "r2b"])
}

@Test func concurrentWakesTakeTurns() async throws {
  let source = Pages(pages(4))
  let anchors = Anchors()
  let engine = SyncEngine(source: source, sink: Server(), anchors: anchors)

  async let foreground = engine.run()
  async let background = engine.run()
  async let another = engine.run()
  _ = try await (foreground, background, another)

  #expect(source.reading.withLock { $0.most } == 1, "two syncs read the store at once")
  let saved = anchors.saved.withLock { $0.map { Int($0[0]) } }
  #expect(saved == saved.sorted(), "an older anchor overwrote a newer one: \(saved)")
  #expect(saved.last == 3)
}
