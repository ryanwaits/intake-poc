package dev.waits.bppathway

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.changes.DeletionChange
import androidx.health.connect.client.changes.UpsertionChange
import androidx.health.connect.client.records.BloodPressureRecord
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.request.ChangesTokenRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import bp.core.ChangeSource
import bp.core.Changes
import bp.core.Page
import bp.core.Platform
import bp.core.Reading
import bp.core.Tombstone
import java.time.Instant
import java.time.ZoneId
import kotlin.math.roundToInt

/** The member app's only Health Connect reader. Reads, never writes (the debug seeder aside). */
class HealthConnectSource(
  private val context: Context,
  private val client: HealthConnectClient,
  /** Enrollment time. Nothing measured before the member opted in leaves the phone. */
  private val since: Instant,
) : ChangeSource {

  override suspend fun page(after: String?): Page {
    if (after == null) return firstPage()
    val response = client.getChanges(after)
    // Unused for 30 days. Re-read everything since enrollment; the server dedupes by record id.
    if (response.changesTokenExpired) return firstPage()
    val readings =
      response.changes
        .filterIsInstance<UpsertionChange>()
        .mapNotNull { (it.record as? BloodPressureRecord)?.let(::reading) }
        .filter { it.measuredAt >= since }
    // A deletion carries only the record id, which is why the server keys readings by it.
    val tombstones =
      response.changes.filterIsInstance<DeletionChange>().map { Tombstone(it.recordId, Platform.HEALTHCONNECT) }
    return Page(Changes(readings, tombstones), response.nextChangesToken, response.hasMore)
  }

  /**
   * Token first, then read: anything written in between shows up in both, and the server's
   * idempotency absorbs it. A protocol week is a few dozen readings, so one page is enough here.
   */
  private suspend fun firstPage(): Page {
    val token = client.getChangesToken(ChangesTokenRequest(setOf(BloodPressureRecord::class)))
    val records =
      client
        .readRecords(ReadRecordsRequest(BloodPressureRecord::class, TimeRangeFilter.after(since), pageSize = 1000))
        .records
    return Page(Changes(records.map(::reading), emptyList()), token, more = false)
  }

  /** Entry B input. Read on the phone, scanned on the phone, never uploaded. */
  suspend fun history(days: Long, now: Instant = Instant.now()): List<Reading> =
    client
      .readRecords(
        ReadRecordsRequest(BloodPressureRecord::class, TimeRangeFilter.between(now.minusSeconds(days * 86_400), now))
      )
      .records
      .map(::reading)

  fun reading(r: BloodPressureRecord): Reading {
    val origin = r.metadata.dataOrigin.packageName
    return Reading(
      id = r.metadata.id,
      platform = Platform.HEALTHCONNECT,
      systolic = r.systolic.inMillimetersOfMercury.roundToInt(),
      diastolic = r.diastolic.inMillimetersOfMercury.roundToInt(),
      measuredAt = r.time,
      // Health Connect keeps the writer's offset. Missing, fall back to the phone's zone now.
      tzOffsetMin = (r.zoneOffset ?: ZoneId.systemDefault().rules.getOffset(r.time)).totalSeconds / 60,
      source =
        Reading.Source(
          appId = origin,
          appName = label(origin),
          deviceModel = r.metadata.device?.model,
          manufacturer = r.metadata.device?.manufacturer,
        ),
      method =
        when (r.metadata.recordingMethod) {
          Metadata.RECORDING_METHOD_MANUAL_ENTRY -> Reading.Method.MANUAL
          Metadata.RECORDING_METHOD_ACTIVELY_RECORDED,
          Metadata.RECORDING_METHOD_AUTOMATICALLY_RECORDED -> Reading.Method.DEVICE
          else -> Reading.Method.UNKNOWN
        },
    )
  }

  private fun label(pkg: String) =
    runCatching {
        context.packageManager.getApplicationLabel(context.packageManager.getApplicationInfo(pkg, 0)).toString()
      }
      .getOrDefault(pkg)
}
