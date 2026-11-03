package bp.core

import java.io.File
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** The same goldens the server and iOS run. If these fail, the phones and server disagree. */
class GoldenTest {
  private val json = Json { ignoreUnknownKeys = true }

  private inline fun <reified T> load(name: String): T =
    json.decodeFromString(File(System.getProperty("goldens"), name).readText())

  @Serializable private data class BP(val systolic: Int, val diastolic: Int)

  @Serializable
  private data class CrisisGolden(val config: Config.Crisis, val cases: List<Case>) {
    @Serializable data class Case(val name: String, val reading: BP, val expect: Boolean)
  }

  @Serializable
  private data class ScanGolden(val config: Config.HistoryScan, val now: String, val cases: List<Case>) {
    @Serializable
    data class Case(val name: String, val readings: List<Row>, val expect: Expect)

    @Serializable
    data class Row(val systolic: Int, val diastolic: Int, val measuredAt: String, val tzOffsetMin: Int)

    @Serializable data class Expect(val invite: Boolean, val days: Int)
  }

  @Test
  fun crisis() {
    val golden = load<CrisisGolden>("crisis.json")
    for (c in golden.cases) {
      assertEquals(c.expect, Rules.isCrisis(c.reading.systolic, c.reading.diastolic, golden.config), c.name)
    }
  }

  @Test
  fun historyScan() {
    val golden = load<ScanGolden>("history-scan.json")
    for (c in golden.cases) {
      val readings =
        c.readings.mapIndexed { i, row ->
          Reading(
            id = "$i",
            platform = Platform.HEALTHCONNECT,
            systolic = row.systolic,
            diastolic = row.diastolic,
            measuredAt = Instant.parse(row.measuredAt),
            tzOffsetMin = row.tzOffsetMin,
            source = Reading.Source(appId = "golden", appName = "Golden"),
            method = Reading.Method.DEVICE,
          )
        }
      val scan = Rules.historyScan(readings, Instant.parse(golden.now), golden.config)
      assertEquals(Rules.Scan(c.expect.invite, c.expect.days), scan, c.name)
    }
  }
}
