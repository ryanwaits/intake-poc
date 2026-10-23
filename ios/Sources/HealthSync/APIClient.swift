import BPCore
import Foundation

public struct APIError: Error, Equatable {
  public var status: Int

  public init(status: Int) {
    self.status = status
  }
}

/// The member side of the pathway API. Any non-2xx throws, which is what keeps the anchor in place.
public struct APIClient: ChangeSink {
  let base: URL
  /// Spike auth. The real client sends the session token from the Keychain.
  let member: String
  let session: URLSession

  public init(base: URL, member: String, session: URLSession = APIClient.uncached) {
    self.base = base
    self.member = member
    self.session = session
  }

  /// `.shared` caches GETs on disk: health data at rest, and a stale pathway state on screen.
  public static let uncached: URLSession = {
    let config = URLSessionConfiguration.ephemeral
    config.urlCache = nil
    config.requestCachePolicy = .reloadIgnoringLocalCacheData
    return URLSession(configuration: config)
  }()

  public func send(_ changes: Changes) async throws {
    _ = try await request("v1/health/changes", body: changes)
  }

  public func enroll(_ entry: Entry) async throws -> Pathway {
    try decoder.decode(Pathway.self, from: await request("v1/bp-pathway/enroll", body: ["entry": entry]))
  }

  public func pathway() async throws -> Pathway {
    try decoder.decode(Pathway.self, from: await request("v1/bp-pathway"))
  }

  public func config() async throws -> Config {
    try decoder.decode(Config.self, from: await request("v1/health/config"))
  }

  private func request(_ path: String, body: (any Encodable)? = nil) async throws -> Data {
    var req = URLRequest(url: base.appending(path: path))
    req.setValue(member, forHTTPHeaderField: "x-member-id")
    if let body {
      req.httpMethod = "POST"
      req.setValue("application/json", forHTTPHeaderField: "content-type")
      req.httpBody = try encoder.encode(body)
    }
    let (data, response) = try await session.data(for: req)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(status) else { throw APIError(status: status) }
    return data
  }

  /// Milliseconds, like the server's `toISOString()`. Whole seconds would date a reading taken just
  /// after enrolling to before it, and the server would refuse it.
  private var encoder: JSONEncoder {
    let e = JSONEncoder()
    e.dateEncodingStrategy = .custom { date, encoder in
      var c = encoder.singleValueContainer()
      try c.encode(Date.ISO8601FormatStyle(includingFractionalSeconds: true).format(date))
    }
    return e
  }

  private var decoder: JSONDecoder {
    let d = JSONDecoder()
    d.dateDecodingStrategy = .custom { decoder in
      let text = try decoder.singleValueContainer().decode(String.self)
      return try Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(text)
    }
    return d
  }
}

/// The anchor is an opaque cursor, not health data, so UserDefaults is fine.
public struct DefaultsAnchorStore: AnchorStore {
  let key: String

  public init(key: String = "bp.anchor") {
    self.key = key
  }

  public func load() -> Data? { UserDefaults.standard.data(forKey: key) }
  public func save(_ anchor: Data) { UserDefaults.standard.set(anchor, forKey: key) }
}
