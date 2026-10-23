#if DEBUG
  import Foundation
  import HealthKit

  /// Debug only: a synthetic week in HealthKit, as a cuff app would write it. Every sample's source
  /// is this app, so the device model carries the cuff's identity (config/pathway.json allows this
  /// bundle id with model HEM-7155T). The hypertension notification is Apple's own read-only type,
  /// so entry A can't be seeded; it needs a real watch.
  enum Seed {
    static func week(_ store: HKHealthStore) async throws {
      let types: Set = [HKQuantityType(.bloodPressureSystolic), HKQuantityType(.bloodPressureDiastolic)]
      try await store.requestAuthorization(toShare: types, read: [])

      let cuff = HKDevice(
        name: "Cuff", manufacturer: "Omron", model: "HEM-7155T", hardwareVersion: nil, firmwareVersion: nil,
        softwareVersion: nil, localIdentifier: nil, udiDeviceIdentifier: nil)
      let ring = HKDevice(
        name: "Ring", manufacturer: "Example", model: "Ring 4", hardwareVersion: nil, firmwareVersion: nil,
        softwareVersion: nil, localIdentifier: nil, udiDeviceIdentifier: nil)
      let calendar = Calendar.current
      let today = calendar.startOfDay(for: .now)
      func at(_ daysAgo: Int, _ hour: Int, _ minute: Int = 0) -> Date {
        calendar.date(byAdding: DateComponents(day: -daysAgo, hour: hour, minute: minute), to: today)!
      }

      var samples: [HKCorrelation] = []
      for daysAgo in (0...6).reversed() {
        let i = 6 - daysAgo
        samples.append(bp(at(daysAgo, 7, 30), 138 + i % 3, 88, cuff))
        samples.append(bp(at(daysAgo, 20, 30), 134 + i % 4, 85, cuff))
      }
      samples += [
        // A typed copy of day one's first reading.
        bp(at(6, 7, 31), 138, 88, nil, typed: true),
        // A ring's estimate, high enough to be a crisis: excluded from the average, still flagged.
        bp(at(4, 9), 186, 112, ring),
      ]
      try await store.save(samples.filter { $0.startDate < .now })
    }

    private static func bp(_ date: Date, _ sys: Int, _ dia: Int, _ device: HKDevice?, typed: Bool = false) -> HKCorrelation {
      let mmHg = HKUnit.millimeterOfMercury()
      let metadata: [String: Any] = [
        HKMetadataKeyWasUserEntered: typed,
        HKMetadataKeyTimeZone: TimeZone.current.identifier,
      ]
      let sample = { (type: HKQuantityTypeIdentifier, value: Int) in
        HKQuantitySample(
          type: HKQuantityType(type), quantity: HKQuantity(unit: mmHg, doubleValue: Double(value)),
          start: date, end: date, device: device, metadata: metadata)
      }
      return HKCorrelation(
        type: HKCorrelationType(.bloodPressure), start: date, end: date,
        objects: [sample(.bloodPressureSystolic, sys), sample(.bloodPressureDiastolic, dia)],
        device: device, metadata: metadata)
    }
  }
#endif
