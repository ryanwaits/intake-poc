import Foundation

/// The two rules that run on the phone. Same logic as Kotlin (and, for `isCrisis`, the server),
/// held to goldens/crisis.json and goldens/history-scan.json in every suite.
public enum Rules {
  /// Any source counts. Safety never filters by provenance.
  public static func isCrisis(systolic: Int, diastolic: Int, _ c: Config.Crisis) -> Bool {
    systolic >= c.systolic || diastolic >= c.diastolic
  }

  public struct Scan: Equatable, Sendable {
    public var invite: Bool
    /// Distinct local days with an elevated reading inside the lookback.
    public var days: Int
  }

  /// Entry B. Runs on the phone over readings already in the health store; nothing uploads.
  /// It's an invitation, not a diagnosis, so typed and unverified readings count too.
  public static func historyScan(_ readings: [Reading], now: Date, _ c: Config.HistoryScan) -> Scan {
    let cutoff = now.addingTimeInterval(-Double(c.lookbackDays) * 86_400)
    let days = Set(
      readings
        .filter { $0.measuredAt >= cutoff && ($0.systolic >= c.systolic || $0.diastolic >= c.diastolic) }
        .map(localDay)
    )
    return Scan(invite: days.count >= c.minDays, days: days.count)
  }

  /// The member's calendar day, from UTC plus the offset the phone recorded.
  static func localDay(_ r: Reading) -> String {
    let shifted = r.measuredAt.addingTimeInterval(Double(r.tzOffsetMin) * 60)
    return ISO8601DateFormatter.string(from: shifted, timeZone: .gmt, formatOptions: .withFullDate)
  }
}
