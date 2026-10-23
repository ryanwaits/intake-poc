import BPCore
import SwiftUI

/// The same screen as android/app MainActivity.kt, card for card, in the intake POC's look
/// (docs/prototypes in the intake repo, styled after Rezilient's App Store screenshots).
struct ContentView: View {
  @State private var model = Model()
  @Environment(\.scenePhase) private var phase

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 14) {
        VStack(alignment: .leading, spacing: 4) {
          Text("Blood pressure check").font(.display(31))
          Text(stateLine).font(.sans(13.5)).foregroundStyle(.ink2)
        }

        if !model.available {
          Card { Text("Apple Health isn't available on this device. A CloudClinic can take your readings instead.") }
        }
        if let error = model.error {
          Card { Text("Couldn't reach Rezilient: \(error)").foregroundStyle(.coralInk) }
        }

        if let urgent {
          Card(fill: .coralSoft, border: .coral) {
            Text("\(urgent.systolic)/\(urgent.diastolic) is very high").font(.sans(15, .bold)).foregroundStyle(.coralInk)
            Text(
              "If you have chest pain, shortness of breath, weakness, or trouble speaking, call 911. "
                + "Otherwise, message your care team now. Don't wait for your check to finish.")
          }
        }

        if model.available && !model.connected {
          Card {
            Text("Connect Apple Health").font(.sans(15, .semibold))
            Text("We read blood pressure only. Your care team sees it once you start a check. Your employer never does.")
              .foregroundStyle(.ink2)
            Text("Readings aren't watched live.").foregroundStyle(.muted)
            Button("Connect") { Task { await model.connect() } }.buttonStyle(.pill).padding(.top, 6)
          }
        }

        if let scan = model.scan, let config = model.config, scan.invite, model.pathway?.state == .notStarted {
          // An offer of care, so it takes the POC's "Book care" card rather than a reading's.
          Card(fill: .roseCard, border: nil) {
            Text("A free blood pressure check").font(.sans(15, .bold))
            Text(
              "Your readings were above 130/80 on \(scan.days) days in the last \(config.historyScan.lookbackDays) days. "
                + "A week of morning and evening readings tells your care team what's really going on. "
                + "$0, about 2 minutes a day."
            )
            .foregroundStyle(.ink2)
            Button("Start my check") { Task { await model.enroll() } }.buttonStyle(.pill).padding(.top, 6)
          }
        }

        if let pathway = model.pathway, pathway.state != .notStarted {
          Progress(summary: pathway.summary)
        }

        if !model.readings.isEmpty {
          Text(model.pathway?.enrolledAt != nil ? "Your readings this check" : "Readings on this phone")
            .font(.sans(15, .semibold))
            .padding(.top, 4)
          ForEach(model.readings, id: \.id) { r in
            ReadingRow(reading: r, excluded: excluded[r.id], crisis: crisis.contains(r))
          }
        }

        HStack(spacing: 8) {
          Button(model.busy ? "Syncing…" : "Sync now") { Task { await model.refresh() } }.disabled(model.busy)
          #if DEBUG
            Button("Seed a week") { Task { await model.seed() } }
          #endif
        }
        .buttonStyle(.outlinePill)
      }
      .padding(.horizontal, 18)
      .padding(.vertical, 22)
    }
    .safeAreaInset(edge: .top, spacing: 0) { Bar() }
    .background(.surface)
    .font(.sans(14))
    .foregroundStyle(.ink)
    .onChange(of: phase, initial: true) { _, phase in
      if phase == .active { Task { await model.refresh() } }
    }
  }

  private var excluded: [String: String] {
    Dictionary(model.pathway?.summary.excluded.map { ($0.id, $0.reason) } ?? [], uniquingKeysWith: { a, _ in a })
  }

  private var crisis: [Reading] {
    guard let c = model.config?.crisis else { return [] }
    return model.readings.filter { Rules.isCrisis(systolic: $0.systolic, diastolic: $0.diastolic, c) }
  }

  /// The safety screen is for a reading just taken. Older ones stay marked in the list.
  private var urgent: Reading? {
    crisis.first { $0.measuredAt > .now.addingTimeInterval(-24 * 3600) }
  }

  private var stateLine: String {
    guard let p = model.pathway else { return "Loading" }
    return switch p.state {
    case .notStarted: "Not started"
    // Right after an invite that counted past readings, "0 of 12" reads as "we ignored them".
    case .collecting where p.summary.counted == 0: "Your check starts with your next cuff reading."
    case .collecting: "In progress: \(p.summary.counted) of \(p.summary.required) readings"
    case .stalled: "No new readings lately. Check that your cuff app saves to Apple Health."
    case .ready: "Done. Your care team will review it within 1 business day."
    case .reviewed: "Reviewed by your care team"
    }
  }
}

/// The POC's `.bar`: white, the wordmark, a hairline under it.
private struct Bar: View {
  var body: some View {
    Image("Logo").resizable().scaledToFit().frame(height: 24)
      .accessibilityLabel("Rezilient")
      .frame(maxWidth: .infinity, minHeight: 60)
      .background(.white)
      .overlay(alignment: .bottom) { Rectangle().fill(.line2).frame(height: 1) }
  }
}

private struct Progress: View {
  let summary: Pathway.Summary

  var body: some View {
    Card {
      if let average = summary.average {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
          Text("\(average.systolic)/\(average.diastolic)").font(.figure(40))
          Text("mmHg").font(.sans(13)).foregroundStyle(.ink2)
        }
        Text("Your average from \(summary.counted) cuff readings").foregroundStyle(.ink2)
      }
      HStack {
        ForEach(summary.days, id: \.day) { d in
          VStack(spacing: 6) {
            Text(d.day.suffix(2)).font(.sans(12)).foregroundStyle(.muted)
            Dot(on: d.am > 0)
            Dot(on: d.pm > 0)
          }
          .frame(maxWidth: .infinity)
          .accessibilityElement(children: .ignore)
          .accessibilityLabel("\(d.day): \(d.am) morning, \(d.pm) evening")
        }
      }
      .padding(.vertical, 4)
      Text("Morning and evening, 7 days").font(.sans(12)).foregroundStyle(.muted)
    }
  }
}

private struct Dot: View {
  let on: Bool

  var body: some View {
    Circle().fill(on ? Color.navy : .line).frame(width: 14, height: 14)
  }
}

/// The POC's vitals card: the number, then where it came from.
private struct ReadingRow: View {
  let reading: Reading
  let excluded: String?
  let crisis: Bool

  var body: some View {
    Card {
      HStack(alignment: .firstTextBaseline, spacing: 6) {
        Text("\(reading.systolic)/\(reading.diastolic)").font(.figure(24))
          .foregroundStyle(crisis ? Color.coralInk : .ink)
        Text("mmHg").font(.sans(13)).foregroundStyle(.ink2)
        Spacer()
        Text(reading.measuredAt, format: .dateTime.weekday(.abbreviated).hour().minute())
          .font(.sans(12.5)).foregroundStyle(.ink2)
      }
      Rectangle().fill(.line2).frame(height: 1).padding(.vertical, 4)
      HStack(spacing: 8) {
        switch reading.method {
        case .manual: Chip(label: "Entered by you", typed: true)
        case .device: Chip(label: "Measured")
        case .unknown: EmptyView()
        }
        if reading.method != .manual { Text(origin) }
      }
      .font(.sans(12.5)).foregroundStyle(.ink2)
      if let note {
        Text(note).font(.sans(12.5)).foregroundStyle(crisis ? Color.coralInk : .ink2)
      }
    }
  }

  /// The device when the sample names one, else the app that wrote it.
  private var origin: String {
    let device = [reading.source.manufacturer, reading.source.deviceModel].compactMap { $0 }.joined(separator: " ")
    return "\(device.isEmpty ? reading.source.appName : device) via Apple Health"
  }

  private var note: String? {
    switch (crisis, excluded.map(Self.reason)) {
    case (true, let reason?): "Very high · not in your average (\(reason))"
    case (true, nil): "Very high"
    case (false, let reason?): "Not in your average · \(reason)"
    case (false, nil): nil
    }
  }

  private static func reason(_ code: String) -> String {
    switch code {
    case "manual": "typed in"
    case "unverified_device": "not a validated cuff"
    case "duplicate": "duplicate"
    case "outside_window": "outside morning/evening"
    case "first_day": "first day"
    case "after_protocol": "after your week"
    default: code
    }
  }
}

/// The POC's `.src` provenance chip: tinted for measured, outlined for typed.
private struct Chip: View {
  let label: String
  var typed = false

  var body: some View {
    Text(label).font(.sans(12.5, .semibold))
      .foregroundStyle(typed ? Color.ink2 : .navy)
      .padding(.horizontal, 8)
      .padding(.vertical, 1)
      .background(typed ? Color.white : .blueCard, in: .rect(cornerRadius: 6))
      .overlay { if typed { RoundedRectangle(cornerRadius: 6).strokeBorder(.field) } }
  }
}

/// The POC's `.card`: white, a hairline border, 6pt corners.
private struct Card<Content: View>: View {
  var fill: Color = .white
  var border: Color? = .line
  @ViewBuilder let content: Content

  var body: some View {
    VStack(alignment: .leading, spacing: 6) { content }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(16)
      .background(fill, in: .rect(cornerRadius: 6))
      .overlay { if let border { RoundedRectangle(cornerRadius: 6).strokeBorder(border) } }
  }
}

/// The POC's `.pill-primary` and `.pill-outline`.
private struct Pill: ButtonStyle {
  var outline = false
  @Environment(\.isEnabled) private var enabled

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.sans(15, .semibold))
      .foregroundStyle(outline ? Color.navy : .white)
      .padding(.horizontal, 22)
      .frame(minHeight: 44)
      .background(outline ? Color.white : .navy, in: .capsule)
      .overlay { if outline { Capsule().strokeBorder(.navy, lineWidth: 1.5) } }
      .opacity(configuration.isPressed || !enabled ? 0.6 : 1)
  }
}

extension ButtonStyle where Self == Pill {
  fileprivate static var pill: Pill { Pill() }
  fileprivate static var outlinePill: Pill { Pill(outline: true) }
}

/// The POC's type: Poppins Light for titles, Poppins for figures, Open Sans for the rest. Each is
/// relative to a text style, so Dynamic Type still scales it.
extension Font {
  fileprivate static func display(_ size: CGFloat) -> Font {
    .custom("Poppins-Light", size: size, relativeTo: .largeTitle)
  }

  fileprivate static func figure(_ size: CGFloat) -> Font {
    .custom("Poppins-Regular", size: size, relativeTo: .title)
  }

  fileprivate static func sans(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
    let face =
      switch weight {
      case .bold: "OpenSans-Bold"
      case .semibold: "OpenSans-SemiBold"
      default: "OpenSans-Regular"
      }
    return .custom(face, size: size, relativeTo: .body)
  }
}

/// The POC's tokens (prototype.css :root), the ones this screen uses.
extension ShapeStyle where Self == Color {
  static var surface: Color { Color(hex: 0xF7F7F7) }
  static var ink: Color { Color(hex: 0x1F2328) }
  static var ink2: Color { Color(hex: 0x4A4F55) }
  static var muted: Color { Color(hex: 0x6A6F75) }
  static var line: Color { Color(hex: 0xDCDFE3) }
  static var line2: Color { Color(hex: 0xECEDF0) }
  static var field: Color { Color(hex: 0xC9CDD2) }
  static var navy: Color { Color(hex: 0x0D2240) }
  static var coral: Color { Color(hex: 0xF45B66) }
  /// Coral fails contrast as text on white; the POC uses this darker one for words.
  static var coralInk: Color { Color(hex: 0xA3212C) }
  static var coralSoft: Color { Color(hex: 0xFDF0F1) }
  static var roseCard: Color { Color(hex: 0xF6EFEF) }
  static var blueCard: Color { Color(hex: 0xEEF2F7) }
}

extension Color {
  fileprivate init(hex: UInt32) {
    self.init(
      red: Double(hex >> 16 & 0xFF) / 255, green: Double(hex >> 8 & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
  }
}
