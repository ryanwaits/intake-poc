import Foundation
import Testing

@testable import BPCore

/// The same goldens the server and Android run. If these fail, the phone and server disagree.
private let goldens = URL(filePath: #filePath)
  .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
  .deletingLastPathComponent().appending(path: "goldens")

private func load<T: Decodable>(_ name: String, as: T.Type) throws -> T {
  let decoder = JSONDecoder()
  decoder.dateDecodingStrategy = .iso8601
  return try decoder.decode(T.self, from: Data(contentsOf: goldens.appending(path: name)))
}

private struct CrisisGolden: Decodable {
  struct Case: Decodable {
    struct BP: Decodable { var systolic: Int, diastolic: Int }
    var name: String
    var reading: BP
    var expect: Bool
  }
  var config: Config.Crisis
  var cases: [Case]
}

private struct ScanGolden: Decodable {
  struct Case: Decodable {
    struct Row: Decodable { var systolic: Int, diastolic: Int, measuredAt: Date, tzOffsetMin: Int }
    struct Expect: Decodable { var invite: Bool, days: Int }
    var name: String
    var readings: [Row]
    var expect: Expect
  }
  var config: Config.HistoryScan
  var now: Date
  var cases: [Case]
}

@Test func crisisGoldens() throws {
  let golden = try load("crisis.json", as: CrisisGolden.self)
  for c in golden.cases {
    #expect(
      Rules.isCrisis(systolic: c.reading.systolic, diastolic: c.reading.diastolic, golden.config) == c.expect,
      "\(c.name)"
    )
  }
}

@Test func historyScanGoldens() throws {
  let golden = try load("history-scan.json", as: ScanGolden.self)
  for c in golden.cases {
    let readings = c.readings.enumerated().map { i, row in
      Reading(
        id: "\(i)", platform: .healthkit, systolic: row.systolic, diastolic: row.diastolic,
        measuredAt: row.measuredAt, tzOffsetMin: row.tzOffsetMin,
        source: .init(appId: "golden", appName: "Golden"), method: .device
      )
    }
    let scan = Rules.historyScan(readings, now: golden.now, golden.config)
    #expect(scan == .init(invite: c.expect.invite, days: c.expect.days), "\(c.name)")
  }
}
