import BPCore
import HealthKit
import HealthSync
import SwiftUI
import UIKit

@main
struct BPPathwayApp: App {
  @UIApplicationDelegateAdaptor private var delegate: AppDelegate

  var body: some Scene {
    WindowGroup { ContentView() }
  }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
  /// HealthKit wakes the app here, before any UI or network. Register the observer now, from the
  /// enrollment date saved last time, or the wake is wasted.
  func application(
    _ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    if let since = Sync.enrolledAt {
      Task { try? await Sync.observe(since: since) }
    }
    return true
  }
}

/// Spike identity and wiring. The real app gets the member from the signed-in session.
enum Sync {
  static let member = "demo-member"
  /// The UI test points the app at its own server. A HealthKit wake has no environment, so the
  /// default is the dev server.
  static let api = APIClient(
    base: URL(string: ProcessInfo.processInfo.environment["API_BASE"] ?? "http://localhost:3100/")!, member: member)

  /// Saved so a background wake can sync without asking the server first.
  static var enrolledAt: Date? {
    get { UserDefaults.standard.object(forKey: "bp.enrolledAt") as? Date }
    set { UserDefaults.standard.set(newValue, forKey: "bp.enrolledAt") }
  }

  static func source(since: Date) -> HealthKitSource { HealthKitSource(store: store, since: since) }

  /// One engine per process: its serial run is what keeps a background wake and a foreground sync
  /// from racing, and that only works if they share it.
  @MainActor private static var engines: [Date: SyncEngine] = [:]
  @MainActor static func engine(since: Date) -> SyncEngine {
    if let engine = engines[since] { return engine }
    let engine = SyncEngine(source: source(since: since), sink: api, anchors: DefaultsAnchorStore())
    engines[since] = engine
    return engine
  }

  /// One observer query per process. Each registration is another wake for the same write.
  @MainActor private static var observing: Date?
  @MainActor static func observe(since: Date) async throws {
    guard observing != since else { return }
    observing = since
    do {
      try await source(since: since).observe { _ = try? await engine(since: since).run() }
    } catch {
      observing = nil
      throw error
    }
  }

  static let store = HKHealthStore()
}
