package bp.core

import java.time.Instant
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assumptions.assumeTrue

/**
 * Kotlin's JSON against the running TS server: enums, instants, nulls, and the token-on-ack rule
 * over a real socket. Runs only with BP_SERVER_URL set (see ../check.sh).
 */
class ContractTest {
  private val server = System.getenv("BP_SERVER_URL")

  private class OnePage(private val changes: Changes) : ChangeSource {
    override suspend fun page(after: String?) =
      Page(if (after == null) changes else Changes(emptyList(), emptyList()), "t1", more = false)
  }

  private class Memory : AnchorStore {
    var anchor: String? = null

    override fun load() = anchor

    override fun save(anchor: String) {
      this.anchor = anchor
    }
  }

  private fun reading(id: String, sys: Int, dia: Int, source: Reading.Source) =
    Reading(
      id = id,
      platform = Platform.HEALTHCONNECT,
      systolic = sys,
      diastolic = dia,
      measuredAt = Instant.now(),
      tzOffsetMin = -300,
      source = source,
      method = Reading.Method.DEVICE,
    )

  private val cuff = Reading.Source("com.example.cuffapp", "Cuff App", "HEM-7155T")
  private val ring = Reading.Source("com.example.ring", "Ring", "Ring 4")

  @Test
  fun kotlinClientSpeaksTheServersContract() = runBlocking {
    assumeTrue(server != null, "BP_SERVER_URL not set")
    val api = ApiClient(server!!, "contract-kt-${UUID.randomUUID()}")
    assertEquals(180, api.config().crisis.systolic)

    // Not enrolled: the server refuses, so the token must not move.
    val early = Memory()
    val refused = Changes(listOf(reading("k0", 128, 82, cuff)), emptyList())
    val error = assertFailsWith<ApiException> { SyncEngine(OnePage(refused), api, early).run() }
    assertEquals(409, error.status)
    assertNull(early.anchor)

    val enrolled = api.enroll(Entry.HISTORY)
    assertEquals(Pathway.State.COLLECTING, enrolled.state)
    assertEquals(Entry.HISTORY, enrolled.entry)
    assertTrue(enrolled.enrolledAt!! > Instant.now().minusSeconds(60))

    // Measured after opting in, as the source's time filter guarantees.
    val tokens = Memory()
    val page = Changes(listOf(reading("k1", 128, 82, cuff), reading("k2", 190, 100, ring)), emptyList())
    assertEquals(2, SyncEngine(OnePage(page), api, tokens).run())
    assertEquals("t1", tokens.anchor)

    val pathway = api.pathway()
    assertEquals(listOf("k2"), pathway.summary.crisis)
    assertTrue(pathway.summary.excluded.any { it.reason == "unverified_device" })
    assertNull(pathway.summary.average)
  }
}
