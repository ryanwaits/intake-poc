import Foundation

/// Everything between two anchors in the health store.
public struct Page: Sendable {
  public var changes: Changes
  public var anchor: Data
  public var more: Bool

  public init(changes: Changes, anchor: Data, more: Bool) {
    self.changes = changes
    self.anchor = anchor
    self.more = more
  }
}

public protocol ChangeSource: Sendable {
  func page(after anchor: Data?) async throws -> Page
}

public protocol ChangeSink: Sendable {
  func send(_ changes: Changes) async throws
}

public protocol AnchorStore: Sendable {
  func load() -> Data?
  func save(_ anchor: Data)
}

/// Moves health-store changes to the server. The anchor advances only after the server accepts a
/// page, so the OS health store is the outbox: offline, locked or failing, nothing is lost, and we
/// keep no copy of a reading on the phone. Resends are safe because the server is idempotent.
public actor SyncEngine {
  private let source: ChangeSource
  private let sink: ChangeSink
  private let anchors: AnchorStore
  private var inFlight: Task<Int, Error>?

  public init(source: ChangeSource, sink: ChangeSink, anchors: AnchorStore) {
    self.source = source
    self.sink = sink
    self.anchors = anchors
  }

  /// Runs one at a time. A background wake during a foreground sync waits, then syncs again, so an
  /// older anchor can never overwrite a newer one.
  @discardableResult
  public func run() async throws -> Int {
    while let running = inFlight {
      _ = try? await running.value
    }
    let task = Task {
      defer { inFlight = nil }
      return try await drain()
    }
    inFlight = task
    return try await task.value
  }

  private func drain() async throws -> Int {
    var anchor = anchors.load()
    var sent = 0
    while true {
      let page = try await source.page(after: anchor)
      if !page.changes.readings.isEmpty || !page.changes.tombstones.isEmpty {
        try await sink.send(page.changes)
      }
      anchors.save(page.anchor)
      anchor = page.anchor
      sent += page.changes.readings.count
      if !page.more { return sent }
    }
  }
}
