package bp.core

import java.io.IOException
import java.time.Instant
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking

/**
 * Silent-bug tests only, mirroring the iOS ones: a sync that loses data or moves the token
 * backwards raises no error and no flow would notice. Health Connect itself runs end to end on an
 * emulator; here the store is a list of pages and the server is a list of what arrived.
 */
class SyncEngineTest {
  private class Pages(private val pages: List<Page>) : ChangeSource {
    val now = AtomicInteger()
    val most = AtomicInteger()

    override suspend fun page(after: String?): Page {
      most.accumulateAndGet(now.incrementAndGet(), ::maxOf)
      delay(5)
      now.decrementAndGet()
      val next = after?.toInt()?.plus(1) ?: 0
      return pages[minOf(next, pages.size - 1)]
    }
  }

  private class Server(var failOnCall: Int? = null) : ChangeSink {
    val received = mutableListOf<Changes>()

    override suspend fun send(changes: Changes) {
      if (failOnCall == received.size) throw IOException("offline")
      received += changes
    }
  }

  private class Anchors : AnchorStore {
    val saved = mutableListOf<String>()

    override fun load() = synchronized(saved) { saved.lastOrNull() }

    override fun save(anchor: String) = synchronized(saved) { saved += anchor }
  }

  private fun reading(id: String) =
    Reading(
      id = id,
      platform = Platform.HEALTHCONNECT,
      systolic = 130,
      diastolic = 82,
      measuredAt = Instant.now(),
      tzOffsetMin = -300,
      source = Reading.Source("com.example.cuffapp", "Cuff App", "HEM-7155T"),
      method = Reading.Method.DEVICE,
    )

  /** Page n carries r{n}a, r{n}b and moves the token to "n". */
  private fun pages(n: Int) =
    (0 until n).map { i ->
      Page(Changes(listOf(reading("r${i}a"), reading("r${i}b")), emptyList()), "$i", more = i < n - 1)
    }

  @Test
  fun tokenMovesOnlyAfterTheServerAccepts() = runBlocking {
    val server = Server(failOnCall = 1)
    val anchors = Anchors()
    val engine = SyncEngine(Pages(pages(3)), server, anchors)

    assertFailsWith<IOException> { engine.run() }
    assertEquals(listOf("0"), anchors.saved, "page 1 failed, so the token stays on page 0")

    server.failOnCall = null
    assertEquals(4, engine.run(), "resumes at page 1: nothing lost, nothing resent from page 0")
    assertEquals(
      listOf("r0a", "r0b", "r1a", "r1b", "r2a", "r2b"),
      server.received.flatMap { it.readings }.map { it.id },
    )
  }

  @Test
  fun concurrentWakesTakeTurns() = runBlocking {
    val source = Pages(pages(4))
    val anchors = Anchors()
    val engine = SyncEngine(source, Server(), anchors)

    (1..3).map { async { engine.run() } }.awaitAll()

    assertEquals(1, source.most.get(), "two syncs read the store at once")
    val saved = anchors.saved.map { it.toInt() }
    assertEquals(saved.sorted(), saved, "an older token overwrote a newer one")
    assertEquals(3, saved.last())
  }
}
