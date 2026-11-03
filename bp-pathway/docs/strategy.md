# BP pathway: implementation strategy

October 2026. A plan for the member app's mobile team, built from public information and the [spike](../). The short version, with screens and charts, is the [showcase](showcase.html). *(inference)* = my reasoning. *(guess)* = an estimate to replace with real numbers.

## 0. One paragraph

Members can enter a blood pressure pathway three ways: their Apple Watch flags possible hypertension, their phone already holds high cuff readings, or a clinician enrolls them. They take a week of morning and evening cuff readings. The readings reach the app through HealthKit or Health Connect, never a vendor API. The app reads on device, keeps provenance, and sends readings only after the member opts in. The server decides what counts and computes the guideline average in code, then hands the care team a short review. After review, the member gets a visit or a dose change by message and keeps a weekly check-in. One data type, one pipeline, two platforms. No model in the loop.

## 1. What it moves, and what must not break

| Metric | Funnel step | Measured |
|---|---|---|
| First visits started from a pathway invite (entries A, B) | registered → first visit | Server: visit booked within 30 days of `invited` |
| Protocol completion | care plan | Server: met the clinical minimum (e.g. 12 of 14 readings) |
| Readings received, not permissions granted | care plan | Server. HealthKit hides read denials, so "granted" can't be measured |
| Review to action | care plan | Server: hours from `ready` to `reviewed` |
| BP controlled at 90 / 180 days, pathway members | outcome | Clinical, the same definition behind Rezilient's 89% |
| Dose changes made by message, no visit | cost | Clinical *(inference: cheaper than a visit)* |

| Guardrail | Bar |
|---|---|
| Crisis readings | Safety screen shown on the device whenever the app reads a reading at or above the crisis threshold. Care-team task created on upload. Never an experiment arm |
| Employer visibility | Zero member-level pathway data. Aggregates only, small cells suppressed |
| PHI in third-party analytics | Zero pathway events. The funnel is computed server-side |
| Crash-free / ANR | No worse than the previous release |
| Battery | Background sync stays inside an energy budget, checked in Xcode Organizer and Play vitals |

## 2. Scope

| v1 builds | v1 doesn't build (and what flips it) |
|---|---|
| Native health-data module, iOS + Android, BP + Apple's hypertension notification | Other data types → a clinical owner and a protocol |
| Entries A, B, C | Vendor cloud APIs, aggregator → a needed type that exists only in a vendor cloud |
| Pathway screens: invite, consent, cuff, progress, done, weekly | Charts beyond one average-vs-target trend → clinicians ask |
| Reminders (local notifications, twice daily, 7 days) | A watchOS app → members ask for wrist check-ins |
| Readings API, rules in code, state machine, FHIR write | AI anything in this loop → never for thresholds |
| Data contract for the care-team review view | The care-team UI itself (clinical tools team) |
| Cuff allowlist + "ship me a cuff" request | Cuff fulfillment ops (partner team / vendor) |
| | Cellular cuffs → members who won't use the app, a separate server-side integration later |

## 3. System picture

```
 iPhone                                   Android
 ───────                                  ───────
 Cuff app (Omron/Withings…) ─► HealthKit   Cuff app ─► Health Connect
 Apple Watch hypertensionEvent ─┘                 │
          │                                       │
          ▼                                       ▼
 HealthModule (Swift)                     HealthModule (Kotlin)
  observer on systolic + anchored query    changes token per type + WorkManager
  on-device: crisis check, history scan    on-device: crisis check, history scan
  anchor advances only on server ack       token advances only on server ack
          │            ▲ config (thresholds, allowlist, version)
          └──────┬─────┘
                 ▼  POST /v1/health/changes (readings + tombstones, idempotent on platform id)
 ┌──────────────────── Rezilient backend (BAA) ────────────────────┐
 │ classify (cuff | manual | cuffless | duplicate) → protocol math │
 │ pathway state machine → FHIR Observations (+ Device)            │
 │ crisis → care-team task        ready → review item              │
 └───────────────┬──────────────────────────────┬──────────────────┘
                 ▼                              ▼
        care team review view          aggregate-only employer report
```

## 4. Decisions that are expensive to reverse

| # | Decision | Why | Gave up | Flips if |
|---|---|---|---|---|
| 1 | OS health stores only. No vendor APIs, no aggregator | Every target device writes to HealthKit/Health Connect. Fitbit's API shuts off Oct 30, 2026. No extra BAAs, OAuth flows or webhooks | Cloud-only data, history before the member installed (Android) | A needed type exists only in a vendor cloud, or an employer contract requires one |
| 2 | **The OS store is the outbox.** The anchor or changes token advances only after the server acks. No local database of readings | Nothing lost when offline, nothing to encrypt, nothing to clear at sign-out. Re-reads are safe because uploads are idempotent | Offline history screens (query HealthKit/HC directly for display instead) | A screen needs server-derived data offline |
| 3 | **Member-initiated sharing.** Triggers and history scans run on the device. Nothing goes up until the member opts in | One rule covers consent, the duty to act on unsolicited data, and clinician load | Proactive outreach to people who haven't opted in | Clinical leaders want outreach. Entry C is already that path, with consent given in a visit |
| 4 | **Only validated cuffs count clinically.** Allowlist by source app + device model. Manual and cuffless readings are shown, labeled, and kept out of the average | 2025 AHA/ACC: cuffless devices aren't for clinical BP. The FDA's 2026 wellness change will put more cuffless numbers in the stores | Some real manual readings | Clinical owner counts manual entries, or validated cuffless devices appear on validatebp.org |
| 5 | Rules in code, versioned config, no model | Same as the POC: code decides. Thresholds are auditable and testable | Nothing worth having | Never for thresholds. Maybe a narrow model later to draft the review note, with a human checking it |
| 6 | The data layer is native on both platforms whatever the UI is. RN reaches it through a TurboModule until the screens move | HealthKit observer queries must be registered in `didFinishLaunching`, before a JS runtime exists. Background wakes don't wait for RN | One more bridge during the migration | None for the data layer. Screens follow the migration plan |
| 7 | Server-authoritative pathway state | Two platforms, a care team and reinstalls all need one truth | The app shows cached state offline | — |
| 8 | Same rules in Swift, Kotlin and TS, checked by one shared set of golden vectors | On-device checks (crisis, history scan) must match the server's | Three implementations of a small function | The rules grow → push the scan to the server after opt-in |
| 9 | **A pathway starts only from a signal that names one condition and has a test that confirms it.** Apple's hypertension notification qualifies; an HRV dip doesn't (§6, "Why this signal") | A clinician can act on it, and the cuff week confirms or clears it. General "something's off" signals have no clinical next step | Entries from HRV, resting heart rate, temperature, readiness scores | A general signal gets a validated, condition-specific use and a clinical owner |

## 5. Mobile: the health-data module

### Contract (one shape across Swift, Kotlin and the server)

```ts
type Reading = {
  id: string                 // HK sample UUID / HC record id: idempotency key, survives reinstall
  platform: 'healthkit' | 'healthconnect'
  systolic: number           // mmHg. The OS converts units on read (HKUnit.millimeterOfMercury / Pressure.inMillimetersOfMercury)
  diastolic: number
  measuredAt: string         // UTC
  tzOffsetMin: number        // member's offset at reading time → AM/PM is computed server-side in code
  source: { appId: string; appName: string; deviceModel?: string; manufacturer?: string }
  method: 'device' | 'manual' | 'unknown'   // HKMetadataKeyWasUserEntered / HC Metadata.recordingMethod
}
type Tombstone = { id: string; platform: Reading['platform'] }   // HKDeletedObject / HC DeletionChange
```

The hypertension notification never leaves the phone as a sample. If the member acts on one, the app sends `{ entry: 'watch_event', date }`, nothing more.

### iOS (HealthKit)

| Concern | How |
|---|---|
| Permissions | Read `bloodPressureSystolic`, `bloodPressureDiastolic`, plus `hypertensionEvent` (iOS 26.2+): one sheet, two topics. You can't authorize a correlation type, only the quantity types inside it. Considered and cut: irregular rhythm and high/low heart rate notifications (no BP pathway, another reason to tap Don't Allow), `heartRate` for pulse (nothing uses it) |
| Background | `HKObserverQuery` on **systolic**, because correlation types don't support background delivery. Then an `HKAnchoredObjectQuery` on the `bloodPressure` correlation for adds + deletes. Needs the `healthkit.background-delivery` entitlement. Register in `didFinishLaunching` |
| The completion handler trap | Always call the observer's completion handler, even when the upload fails. Miss it 3 times and HealthKit stops waking the app. A failed upload just leaves the anchor where it was |
| Locked device | The store is encrypted while the phone is locked, so reads fail and the anchor holds. The app catches up on unlock or foreground with the same anchored query |
| Availability | Min iOS today is 15.1. `hypertensionEvent` needs 26.2: `if #available(iOS 26.2, *)`. Entry A simply doesn't exist below that |
| Provenance | `sourceRevision.source.bundleIdentifier`, `.productType`, `HKDevice` (model, manufacturer), `HKMetadataKeyWasUserEntered` |
| Apple's own BP Log | iOS 26's Health app has a 7-day "risk" log and a 4-week "monitor" log, with reminders. Its readings land in HealthKit and we read them like any other. We don't rebuild it, and our invite says so |
| History window (iOS 27) | The read sheet has a second step: "Past 30 Days and Future Data" or "All Recorded Data and Future Data". Only entry B's scan looks back, and it reads 30 days on both platforms, so either answer loses nothing. The protocol week, entry C (≤14 days back) and the crisis check use recent or future data. Considered and dismissed: clamping to `earliestAuthorizedSampleDate(for:)` with window-specific copy (no job once the scan is 30 days); a pre-prompt nudging "All Recorded Data" (asks for more than we use; flips if iOS 27 invites per connect drop vs iOS 26 *and* clinical wants a longer lookback) |
| Testing | Background delivery doesn't run on the Simulator. Device lab + `HKHealthStore.save` seeding |

### Android (Health Connect)

| Concern | How |
|---|---|
| Availability | Built into the platform on Android 14+. On 13 and lower it's a Play app: check `getSdkStatus`, prompt install |
| Permissions | `READ_BLOOD_PRESSURE` plus `READ_HEALTH_DATA_IN_BACKGROUND` (check the feature flag first). No `READ_HEALTH_DATA_HISTORY`: entry B reads 30 days, the default. Needs a permissions-rationale activity and the Play Console health-permissions declaration |
| Sync | One changes token per type. `getChanges` loop until `hasMore` is false. Skip our own `dataOrigin`. Foreground sync on resume, plus `WorkManager` in the background when permitted |
| Token expiry (30 days unused) | `changesTokenExpired` → full read since enrollment (one protocol week, bounded), new token, server dedupes by id. Spike: `HealthConnectSource.kt` |
| Deletions | `DeletionChange` carries only the id, so the server keys readings by platform id (decision 2 covers this) |
| Provenance | `metadata.dataOrigin.packageName`, `metadata.device` (type/model/manufacturer), `metadata.recordingMethod`. The BP record also has `bodyPosition` and `measurementLocation`, kept for the clinician |
| No watch trigger | Health Connect has no hypertension event. Entry A is iOS-only. Say it in the doc |

### On-device logic (small, mirrored, shared goldens)

| Check | When | Result |
|---|---|---|
| Crisis | Any new reading ≥ crisis threshold (config, e.g. 180/120) | Safety screen right away in the house style ("call 911 if…", else "message your care team now"). Event flagged on upload |
| History scan (entry B) | First connect, then weekly | e.g. readings ≥ 130/80 on ≥2 days in the last 30, any source (an invite, not a diagnosis), no active pathway, adult *(clinical sets the rule)* → invite card. Runs on device. Nothing uploads |
| Watch event (entry A) | `hypertensionEvent` observed | Invite card that leads with a $0 visit (§6, visit first). One generic local notification as an experiment arm ("Your Apple Watch sent a health notification. Rezilient can help, $0"). No condition named on the lock screen |

## 6. Member experience

```
invite ──► consent ──► OS permission ──► cuff ──► 7 days ──► done ──► weekly
 (A/B/C)    plain        HealthKit /      have one?   AM/PM dots   "care team    average vs
            language     Health Connect   which? or   provenance   reviews by    target,
                                          ship one    per reading  <SLA>"        next check
```

| Screen | Must say |
|---|---|
| Invite | Why now (watch flagged / your readings / your clinician), $0, about 2 minutes a day for a week. Asks "Do you have a cuff?": yes → start the week; no → a visit first (§6) |
| Consent | What we read: blood pressure and watch alerts, nothing else. Who sees it: your care team, once you share. **Never your employer.** Not watched live: "If your cuff shows 180/120 or higher, don't wait for us." How to stop |
| Cuff | Pick from validated models, or pick one up at a CloudClinic (that is the first visit), or "mail me one" (address confirm) |
| Progress | Each reading with its source: "128/82 · Omron via Apple Health · 7:02 AM". Manual and unverified readings labeled. Missing slots shown without nagging |
| Done | What happens next and when. Book or message straight from here |
| Weekly | One number vs target, trend, next check. Nothing else |

Accessibility: Dynamic Type / font scale, VoiceOver and TalkBack labels that read the numbers out, the trend chart summarized in text. Copy at a 6th-grade level. Spanish if the member base needs it *(ask)*.

### Lanes: one pipeline, different ways a reading gets in

Every lane ends as a reading in HealthKit / Health Connect (or a typed one) and goes through the same server rules. A new lane is a config or screen change, never a new pipeline.

| Lane | Who | Experience | What it takes |
|---|---|---|---|
| 1. Best case | iOS 26.2+, Watch Series 9+ / Ultra 2+, a cuff that writes to Apple Health | Notification → invite → a week of automatic syncs → review. No typing | Built (the watch reader needs a real Watch). Small group, likely to convert |
| 2a. No cuff | Watch-flagged (A), or invited from typed / band readings (B) | Visit first (below): a CloudClinic hands over a cuff with an office reading, or a telehealth visit mails one. The week starts at the first cuff reading | Cuff screen. The stall clock waits 7 days for a first reading (done in the spike) |
| 2b. A cuff that doesn't sync | Cheap cuffs with no app, which is common | Types readings in. Shown, not averaged, today | Clinical call: count typed readings from a declared allowlisted model. One rule |
| 2c. Cuffless wearable | Hilo, Happy Ring, Samsung, Whoop, Oura | Readings start the invite (any source counts). Cleared devices might count toward the week | Clinical call: an allowlist entry, no code. 2025 AHA/ACC still says cuffless isn't for clinical BP |
| 2d. Android, or iOS below 26.2 | No watch trigger | Entries B and C | Nothing |
| 2e. A shorter week | Everyone | Fewer days to drop out of | Clinical call: `protocol.days` and `minReadings` are config |
| 3. Out of reach | No watch, no cuff, no visit | CloudClinic screening events → entry C | Not a wearables problem. Say so |

Considered and dismissed: reading a photo of the cuff screen (a model in a clinical loop; typed entry plus a clinical call is simpler), a cuff for every member (cost with no care event).

### Getting a cuff, cheapest first

| Option | Lift | Verdict | Flips if |
|---|---|---|---|
| Member owns one (entry B) | None | Yes, built | — |
| CloudClinic hands one out or lends it. AMA and Target: BP publish loaner playbooks (agreement, cleaning, checklist) | Low: Rezilient's own paramedics are already on site | **Yes, first.** The pickup is the first visit | — |
| Mail one free, only to members who said yes | Medium: address screen + fulfillment vendor, $50–150 retail (AMA) | Not yet | Invites from members without a cuff are frequent enough to justify a vendor |
| Vendor home-monitoring kit (e.g. Omron VitalSight: cuff + hub shipped home, ordered by a provider) | High: contract, server-side ingestion, built around Medicare billing | Not yet | Members who won't use the app are a measurable share of no-shows |
| Member buys one (HSA/FSA) | Low for us | No | — (breaks "$0") |

### Watch notification: visit first

Apple's hypertension notification is a screen, not a measurement: "your pattern looks like high blood pressure, go confirm it." Many working-age members have no clinician to take it to; Rezilient is $0.

| | |
|---|---|
| What it is | FDA-cleared (Sept 2025). Reads how blood vessels respond to each heartbeat (optical sensor) over 30-day windows. Apple: "not intended to diagnose" |
| Who can get one | Adults 22+, not pregnant, **no hypertension diagnosis**. Every member who gets one is undiagnosed by definition |
| How often it fires wrongly | Rarely: specificity 92% |
| How much it misses | A lot: sensitivity 41%, higher for stage 2 |
| Apple's next step | A cuff for 7 days, then "discuss it with your healthcare professional" |

- **A notification is enough to offer a visit before any cuff.** The member likely has hypertension, is undiagnosed by definition, and false alarms are uncommon. *(inference: at working-age prevalence, roughly half to 7 in 10 flagged members have hypertension)*
- **The visit doesn't replace the week.** Diagnosis needs out-of-office readings. Visit first only reorders it: office reading + cuff in hand → week → review.
- **No notification never means normal.** It misses about 6 in 10. No copy ever says "your watch says you're fine".
- **The cuff question sets the order.** Has a cuff → start the week now, and the visit follows review. No cuff → visit first.
- Metric: this turns entry A's invite directly into "first visit started from an invite" (§1).

### Why this signal and not others (decision 9)

My own case: in late 2020 my Whoop showed HRV far below my normal while I felt fine and hadn't trained harder. Two or three days later I felt rough, and it was COVID. The band didn't say "you have COVID". It said "something is off". Apple's notification looks similar from the outside (indirect signals, no direct reading), but it is a different kind of signal:

| | Whoop HRV dip | Apple hypertension notification |
|---|---|---|
| Compared with | **Me**: my own recent normal | **Other people**: trained on 100,000+ people with known cuff readings |
| Asks | "Are you different from usual?" | "Does your pulse look like the pulse of people with high blood pressure?" |
| Window | Days | 30 days |
| Points to | Nothing specific: illness, stress, alcohol, sleep | One condition |
| Checked against the real thing | No, wellness | Yes: 2,000-person study against cuffs, FDA-cleared |
| Next step | Rest, see how you feel | Confirm with a cuff, see a clinician |

The first is a "something's off" light: real, and for the member to act on. The second is a screening test for one condition, so it can route to one clinical action. That is the line for starting a pathway. It is also why the read sheet asks for blood pressure and hypertension notifications only, and why readiness scores and HRV dashboards are a No.

In one line: we only start a pathway from a signal that names one condition and has a test that confirms it. The watch notices, the cuff measures, the care team treats.

Sources: [Apple 117296](https://support.apple.com/en-us/117296), [AAFP on the validation](https://www.aafp.org/pubs/afp/afp-community-blog/entry/smartwatch-screening-for-hypertension.html), [Target: BP loaner program](https://targetbp.org/patient-measured-bp/implementing/smbp-device-loaner-program/), [AMA SMBP](https://www.ama-assn.org/public-health/prevention-wellness/what-you-need-know-about-self-measured-blood-pressure-monitoring), [Omron VitalSight](https://omronhealthcare.com/wp-content/uploads/OMRON-VitalSight-Fact-Sheet.pdf), [Hilo FAQ](https://hilo.com/pages/faq), [Happy Ring clearance](https://medcitynews.com/2026/10/happy-healths-cuffless-bp-device-wins-fda-clearance/), [Series 12 has no BP sensor](https://www.macobserver.com/tips/round-ups/apple-watch-series-12-blood-pressure-hypertension-notifications/), [Apple Newsroom: how it works, training and validation](https://www.apple.com/in/newsroom/2025/12/hypertension-notifications-available-today-on-apple-watch/)

## 7. Backend contract (the mobile team owns the shape, backend owns the code)

| Endpoint | Purpose |
|---|---|
| `POST /v1/health/changes` | One page between two anchors: `{readings[], tombstones[]}`, ≤500 (413 above). Idempotent on `(platform, id)`. Per-reading `rejected[{id, reason}]` (malformed, implausible, future, before_enrollment) still 2xx; 409 if not enrolled. The app advances its anchor only on 2xx. One endpoint, because a HealthKit edit is a delete + add in the same page |
| `GET /v1/health/config` | Versioned thresholds, cuff allowlist, protocol parameters. Cached with a TTL. Kill switch per entry |
| `POST /v1/bp-pathway/enroll` | `{ entry, kind?, date? }`, member-initiated |
| `GET /v1/bp-pathway` | State (derived on read), `enrolledAt` (the phone's read floor), progress per day/slot, excluded with reasons, config version |
| `POST /v1/care/members/:id/enroll` | Entry C. Clinician starts the week, `{at?}` back-dated ≤14 days. The member's phone picks it up on next open |
| `POST /v1/care/members/:id/review`, `GET /v1/care/tasks` | Review closes the week. Crisis tasks, one per reading. Routed to the member's panel clinician, or for a first visit to one licensed in the member's state (care-team tooling owns the routing) |

Server steps, all in one tested module: **classify** (cuff / manual / cuffless / duplicate within 2 minutes from another source / outside the window) → **protocol math** (AM/PM in local time, discard rules, minimum count, average) → **state** → **FHIR** (Observation per reading: LOINC 85354-9 panel, 8480-6 / 8462-4 components, `vital-signs`, `device` → Device resource, source app in `meta.source`; the average as its own Observation with `derivedFrom`).

```
invited ─► consented ─► collecting ─► ready ─► reviewed ─► monitoring ─► closed
                           │ 72h quiet (7 days before the first reading)
                           ▼
                        stalled ─(one nudge)─► collecting | care-team task
```

What the care team sees: the average, count, date range, a provenance breakdown, excluded readings with reasons, any crisis flags. Never the raw stream.

### The care team's side (web app and chart)

Terms: the **care team** is everyone on Rezilient's clinical side (on-site paramedics, remote clinicians, coordinators). A **clinician** is the licensed physician, NP or PA who can diagnose and prescribe; a clinician reviews the week. **Paramedics** do the hands-on care and office readings at CloudClinics.

Paramedics and clinicians work in a web app, not the member app. The phone never talks to clinical systems: the pathway service is the one boundary, mobile owns its data contract, and the clinical tools team owns the screens.

```
phone ──changes──► pathway service ──summary, tasks──► clinician web app
                        │                                  │ review
                        └────── at review: FHIR Observations + Device ──► chart (EHR)
CloudClinic visit: paramedic's connected cuff ──► chart ──► prep card: office reading beside the home average
```

| Moment | Member sees | Who on the care team, and what |
|---|---|---|
| Invite / watch notification | The invite | Nothing: the member hasn't chosen to share |
| Opt in | "Your check starts with your next cuff reading." | Nothing to act on. The check's status shows in the web app *(proposal)* |
| Each reading | A dot fills in | Nothing |
| ≥ 180/120 | Safety screen | The on-call clinician, right away. Who's on call is clinical policy |
| Stalled (72h, 7 days before the first) | One nudge | Any care team member, if the nudge doesn't work. Doesn't need a clinician. Who is unknown (the case manager posting is referrals and prior auth) |
| Ready | "Review within 1 business day" | A clinician: the member's own if they've had a visit. Members from ways in A and B usually haven't, so most go to a clinician licensed in their state |
| Reviewed | "Reviewed by your care team" + next step by message | Counted readings + average written to the chart |
| Next CloudClinic visit | — | Prep card (the intake POC's): home average beside the office reading |

- **Moments, not streams.** A very high reading (on-call clinician), a stalled week after one nudge (anyone on the care team), a finished week (a clinician).
- **The chart gets what a clinician has seen.** FHIR writes happen at review (and a crisis reading with its task), not per upload. Unreviewed patient-generated data in the chart is the med-legal worry (43% of US physicians name it as the top barrier; AMA wearables study).
- **Provenance travels.** The member's label, the web app and the chart (Device + `meta.source`) say the same thing.
- **Office vs home.** The paramedic's office reading beside the home average surfaces white-coat and masked hypertension.

## 8. Privacy, security, compliance

- **PHI on device:** none stored by us beyond the anchor and the in-flight batch. The cache of server state is cleared at sign-out.
- **Notifications:** no condition, value or reading on the lock screen, ever.
- **Analytics:** pathway events never go to a third-party SDK. HHS's tracking-technology guidance treats authenticated app events tied to a health condition as PHI. The funnel is computed server-side from pathway state.
- **App Store 5.1.3 / Play health policy:** HealthKit data is used only for the member's care. No ads, no data mining, no iCloud storage. Declare every health permission with a reason. Store-review notes explain the entitlements.
- **FDA line:** the app doesn't diagnose or interpret. Apple's cleared feature screens. Thresholds are clinician-owned config that route to a clinician. Regulatory review of the invite copy, the crisis screen and the history-scan wording before launch.
- **Employer:** said on the consent screen, enforced by the reporting design (aggregates, cells under 11 suppressed).

## 9. Failure modes

| Failure | Behavior |
|---|---|
| Server down / offline | Anchor or token holds. Retry with backoff on the next wake or foreground. Nothing lost |
| Phone locked during a wake | Read fails, completion handler still called, catch up on unlock |
| Permission revoked / read denied (iOS can't tell) | No reading in 72h, or none at all 7 days after enrolling (a mailed cuff takes days) → stalled → one nudge to check Apple Health / Health Connect settings → care-team task |
| Duplicate (cuff app + manual entry, two phones) | Exact: idempotent on id. Near: same values within 2 minutes from different sources → keep the cuff reading |
| Member deletes or edits a reading | Tombstone → recompute. HealthKit edits arrive as delete + add |
| HC token expired | Full read since enrollment, server dedupes |
| Reinstall | Anchor lost → full re-read, idempotent |
| Timezone travel / DST | UTC + offset stored. AM/PM in local time at the reading, computed in code |
| Cuffless or unknown device | Shown, labeled "not used for your average", counted for the clinician |
| Crisis reading while the app is closed | Background delivery may be late. The consent and cuff screens set that expectation up front. Server task on upload |
| Config fetch fails | Last cached config. Missing cache → entries B/A hidden, entry C still works from server state |
| Health Connect missing (Android ≤13) | Install prompt. Pathway still possible at a CloudClinic |

## 10. Testing (e2e first, same order as the POC)

| Layer | What |
|---|---|
| E2E, nothing mocked | iOS: seed BP samples into HealthKit in a test host with `HKHealthStore.save`, drive the pathway UI, assert the server state and FHIR output. Android: seed through Health Connect from the instrumented test app (or Health Connect Toolbox). Deletions and edits included |
| Device lab | Background delivery (no Simulator support), locked-device wakes, a real Omron cuff on a rig writing through its own app |
| Integration at boundaries | App ↔ API contract checks from one OpenAPI schema. HealthKit/HC exports ↔ classifier. FHIR output ↔ the EHR's validator |
| Goldens | Real-shaped exports from each allowlisted cuff app on both platforms. **Shared threshold vectors** run in the Swift, Kotlin and TS suites, so the three implementations can't drift |
| Unit, only silent bugs | DST and offset math, AM/PM edges, the near-duplicate window |

AI-assisted development: agents write the Swift and Kotlin adapters against the contract and the shared goldens. Those are what make agent output checkable. Review goes to the boundaries, not the syntax.

## 11. Rollout

Order: build the end of the loop first. Data without a clinician acting on it does nothing (−1.0 vs −6.1 mmHg), so entry C proves the loop before A and B send it more people.

| Phase | Ships | Gate to next |
|---|---|---|
| 0, ~2 wks | Baselines and answers to §12. Instrument today's funnel. Pick the cuff and the clinical owner | Protocol signed off, review SLA agreed |
| 1 | Pipeline + entry C, both platforms, a few clinics, behind a flag | Completion and review-to-action meet targets. Crisis path drilled |
| 2 | Entry B (history scan), staggered by employer | First visits from B tracked against the staggered control |
| 3 | Entry A (iOS 26.2+), plus the generic device-event route if clinical agrees | Volume and conversion reported, descriptive only (too rare for an A/B) |

| Experiment arms (presentation only) | Never an arm |
|---|---|
| Invite wording, card vs card + local notification, connect at setup vs at first vitals screen, reminder times | Crisis threshold or crisis screen, history-scan rule, what counts clinically, the employer boundary |

Sizing *(guess, to replace with team reality)*: phase 1 ≈ 6–8 weeks with one iOS, one Android, one backend engineer and a part-time clinical lead. Phase 2 +3–4 weeks. Phase 3 +2 weeks iOS.

## 12. Open questions

The plan is built from public information, without member data. What it starts from:

| Known | Source | So |
|---|---|---|
| The app is React Native today, and moving to native. Where it stays cross-platform is still open. New Architecture (Fabric, TurboModules) is listed as preferred experience | Rezilient's job postings | Doesn't change the pathway: the data layer is native either way (decision 6). TurboModule if they're on the New Architecture, a legacy native module if not, same Swift/Kotlin underneath |
| Home has a Vitals tile. The privacy label lists Health data, used for app functionality | App Store screenshots and listing | Some health data reaches the app. The listing never mentions Apple Health or wearables, so it may be clinic-measured vitals |
| CloudClinics pair Rezilient's own on-site paramedics with Rezilient's own physicians, NPs and PAs, who join remotely. Health-system partners like WakeMed credential those clinicians ("independent of WakeMed") and supply the wider network | [Rezilient job postings](https://jobs.techstars.com/companies/rezilient-health/jobs/68585044-virtual-primary-care-physician-md-do), [WakeMed](https://wakemed.org/news/rezilient-wakemed-cloudclinic-opens-clayton) | Clinical rules belong to Rezilient's clinicians. A CloudClinic cuff hand-out is Rezilient's own workflow to change |
| Clinicians need licenses in 20+ states (40+ ideal; MO, CA, SC, GA required), build their own patient panels, and co-manage with internal specialty program teams. Malpractice and extra-state licensing are covered | [Physician posting](https://jobs.techstars.com/companies/rezilient-health/jobs/68585044-virtual-primary-care-physician-md-do) (closed, 6+ months old) | A finished week goes to the member's own clinician, or, for a first visit, to one licensed in the member's state. Ask whether a specialty team already runs BP care |
| Members' dependents aged 7+ are covered | rezilienthealth.com | Children are members, and their BP isn't read against 130/80 |

The unknowns to settle first, and what each answer changes:

| # | Question | Why it matters | If yes | If no |
|---|---|---|---|---|
| 1 | Does the Vitals tile read Apple Health or Health Connect today? Where do its numbers come from? | Extending an existing reader vs adding the app's first device data | Reuse its permission and screen. The pathway's native module replaces or wraps that reader, so the migration never runs two | The Vitals tile becomes the pathway's home (connect + the check card). The app's first health-data permission: new permission copy and App Store review notes |
| 2 | Do clinicians already ask members to log home BP? Is there a specialty program team for BP? Do CloudClinics hand out or lend cuffs? Which models? | Whether this is a new program or native ingestion for an existing one | The pathway is native ingestion for their program. The allowlist is their models. CloudClinic hand-out works on day one | Phase 0 picks a cuff and a clinical owner. Pilot a loaner program at a few CloudClinics |
| 3 | What share of members use iPhone vs Android? Of iPhones, how many are on iOS 26.2+ with an Apple Watch Series 9+? | Entry A is iOS-only and needs a recent watch. This sizes it and orders the platforms (not the RN migration) | iPhone- and watch-heavy: entry A can move earlier. Android can trail by a release | Android-heavy or few watches: B and C carry the volume. Android ships with iOS in phase 1. A stays a small iOS bonus |
| 4 | How many members are registered with no first visit? | Entries A and B only reach registered members | Many: A and B have an audience. Lead with "first visits from invites" | Few: activation isn't the lever. Lead with C and control (titration by message, BP controlled at 90/180 days) |
| 5 | Review capacity, target turnaround, who's on call for very high readings, and who follows up a stalled week? Does the clinician who reviews a new member's week take them on as a patient? | Invites only help if someone reviews within a business day | Capacity: stagger B across employers on schedule | Tight: C only first, stagger B slowly. The crisis policy is signed before launch either way |
| 6 | Analytics vendor, and is there a BAA? | Where funnel events can go | A BAA widens options for other app events | No change for the pathway: its events stay server-side either way, so the funnel is computed from pathway state |
| 7 | Which record do readings land in? Does a partner like WakeMed share it, or the protocols, at its sites? | Where the FHIR write goes, and who signs off the clinical calls | The partner joins protocol sign-off. The FHIR write targets the shared record | Rezilient's clinical lead signs off. The FHIR write targets Rezilient's record |
| 8 | What does the clinician web app sit on: an EHR (which one) or Rezilient's own backend? Can we write Observations to the chart? | How the pathway reaches the web app and the record | Web app reads the pathway service; FHIR Observations at review | The pathway service stays the source; the chart gets a signed summary note at review |

Clinical calls: decisions for Rezilient's doctors, not engineering. Engineering makes each one a config value and brings data. My default is what the spike does:

| Call | My default | Why | If they choose otherwise |
|---|---|---|---|
| Thresholds: invite at 130/80, crisis at 180/120 | As proposed | 2025 AHA/ACC stage 1 and severe ranges | Config only |
| Count typed readings? | No: shown, not averaged | Can't be verified | One rule: typed readings from a declared approved cuff count |
| Count FDA-cleared cuffless devices (Hilo, Happy Ring)? | No | 2025 AHA/ACC says cuffless isn't for clinical BP | One allowlist entry |
| Week length | 7 days, 12 readings | Guideline-style home protocol | `protocol.days`, `minReadings` |
| Discard the first day? | No | Fewer days to drop out of. Some protocols drop day 1 because first readings run high | `discardFirstDay: true` |
| Adults only? | Yes | Dependents 7+ are members, and children's BP is read against percentiles, not 130/80. Apple's notification is 22+ | A pediatric protocol is its own pathway |
| Pregnancy | Excluded: route to the care team | Different thresholds and urgency. Apple excludes it too | A pregnancy protocol is its own pathway |

## 13. What the spike changed or taught

Built and tested on Xcode 27.1 with the iOS 27.0 simulator and an Android 16 emulator (Health Connect built in). `bp-pathway/check.sh` runs it all. Not yet tested: background delivery, which needs a physical iPhone.

| Learning | Effect on the plan |
|---|---|
| One `POST /v1/health/changes` beats readings + tombstones endpoints | §7. An edit is delete + add; two endpoints would apply half an edit on a partial failure |
| Entry C needs `enrolledAt` on the pathway view | The phone reads only from it, and a background wake needs it before any network: saved locally at each refresh |
| Whole-second ISO dates put a just-taken reading before enrollment | Millisecond dates on the wire, both platforms |
| `Pathway.State.none` collides with `Optional.none` in Swift | Swift case `notStarted = "none"`; wire unchanged |
| One HealthKit observer per process | Re-registering on every foreground adds a wake per write. Guard it |
| `BloodPressureRecord` rejects future times in its constructor | Test seeding only; real cuff apps can't hit it |
| Compose BOM 2026.09 needs compileSdk 37 | Build config, no product effect |
| HC `changesTokenExpired` is a flag on the response, not an exception | Handled in the page loop |
| `URLSession.shared` caches API GETs on disk | Health data at rest and stale state on screen. The client uses an uncached, ephemeral session. §8 "PHI on device" depends on it |
| A fresh simulator's healthd ignores calls for ~90s after boot, and those calls never return | Test setup waits for healthd's ready line. App renders server state before any HealthKit read, so a slow store never blocks the screen |
| iOS 27 read sheet asks how far back (30 days or all) | Only entry B looks back. Scan cut to 30 days on both platforms, Android's history permission dropped, invite reads "in the last 30 days". The e2e answers "Past 30 Days" and still gets the invite. Longer lookback is a clinical call |
| HealthKit's sheet labels change by iOS version ("Turn On All" became "Select All N Topics") | UI tests match its accessibility identifiers (`UIA.Health.AuthSheet.AllCategoryButton`, `UIA.Health.Allow.Button`) |
| The read sheet listed 5 topics (BP + 4 watch notifications) | Cut to BP + hypertension (2 topics). AFib/HR notifications come back only if clinical makes them an entry |
| `pulse` was in the contract on all three platforms; nothing wrote it | Deleted. Comes back only with a clinical use |
| The stall timer started at enrollment, so a mailed cuff would stall in transit | `firstReadingWithinHours` (168) before the first reading, `stalledAfterHours` (72) after |
| Walking a member's week: "0 of 12" right after an invite that counted 7 high days reads as "we ignored your readings" | Zero-readings state says "Your check starts with your next cuff reading." True on every day (a mailed cuff can take days), prompts a reading, and matches the protocol math: the week starts at the first cuff reading |
| A HealthKit call that never returns would wedge the serial sync engine | Not seen on devices. Watch for it in the device lab before adding a timeout |
