import BPCore
import Foundation
import HealthKit

/// The member app's only HealthKit reader. Reads, never writes.
public final class HealthKitSource: ChangeSource {
  public let store: HKHealthStore
  /// Enrollment time. Nothing measured before the member opted in leaves the phone.
  private let since: Date
  private let pageSize: Int

  static let bloodPressure = HKCorrelationType(.bloodPressure)
  static let systolic = HKQuantityType(.bloodPressureSystolic)
  static let diastolic = HKQuantityType(.bloodPressureDiastolic)

  public init(store: HKHealthStore = HKHealthStore(), since: Date, pageSize: Int = 500) {
    self.store = store
    self.since = since
    self.pageSize = pageSize
  }

  /// Blood pressure, plus the watch's hypertension notification (iOS 26.2+) for entry A. Asked in the
  /// one sheet so entry A never needs a second. Each extra topic is another reason to tap Don't
  /// Allow, so nothing else. You can't authorize a correlation type, only the quantities inside it.
  public static var readTypes: Set<HKObjectType> {
    var types: Set<HKObjectType> = [systolic, diastolic]
    if #available(iOS 26.2, macOS 26.2, *) {
      types.insert(HKCategoryType(.hypertensionEvent))
    }
    return types
  }

  /// HealthKit never says whether reads were denied. The funnel counts readings received instead.
  public func requestAccess() async throws {
    try await store.requestAuthorization(toShare: [], read: Self.readTypes)
  }

  /// Whether the member has seen the sheet, which survives relaunch. Not whether they said yes.
  public func asked() async throws -> Bool {
    try await store.statusForAuthorizationRequest(toShare: [], read: Self.readTypes) == .unnecessary
  }

  // MARK: Sync

  public func page(after anchor: Data?) async throws -> Page {
    let descriptor = HKAnchoredObjectQueryDescriptor(
      predicates: [
        .correlation(
          type: Self.bloodPressure,
          predicate: HKQuery.predicateForSamples(withStart: since, end: nil)
        )
      ],
      anchor: try anchor.map(Self.decode),
      limit: pageSize
    )
    let result = try await descriptor.result(for: store)
    return Page(
      changes: Changes(
        readings: result.addedSamples.compactMap(Self.reading),
        // An edit in Apple Health arrives as a delete plus an add.
        tombstones: result.deletedObjects.map { Tombstone(id: $0.uuid.uuidString, platform: .healthkit) }
      ),
      anchor: try Self.encode(result.newAnchor),
      more: result.addedSamples.count + result.deletedObjects.count >= pageSize
    )
  }

  /// Wakes the app when a cuff app writes. Correlation types can't be observed in the background,
  /// so this watches systolic, which every BP write includes. Register from
  /// `application(_:didFinishLaunchingWithOptions:)`, before anything else runs.
  public func observe(_ sync: @escaping @Sendable () async -> Void) async throws {
    let query = HKObserverQuery(sampleType: Self.systolic, predicate: nil) { _, done, error in
      let done = Done(call: done)
      Task {
        if error == nil { await sync() }
        // Always, even when the sync failed: three misses and HealthKit stops waking the app.
        // A failed sync already left the anchor where it was.
        done.call()
      }
    }
    store.execute(query)
    try await store.enableBackgroundDelivery(for: Self.systolic, frequency: .immediate)
  }

  /// HealthKit's completion handler isn't annotated Sendable, but it's documented as callable from
  /// any thread.
  private struct Done: @unchecked Sendable {
    let call: () -> Void
  }

  // MARK: On-device only

  /// Entry B input. Read on the phone, scanned on the phone, never uploaded.
  public func history(days: Int, now: Date = .now) async throws -> [Reading] {
    let descriptor = HKSampleQueryDescriptor(
      predicates: [
        .correlation(
          type: Self.bloodPressure,
          predicate: HKQuery.predicateForSamples(
            withStart: now.addingTimeInterval(-Double(days) * 86_400), end: now)
        )
      ],
      sortDescriptors: [SortDescriptor(\.startDate, order: .reverse)]
    )
    return try await descriptor.result(for: store).compactMap(Self.reading)
  }

  // MARK: Mapping

  static func reading(_ c: HKCorrelation) -> Reading? {
    guard
      let sys = c.objects(for: systolic).first as? HKQuantitySample,
      let dia = c.objects(for: diastolic).first as? HKQuantitySample
    else { return nil }
    let mmHg = HKUnit.millimeterOfMercury()
    let typed = [c.metadata, sys.metadata].contains { $0?[HKMetadataKeyWasUserEntered] as? Bool == true }
    // Apps that record the zone give us the member's real offset. Otherwise the phone's current
    // zone, which is wrong only if they've travelled since.
    let zone = (c.metadata?[HKMetadataKeyTimeZone] as? String).flatMap(TimeZone.init(identifier:)) ?? .current
    let device = c.device ?? sys.device
    return Reading(
      id: c.uuid.uuidString,
      platform: .healthkit,
      systolic: Int(sys.quantity.doubleValue(for: mmHg).rounded()),
      diastolic: Int(dia.quantity.doubleValue(for: mmHg).rounded()),
      measuredAt: c.startDate,
      tzOffsetMin: zone.secondsFromGMT(for: c.startDate) / 60,
      source: .init(
        appId: c.sourceRevision.source.bundleIdentifier,
        appName: c.sourceRevision.source.name,
        deviceModel: device?.model,
        manufacturer: device?.manufacturer
      ),
      method: typed ? .manual : .device
    )
  }

  static func encode(_ anchor: HKQueryAnchor) throws -> Data {
    try NSKeyedArchiver.archivedData(withRootObject: anchor, requiringSecureCoding: true)
  }

  static func decode(_ data: Data) throws -> HKQueryAnchor {
    guard let anchor = try NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: data) else {
      throw CocoaError(.coderReadCorrupt)
    }
    return anchor
  }
}
