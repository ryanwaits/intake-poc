package dev.waits.bppathway

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.BloodPressureRecord
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import bp.core.AnchorStore
import bp.core.ApiClient
import bp.core.SyncEngine
import java.time.Instant
import java.util.concurrent.TimeUnit

/** Spike identity. The real app gets the member from the signed-in session. */
const val MEMBER = "demo-member"

/**
 * One engine per process. Its lock is what keeps a worker wake and a foreground sync from racing,
 * and a lock only works if everyone shares it.
 */
object Sync {
  val api = ApiClient(BuildConfig.API, MEMBER)
  private var engine: Pair<Instant, SyncEngine>? = null

  @Synchronized
  fun engine(context: Context, since: Instant): SyncEngine {
    engine?.takeIf { it.first == since }?.let {
      return it.second
    }
    val source = HealthConnectSource(context, HealthConnectClient.getOrCreate(context), since)
    return SyncEngine(source, api, PrefsAnchors(context)).also { engine = since to it }
  }

  /** Every 15 minutes (WorkManager's floor) when Health Connect allows background reads. */
  suspend fun scheduleBackground(context: Context) {
    val client = HealthConnectClient.getOrCreate(context)
    val supported =
      client.features.getFeatureStatus(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_IN_BACKGROUND) ==
        HealthConnectFeatures.FEATURE_STATUS_AVAILABLE
    val granted =
      HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND in
        client.permissionController.getGrantedPermissions()
    if (!supported || !granted) return
    WorkManager.getInstance(context)
      .enqueueUniquePeriodicWork(
        "bp-sync",
        ExistingPeriodicWorkPolicy.KEEP,
        PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES).build(),
      )
  }

  val readPermissions =
    setOf(
      HealthPermission.getReadPermission(BloodPressureRecord::class),
      HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND,
    )
}

class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  override suspend fun doWork(): Result {
    val since = Sync.api.pathway().enrolledAt ?: return Result.success()
    return runCatching { Sync.engine(applicationContext, since).run() }
      // The token didn't move, so the next run picks up exactly where this one stopped.
      .fold({ Result.success() }, { Result.retry() })
  }
}

/** The changes token is an opaque cursor, not health data. */
class PrefsAnchors(context: Context) : AnchorStore {
  private val prefs = context.getSharedPreferences("bp-sync", Context.MODE_PRIVATE)

  override fun load(): String? = prefs.getString("token", null)

  override fun save(anchor: String) {
    prefs.edit().putString("token", anchor).apply()
  }
}
