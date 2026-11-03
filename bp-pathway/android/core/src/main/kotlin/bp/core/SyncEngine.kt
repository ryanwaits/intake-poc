package bp.core

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Everything between two changes tokens in Health Connect. */
data class Page(val changes: Changes, val anchor: String, val more: Boolean)

fun interface ChangeSource {
  suspend fun page(after: String?): Page
}

fun interface ChangeSink {
  suspend fun send(changes: Changes)
}

interface AnchorStore {
  fun load(): String?

  fun save(anchor: String)
}

/**
 * Moves health-store changes to the server. The token advances only after the server accepts a
 * page, so Health Connect is the outbox: offline or failing, nothing is lost, and we keep no copy
 * of a reading on the phone. Resends are safe because the server is idempotent.
 */
class SyncEngine(
  private val source: ChangeSource,
  private val sink: ChangeSink,
  private val anchors: AnchorStore,
) {
  private val turn = Mutex()

  /**
   * One at a time. A worker wake during a foreground sync waits, then syncs again, so an older
   * token can never overwrite a newer one.
   */
  suspend fun run(): Int = turn.withLock { drain() }

  private suspend fun drain(): Int {
    var anchor = anchors.load()
    var sent = 0
    while (true) {
      val page = source.page(anchor)
      if (page.changes.readings.isNotEmpty() || page.changes.tombstones.isNotEmpty()) {
        sink.send(page.changes)
      }
      anchors.save(page.anchor)
      anchor = page.anchor
      sent += page.changes.readings.size
      if (!page.more) return sent
    }
  }
}
