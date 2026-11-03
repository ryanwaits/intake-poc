import Foundation

/// Field for field with server/src/types.ts and the Kotlin module. A change here is a change there.
public enum Platform: String, Codable, Sendable {
  case healthkit, healthconnect
}

public struct Reading: Codable, Sendable, Equatable {
  public struct Source: Codable, Sendable, Equatable {
    public var appId: String
    public var appName: String
    public var deviceModel: String?
    public var manufacturer: String?

    public init(appId: String, appName: String, deviceModel: String? = nil, manufacturer: String? = nil) {
      self.appId = appId
      self.appName = appName
      self.deviceModel = deviceModel
      self.manufacturer = manufacturer
    }
  }

  public enum Method: String, Codable, Sendable {
    case device, manual, unknown
  }

  /// HealthKit sample UUID. The server's idempotency key; it survives reinstalls.
  public var id: String
  public var platform: Platform
  /// Whole mmHg, as the cuff shows them.
  public var systolic: Int
  public var diastolic: Int
  public var measuredAt: Date
  /// The member's offset from UTC at the reading, so AM/PM and days are theirs.
  public var tzOffsetMin: Int
  public var source: Source
  public var method: Method

  public init(
    id: String, platform: Platform, systolic: Int, diastolic: Int,
    measuredAt: Date, tzOffsetMin: Int, source: Source, method: Method
  ) {
    self.id = id
    self.platform = platform
    self.systolic = systolic
    self.diastolic = diastolic
    self.measuredAt = measuredAt
    self.tzOffsetMin = tzOffsetMin
    self.source = source
    self.method = method
  }
}

public struct Tombstone: Codable, Sendable, Equatable {
  public var id: String
  public var platform: Platform

  public init(id: String, platform: Platform) {
    self.id = id
    self.platform = platform
  }
}

/// One page between two anchors. The server's 2xx is what lets the anchor move.
public struct Changes: Codable, Sendable, Equatable {
  public var readings: [Reading]
  public var tombstones: [Tombstone]

  public init(readings: [Reading], tombstones: [Tombstone]) {
    self.readings = readings
    self.tombstones = tombstones
  }
}

public enum Entry: String, Codable, Sendable {
  case watchEvent = "watch_event"
  case history
  case clinician
}

/// The slice of the clinical config the phone needs. Served by the API, versioned, cached.
public struct Config: Codable, Sendable, Equatable {
  public struct Crisis: Codable, Sendable, Equatable {
    public var systolic: Int
    public var diastolic: Int
  }

  public struct HistoryScan: Codable, Sendable, Equatable {
    public var lookbackDays: Int
    public var minDays: Int
    public var systolic: Int
    public var diastolic: Int
  }

  public var version: String
  public var crisis: Crisis
  public var historyScan: HistoryScan
}

/// What the member's screens render. The server derives it; the phone never computes the average.
public struct Pathway: Codable, Sendable, Equatable {
  public enum State: String, Codable, Sendable {
    /// Not `none`: on an optional, `.none` means nil, and `pathway?.state == .none` would be true
    /// with no pathway at all.
    case notStarted = "none"
    case collecting, stalled, ready, reviewed
  }

  public struct Summary: Codable, Sendable, Equatable {
    public struct Day: Codable, Sendable, Equatable {
      public var day: String
      public var am: Int
      public var pm: Int
    }

    public struct Excluded: Codable, Sendable, Equatable {
      public var id: String
      public var reason: String
    }

    public struct Average: Codable, Sendable, Equatable {
      public var systolic: Int
      public var diastolic: Int
    }

    public var configVersion: String
    public var counted: Int
    public var required: Int
    public var average: Average?
    public var days: [Day]
    public var excluded: [Excluded]
    public var crisis: [String]
  }

  public var state: State
  public var entry: Entry?
  /// The protocol's start. The phone sends nothing measured before it.
  public var enrolledAt: Date?
  public var summary: Summary
}
