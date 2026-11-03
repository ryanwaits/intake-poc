package dev.waits.bppathway

import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.BloodPressureRecord
import androidx.health.connect.client.records.metadata.Device
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.units.Pressure
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

/**
 * Debug only: a synthetic week in Health Connect, as a cuff app would write it. Every record's
 * origin is this app, so the device model carries the cuff's identity (config/pathway.json allows
 * this app id with model HEM-7155T). Nothing here runs in a release build.
 */
object Seed {
  val writePermission = HealthPermission.getWritePermission(BloodPressureRecord::class)

  private val cuff = Device(type = Device.TYPE_UNKNOWN, manufacturer = "Omron", model = "HEM-7155T")
  private val ring = Device(type = Device.TYPE_RING, manufacturer = "Example", model = "Ring 4")

  suspend fun week(client: HealthConnectClient, zone: ZoneId = ZoneId.systemDefault()) {
    val today = LocalDate.now(zone)
    val records =
      (6 downTo 0).flatMap { daysAgo ->
        val day = today.minusDays(daysAgo.toLong())
        val i = 6 - daysAgo
        listOfNotNull(
          bp(day, LocalTime.of(7, 30), 138 + i % 3, 88, cuff, zone),
          bp(day, LocalTime.of(20, 30), 134 + i % 4, 85, cuff, zone),
        )
      } +
        listOfNotNull(
          // A typed copy of day one's first reading. Same origin as the cuff records here, so the
          // server sees a manual entry rather than a cross-app duplicate; either way it isn't counted.
          bp(today.minusDays(6), LocalTime.of(7, 31), 138, 88, null, zone),
          // A ring's estimate, high enough to be a crisis: excluded from the average, still flagged.
          bp(today.minusDays(4), LocalTime.of(9, 0), 186, 112, ring, zone),
        )
    client.insertRecords(records)
  }

  /** Null for a time later today: Health Connect refuses records from the future. */
  private fun bp(day: LocalDate, time: LocalTime, sys: Int, dia: Int, device: Device?, zone: ZoneId): BloodPressureRecord? {
    val at = day.atTime(time).atZone(zone)
    if (at.toInstant().isAfter(Instant.now())) return null
    return BloodPressureRecord(
      time = at.toInstant(),
      zoneOffset = at.offset,
      systolic = Pressure.millimetersOfMercury(sys.toDouble()),
      diastolic = Pressure.millimetersOfMercury(dia.toDouble()),
      metadata = device?.let { Metadata.activelyRecorded(it) } ?: Metadata.manualEntry(),
    )
  }
}
