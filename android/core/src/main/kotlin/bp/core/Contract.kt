package bp.core

import java.time.Instant
import java.time.temporal.ChronoUnit
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder

// Field for field with server/src/types.ts and ios/Sources/BPCore/Contract.swift.

@Serializable
enum class Platform {
  @SerialName("healthkit") HEALTHKIT,
  @SerialName("healthconnect") HEALTHCONNECT,
}

@Serializable
data class Reading(
  /** Health Connect record id. The server's idempotency key; it survives reinstalls. */
  val id: String,
  val platform: Platform,
  /** Whole mmHg, as the cuff shows them. */
  val systolic: Int,
  val diastolic: Int,
  @Serializable(with = MillisInstant::class) val measuredAt: Instant,
  /** The member's offset from UTC at the reading, so AM/PM and days are theirs. */
  val tzOffsetMin: Int,
  val source: Source,
  val method: Method,
) {
  @Serializable
  data class Source(
    val appId: String,
    val appName: String,
    val deviceModel: String? = null,
    val manufacturer: String? = null,
  )

  @Serializable
  enum class Method {
    @SerialName("device") DEVICE,
    @SerialName("manual") MANUAL,
    @SerialName("unknown") UNKNOWN,
  }
}

@Serializable data class Tombstone(val id: String, val platform: Platform)

/** One page between two changes tokens. The server's 2xx is what lets the token move. */
@Serializable data class Changes(val readings: List<Reading>, val tombstones: List<Tombstone>)

@Serializable
enum class Entry {
  @SerialName("watch_event") WATCH_EVENT,
  @SerialName("history") HISTORY,
  @SerialName("clinician") CLINICIAN,
}

/** The slice of the clinical config the phone needs. */
@Serializable
data class Config(val version: String, val crisis: Crisis, val historyScan: HistoryScan) {
  @Serializable data class Crisis(val systolic: Int, val diastolic: Int)

  @Serializable
  data class HistoryScan(val lookbackDays: Int, val minDays: Int, val systolic: Int, val diastolic: Int)
}

/** What the member's screens render. The server derives it; the phone never computes the average. */
@Serializable
data class Pathway(
  val state: State,
  val entry: Entry? = null,
  /** The protocol's start. The phone sends nothing measured before it. */
  @Serializable(with = MillisInstant::class) val enrolledAt: Instant? = null,
  val summary: Summary,
) {
  @Serializable
  enum class State {
    @SerialName("none") NONE,
    @SerialName("collecting") COLLECTING,
    @SerialName("stalled") STALLED,
    @SerialName("ready") READY,
    @SerialName("reviewed") REVIEWED,
  }

  @Serializable
  data class Summary(
    val configVersion: String,
    val counted: Int,
    val required: Int,
    val average: Average? = null,
    val days: List<Day>,
    val excluded: List<Excluded>,
    val crisis: List<String>,
  )

  @Serializable data class Average(val systolic: Int, val diastolic: Int)

  @Serializable data class Day(val day: String, val am: Int, val pm: Int)

  @Serializable data class Excluded(val id: String, val reason: String)
}

/** Milliseconds, like the server's `toISOString()`. Nanoseconds would be more than JS can parse. */
object MillisInstant : KSerializer<Instant> {
  override val descriptor = PrimitiveSerialDescriptor("Instant", PrimitiveKind.STRING)

  override fun serialize(encoder: Encoder, value: Instant) =
    encoder.encodeString(value.truncatedTo(ChronoUnit.MILLIS).toString())

  override fun deserialize(decoder: Decoder): Instant = Instant.parse(decoder.decodeString())
}
