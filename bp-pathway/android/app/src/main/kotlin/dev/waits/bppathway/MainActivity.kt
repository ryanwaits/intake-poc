package dev.waits.bppathway

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContract
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.lifecycle.lifecycleScope
import bp.core.Config
import bp.core.Entry
import bp.core.Pathway
import bp.core.Reading
import bp.core.Rules
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.launch

/** Everything the screen shows. The server owns state and the average; the phone owns reads. */
data class Ui(
  val available: Boolean = true,
  val granted: Set<String> = emptySet(),
  val config: Config? = null,
  val pathway: Pathway? = null,
  val readings: List<Reading> = emptyList(),
  val scan: Rules.Scan? = null,
  val busy: Boolean = false,
  val error: String? = null,
)

class MainActivity : ComponentActivity() {
  private var ui by mutableStateOf(Ui())
  private val client by lazy { HealthConnectClient.getOrCreate(this) }
  private lateinit var ask: androidx.activity.result.ActivityResultLauncher<Set<String>>

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val contract: ActivityResultContract<Set<String>, Set<String>> =
      PermissionController.createRequestPermissionResultContract()
    ask = registerForActivityResult(contract) { refresh() }
    // Dark status bar icons over the white bar.
    enableEdgeToEdge()
    setContent {
      MaterialTheme(colorScheme = lightColorScheme(primary = Navy), typography = Type) {
        Surface(color = Page, contentColor = Ink) { Screen(ui, ::connect, ::enroll, ::refresh, ::seed) }
      }
    }
  }

  override fun onResume() {
    super.onResume()
    refresh()
  }

  private fun connect() = ask.launch(Sync.readPermissions)

  private fun seed() {
    lifecycleScope.launch {
      if (Seed.writePermission !in ui.granted) return@launch ask.launch(Sync.readPermissions + Seed.writePermission)
      runCatching { Seed.week(client) }.onFailure { ui = ui.copy(error = it.message) }
      refresh()
    }
  }

  private fun enroll() {
    lifecycleScope.launch {
      runCatching { Sync.api.enroll(Entry.HISTORY) }.onFailure { ui = ui.copy(error = it.message) }
      refresh()
    }
  }

  /** Foreground sync on every resume, the same engine the worker uses. */
  private fun refresh() {
    lifecycleScope.launch {
      ui = ui.copy(busy = true, error = null)
      if (HealthConnectClient.getSdkStatus(this@MainActivity) != HealthConnectClient.SDK_AVAILABLE) {
        ui = Ui(available = false)
        return@launch
      }
      runCatching {
          val granted = client.permissionController.getGrantedPermissions()
          val config = Sync.api.config()
          var pathway = Sync.api.pathway()
          val source = HealthConnectSource(this@MainActivity, client, pathway.enrolledAt ?: Instant.EPOCH)
          val canRead = Sync.readPermissions.first() in granted
          val history = if (canRead) source.history(config.historyScan.lookbackDays.toLong()) else emptyList()
          val since = pathway.enrolledAt
          if (since != null && canRead) {
            Sync.engine(this@MainActivity, since).run()
            pathway = Sync.api.pathway()
            Sync.scheduleBackground(this@MainActivity)
          }
          Ui(
            granted = granted,
            config = config,
            pathway = pathway,
            readings = history.filter { since == null || it.measuredAt >= since }.sortedByDescending { it.measuredAt },
            scan = Rules.historyScan(history, Instant.now(), config.historyScan),
          )
        }
        .onSuccess { ui = it }
        .onFailure { ui = ui.copy(busy = false, error = it.message ?: it.javaClass.simpleName) }
    }
  }
}

// The intake POC's tokens (docs/prototypes/prototype.css in the intake repo), the ones this screen uses.
private val Page = Color(0xFFF7F7F7)
private val Ink = Color(0xFF1F2328)
private val Ink2 = Color(0xFF4A4F55)
private val Muted = Color(0xFF6A6F75)
private val Line = Color(0xFFDCDFE3)
private val Line2 = Color(0xFFECEDF0)
private val Field = Color(0xFFC9CDD2)
private val Navy = Color(0xFF0D2240)
private val Coral = Color(0xFFF45B66)
/** Coral fails contrast as text on white; the POC uses this darker one for words. */
private val CoralInk = Color(0xFFA3212C)
private val CoralSoft = Color(0xFFFDF0F1)
private val RoseCard = Color(0xFFF6EFEF)
private val BlueCard = Color(0xFFEEF2F7)

/** The POC's type: Poppins Light for titles, Poppins for figures, Open Sans for the rest. */
private val Poppins = FontFamily(Font(R.font.poppins_light, FontWeight.Light), Font(R.font.poppins_regular))
private val OpenSans =
  FontFamily(
    Font(R.font.open_sans_regular),
    Font(R.font.open_sans_semibold, FontWeight.SemiBold),
    Font(R.font.open_sans_bold, FontWeight.Bold),
  )
private val Type =
  Typography(
    bodyLarge = TextStyle(fontFamily = OpenSans, fontSize = 14.sp),
    labelLarge = TextStyle(fontFamily = OpenSans, fontWeight = FontWeight.SemiBold, fontSize = 15.sp),
  )

private val time = DateTimeFormatter.ofPattern("EEE h:mm a").withZone(ZoneId.systemDefault())

@Composable
private fun Screen(ui: Ui, connect: () -> Unit, enroll: () -> Unit, sync: () -> Unit, seed: () -> Unit) {
  val pathway = ui.pathway
  val excluded = pathway?.summary?.excluded?.associate { it.id to it.reason }.orEmpty()
  val crisis = ui.config?.let { c -> ui.readings.filter { Rules.isCrisis(it.systolic, it.diastolic, c.crisis) } }.orEmpty()
  // The safety screen is for a reading just taken. Older ones stay marked in the list.
  val urgent = crisis.firstOrNull { it.measuredAt > Instant.now().minusSeconds(24 * 3600) }

  Column(Modifier.fillMaxSize()) {
    Bar()
    LazyColumn(
      modifier = Modifier.weight(1f).navigationBarsPadding(),
      contentPadding = PaddingValues(horizontal = 18.dp, vertical = 22.dp),
      verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
      item {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
          Text("Blood pressure check", fontFamily = Poppins, fontWeight = FontWeight.Light, fontSize = 31.sp)
          Text(stateLine(pathway), fontSize = 13.5.sp, color = Ink2)
        }
      }

      if (!ui.available) item { Card { Text("Health Connect isn't available on this phone. A CloudClinic can take your readings instead.") } }
      ui.error?.let { item { Card { Text("Couldn't reach Rezilient: $it", color = CoralInk) } } }

      if (urgent != null) {
        item {
          Card(fill = CoralSoft, border = Coral) {
            Text("${urgent.systolic}/${urgent.diastolic} is very high", color = CoralInk, fontWeight = FontWeight.Bold, fontSize = 15.sp)
            Text(
              "If you have chest pain, shortness of breath, weakness, or trouble speaking, call 911. " +
                "Otherwise, message your care team now. Don't wait for your check to finish."
            )
          }
        }
      }

      if (ui.available && Sync.readPermissions.first() !in ui.granted) {
        item {
          Card {
            Text("Connect Health Connect", fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
            Text("We read blood pressure only. Your care team sees it once you start a check. Your employer never does.", color = Ink2)
            Text("Readings aren't watched live.", color = Muted)
            Pill("Connect", connect)
          }
        }
      }

      if (pathway?.state == Pathway.State.NONE && ui.scan?.invite == true && ui.config != null) {
        item {
          // An offer of care, so it takes the POC's "Book care" card rather than a reading's.
          Card(fill = RoseCard, border = null) {
            Text("A free blood pressure check", fontWeight = FontWeight.Bold, fontSize = 15.sp)
            Text(
              "Your readings were above 130/80 on ${ui.scan.days} days in the last ${ui.config.historyScan.lookbackDays} days. A week of morning and evening readings tells your care team what's really going on. $0, about 2 minutes a day.",
              color = Ink2,
            )
            Pill("Start my check", enroll)
          }
        }
      }

      if (pathway != null && pathway.state != Pathway.State.NONE) {
        item { Progress(pathway) }
      }

      if (ui.readings.isNotEmpty()) {
        item {
          Text(
            if (pathway?.enrolledAt != null) "Your readings this check" else "Readings on this phone",
            fontWeight = FontWeight.SemiBold,
            fontSize = 15.sp,
            modifier = Modifier.padding(top = 4.dp),
          )
        }
        items(ui.readings, key = { it.id }) { r -> ReadingRow(r, excluded[r.id], crisis.contains(r)) }
      }

      item {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          Pill(if (ui.busy) "Syncing…" else "Sync now", sync, outline = true, enabled = !ui.busy)
          if (BuildConfig.DEBUG) Pill("Seed a week", seed, outline = true)
        }
      }
    }
  }
}

/** The POC's `.bar`: white, the wordmark, a hairline under it. */
@Composable
private fun Bar() {
  Box(Modifier.fillMaxWidth().background(Color.White).statusBarsPadding().height(60.dp), Alignment.Center) {
    Image(painterResource(R.drawable.rezilient_logo), contentDescription = "Rezilient", modifier = Modifier.height(24.dp))
  }
  HorizontalDivider(color = Line2)
}

private fun stateLine(p: Pathway?) =
  when (p?.state) {
    null -> "Loading"
    Pathway.State.NONE -> "Not started"
    // Right after an invite that counted past readings, "0 of 12" reads as "we ignored them".
    Pathway.State.COLLECTING ->
      if (p.summary.counted == 0) "Your check starts with your next cuff reading."
      else "In progress: ${p.summary.counted} of ${p.summary.required} readings"
    Pathway.State.STALLED -> "No new readings lately. Check that your cuff app is connected to Health Connect."
    Pathway.State.READY -> "Done. Your care team will review it within 1 business day."
    Pathway.State.REVIEWED -> "Reviewed by your care team"
  }

@Composable
private fun Progress(p: Pathway) {
  Card {
    p.summary.average?.let {
      Row {
        Text("${it.systolic}/${it.diastolic}", fontFamily = Poppins, fontSize = 40.sp, modifier = Modifier.alignByBaseline())
        Text("mmHg", fontSize = 13.sp, color = Ink2, modifier = Modifier.alignByBaseline().padding(start = 6.dp))
      }
      Text("Your average from ${p.summary.counted} cuff readings", color = Ink2)
      Spacer(Modifier.size(8.dp))
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
      p.summary.days.forEach { d ->
        Column(
          horizontalAlignment = Alignment.CenterHorizontally,
          modifier = Modifier.semantics { contentDescription = "${d.day}: ${d.am} morning, ${d.pm} evening" },
        ) {
          Text(d.day.takeLast(2), fontSize = 12.sp, color = Muted)
          Dot(d.am > 0)
          Dot(d.pm > 0)
        }
      }
    }
    Text("Morning and evening, 7 days", fontSize = 12.sp, color = Muted)
  }
}

@Composable
private fun Dot(on: Boolean) =
  Box(Modifier.padding(3.dp).size(14.dp).background(if (on) Navy else Line, CircleShape))

/** The POC's vitals card: the number, then where it came from. */
@Composable
private fun ReadingRow(r: Reading, excluded: String?, crisis: Boolean) {
  val note =
    when {
      crisis && excluded != null -> "Very high · not in your average (${reason(excluded)})"
      crisis -> "Very high"
      excluded != null -> "Not in your average · ${reason(excluded)}"
      else -> null
    }
  Card {
    Row {
      Text(
        "${r.systolic}/${r.diastolic}",
        fontFamily = Poppins,
        fontSize = 24.sp,
        color = if (crisis) CoralInk else Ink,
        modifier = Modifier.alignByBaseline(),
      )
      Text("mmHg", fontSize = 13.sp, color = Ink2, modifier = Modifier.alignByBaseline().padding(start = 6.dp))
      Spacer(Modifier.weight(1f))
      Text(time.format(r.measuredAt), fontSize = 12.5.sp, color = Ink2, modifier = Modifier.alignByBaseline())
    }
    HorizontalDivider(color = Line2, modifier = Modifier.padding(vertical = 4.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
      when (r.method) {
        Reading.Method.MANUAL -> Chip("Entered by you", typed = true)
        Reading.Method.DEVICE -> Chip("Measured")
        Reading.Method.UNKNOWN -> {}
      }
      if (r.method != Reading.Method.MANUAL) Text(origin(r), fontSize = 12.5.sp, color = Ink2)
    }
    note?.let { Text(it, fontSize = 12.5.sp, color = if (crisis) CoralInk else Ink2) }
  }
}

/** The device when the record names one, else the app that wrote it. */
private fun origin(r: Reading) =
  listOfNotNull(r.source.manufacturer, r.source.deviceModel).joinToString(" ").ifEmpty { r.source.appName } +
    " via Health Connect"

private fun reason(code: String) =
  when (code) {
    "manual" -> "typed in"
    "unverified_device" -> "not a validated cuff"
    "duplicate" -> "duplicate"
    "outside_window" -> "outside morning/evening"
    "first_day" -> "first day"
    "after_protocol" -> "after your week"
    else -> code
  }

/** The POC's `.src` provenance chip: tinted for measured, outlined for typed. */
@Composable
private fun Chip(label: String, typed: Boolean = false) {
  val shape = RoundedCornerShape(6.dp)
  Text(
    label,
    fontSize = 12.5.sp,
    fontWeight = FontWeight.SemiBold,
    color = if (typed) Ink2 else Navy,
    modifier =
      Modifier.background(if (typed) Color.White else BlueCard, shape)
        .then(if (typed) Modifier.border(1.dp, Field, shape) else Modifier)
        .padding(horizontal = 8.dp, vertical = 1.dp),
  )
}

/** The POC's `.card`: white, a hairline border, 6dp corners. */
@Composable
private fun Card(fill: Color = Color.White, border: Color? = Line, content: @Composable ColumnScope.() -> Unit) {
  val shape = RoundedCornerShape(6.dp)
  Column(
    Modifier.fillMaxWidth()
      .background(fill, shape)
      .then(if (border != null) Modifier.border(1.dp, border, shape) else Modifier)
      .padding(16.dp),
    verticalArrangement = Arrangement.spacedBy(6.dp),
    content = content,
  )
}

/** The POC's `.pill-primary` and `.pill-outline`. */
@Composable
private fun Pill(text: String, onClick: () -> Unit, outline: Boolean = false, enabled: Boolean = true) {
  val modifier = Modifier.heightIn(min = 44.dp)
  val padding = PaddingValues(horizontal = 22.dp)
  if (outline) {
    OutlinedButton(
      onClick,
      modifier,
      enabled,
      colors = ButtonDefaults.outlinedButtonColors(containerColor = Color.White, contentColor = Navy),
      border = BorderStroke(1.5.dp, Navy),
      contentPadding = padding,
    ) {
      Text(text)
    }
  } else {
    Button(onClick, modifier, enabled, colors = ButtonDefaults.buttonColors(containerColor = Navy), contentPadding = padding) {
      Text(text)
    }
  }
}
