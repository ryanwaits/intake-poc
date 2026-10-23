package bp.core

import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset

/**
 * The two rules that run on the phone. Same logic as Swift (and, for [isCrisis], the server), held
 * to goldens/crisis.json and goldens/history-scan.json in every suite.
 */
object Rules {
  /** Any source counts. Safety never filters by provenance. */
  fun isCrisis(systolic: Int, diastolic: Int, c: Config.Crisis) =
    systolic >= c.systolic || diastolic >= c.diastolic

  /** [days]: distinct local days with an elevated reading inside the lookback. */
  data class Scan(val invite: Boolean, val days: Int)

  /**
   * Entry B. Runs on the phone over readings already in Health Connect; nothing uploads. It's an
   * invitation, not a diagnosis, so typed and unverified readings count too.
   */
  fun historyScan(readings: List<Reading>, now: Instant, c: Config.HistoryScan): Scan {
    val cutoff = now.minus(Duration.ofDays(c.lookbackDays.toLong()))
    val days =
      readings
        .filter { it.measuredAt >= cutoff && (it.systolic >= c.systolic || it.diastolic >= c.diastolic) }
        .map(::localDay)
        .toSet()
    return Scan(invite = days.size >= c.minDays, days = days.size)
  }

  /** The member's calendar day, from UTC plus the offset the phone recorded. */
  fun localDay(r: Reading): String =
    r.measuredAt.atOffset(ZoneOffset.ofTotalSeconds(r.tzOffsetMin * 60)).toLocalDate().toString()
}
