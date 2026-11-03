import BPCore
import Foundation
import HealthKit
import HealthSync
import Observation

/// Everything the screen shows. The server owns state and the average; the phone owns reads.
@MainActor @Observable
final class Model {
  var available = true
  var connected = false
  var config: Config?
  var pathway: Pathway?
  var readings: [Reading] = []
  var scan: Rules.Scan?
  var busy = false
  var error: String?

  func connect() async {
    do { try await Sync.source(since: .now).requestAccess() } catch { self.error = "\(error)" }
    await refresh()
  }

  func enroll() async {
    do { _ = try await Sync.api.enroll(.history) } catch { self.error = "\(error)" }
    await refresh()
  }

  /// Foreground sync on every appearance, through the same engine background wakes use.
  func refresh() async {
    guard HKHealthStore.isHealthDataAvailable() else {
      available = false
      return
    }
    busy = true
    defer { busy = false }
    do {
      let config = try await Sync.api.config()
      var pathway = try await Sync.api.pathway()
      // Server state first: a slow health store mustn't hold the screen on "Loading".
      self.config = config
      self.pathway = pathway
      let since = pathway.enrolledAt
      Sync.enrolledAt = since
      let source = Sync.source(since: since ?? .distantPast)
      // HealthKit never says whether reads were denied, so "connected" means we asked; data tells.
      let connected = try await source.asked()
      let history = connected ? try await source.history(days: config.historyScan.lookbackDays) : []
      if let since, connected {
        try await Sync.engine(since: since).run()
        pathway = try await Sync.api.pathway()
        try await Sync.observe(since: since)
      }
      self.connected = connected
      self.pathway = pathway
      self.readings = history.filter { since == nil || $0.measuredAt >= since! }
      self.scan = Rules.historyScan(history, now: .now, config.historyScan)
      self.error = nil
    } catch {
      self.error = "\(error)"
    }
  }

  #if DEBUG
    func seed() async {
      do {
        try await Seed.week(Sync.store)
      } catch {
        self.error = "\(error)"
      }
      await refresh()
    }
  #endif
}
