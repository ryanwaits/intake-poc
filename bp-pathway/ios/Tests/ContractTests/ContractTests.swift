import BPCore
import Foundation
import HealthSync
import Testing

/// The boundary where Swift's JSON meets the server's: dates, enums, nulls, rejections, and the
/// anchor-on-ack rule over a real socket. Runs only with BP_SERVER_URL set (see ../check.sh).
private let server = ProcessInfo.processInfo.environment["BP_SERVER_URL"].flatMap(URL.init(string:))

private final class OnePage: ChangeSource {
  let changes: Changes
  init(_ changes: Changes) { self.changes = changes }
  func page(after anchor: Data?) async throws -> Page {
    Page(changes: anchor == nil ? changes : Changes(readings: [], tombstones: []), anchor: Data([1]), more: false)
  }
}

private final class MemoryAnchors: AnchorStore, @unchecked Sendable {
  var anchor: Data?
  func load() -> Data? { anchor }
  func save(_ anchor: Data) { self.anchor = anchor }
}

private func reading(_ id: String, _ sys: Int, _ dia: Int, hoursAgo: Double, source: Reading.Source) -> Reading {
  Reading(
    id: id, platform: .healthkit, systolic: sys, diastolic: dia,
    measuredAt: Date.now.addingTimeInterval(-hoursAgo * 3600), tzOffsetMin: -300, source: source,
    method: source.appId == "com.apple.Health" ? .manual : .device
  )
}

private let cuff = Reading.Source(appId: "com.example.cuffapp", appName: "Cuff App", deviceModel: "HEM-7155T")
private let ring = Reading.Source(appId: "com.example.ring", appName: "Ring", deviceModel: "Ring 4")

@Test(.enabled(if: server != nil))
func swiftClientSpeaksTheServersContract() async throws {
  let api = APIClient(base: try #require(server), member: "contract-\(UUID().uuidString)")
  let config = try await api.config()
  #expect(config.crisis.systolic == 180)

  // Not enrolled: the server refuses, so the anchor must not move.
  let early = MemoryAnchors()
  let refused = Changes(readings: [reading("c0", 128, 82, hoursAgo: 0, source: cuff)], tombstones: [])
  await #expect(throws: APIError(status: 409)) {
    try await SyncEngine(source: OnePage(refused), sink: api, anchors: early).run()
  }
  #expect(early.anchor == nil)

  let enrolled = try await api.enroll(.history)
  #expect(enrolled.state == .collecting && enrolled.entry == .history)
  #expect(try #require(enrolled.enrolledAt).timeIntervalSinceNow > -60)

  // Measured after opting in, as the app's predicate guarantees.
  let anchors = MemoryAnchors()
  let page = Changes(
    readings: [reading("c1", 128, 82, hoursAgo: 0, source: cuff), reading("c2", 190, 100, hoursAgo: 0, source: ring)],
    tombstones: []
  )
  #expect(try await SyncEngine(source: OnePage(page), sink: api, anchors: anchors).run() == 2)
  #expect(anchors.anchor == Data([1]))

  let pathway = try await api.pathway()
  #expect(pathway.summary.crisis == ["c2"])
  #expect(pathway.summary.excluded.map(\.reason).contains("unverified_device"))
  #expect(pathway.summary.average == nil)
}
