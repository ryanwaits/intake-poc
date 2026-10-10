# Member app, native: working notes

Ryan Waits, October 2026.

Notes on how I'd take Rezilient's member app from React Native to native iOS and Android. The app ships an update every week or two, and the goal is to make the move without slowing that down or disrupting anyone using it.

Big caveat up front: I don't have a member account, and I haven't seen the codebase, the data, or anything the team has already decided. So some of this is probably wrong, and some of it is probably already handled. I wrote it anyway because most of a move like this comes down to calls that are hard to undo, and it felt more useful to work through them than to talk about them in the abstract. Each call has a note on what would change my mind, and I'd expect most of them to move after one conversation with the team.

Some of it is more than notes. The intake service in this repo runs the AI patterns below, and the prototypes show what they could look like in the current app:

| To see | Open |
|---|---|
| The prototypes, in order | [`docs/prototypes/`](prototypes/) |
| The intake service and how it's run | [`docs/walkthrough.md`](walkthrough.md) |
| How the model was picked | [`eval/RESULTS.md`](../eval/RESULTS.md) |

## The short version

| Decision | My take |
|---|---|
| App shell | Go native with the rebrand, SwiftUI on iOS and Jetpack Compose on Android. The shell owns launch, navigation, sign-in, secure storage and deep links. Existing React Native screens keep running inside it until each one gets replaced. |
| What goes native first | Anything where the OS is the feature. Vitals and wearables first (HealthKit, Health Connect, Apple Watch, Bluetooth devices), then biometrics and secure storage, card capture, notifications, voice input and background work. |
| What stays shared | Screens that are mostly server-driven content and change a lot. Some of these may never move, and that's fine. |
| Release | Everything ships behind a flag, through a phased store rollout, with crash and ANR gates that pause it automatically. Over-the-air updates only for shared screens. |
| PHI | OAuth with PKCE in the system browser, tokens in Keychain / Keystore, biometrics to unlock a session (not to identify someone), and analytics that can only send fields someone reviewed. |
| AI | The model answers narrow questions, code makes the call. Anything clinical goes to a clinician, and every AI feature needs a plain fallback for when the model is slow or down. |
| First slice | Pre-visit intake, with vitals right behind it. Both lean on the platform, both are easy to measure, and both save the medic and the remote provider time on every visit. |

## What the App Store tells us

Everything here is from the [App Store listing](https://apps.apple.com/us/app/rezilient-health/id6752295347) and its screenshots as of October 9, 2026. Small window, but it's real, so I started here before guessing at anything.

| What the listing shows | Why it matters |
|---|---|
| v1.0.36, 25 releases since February, every note "Bug fixes and experience improvements." | They already ship often. The release work is more about safer and more visible than faster. |
| Tabs: Home, Appointments, Lab results, Profile. Home has Message us, Appointment summaries, Manage prescriptions, Vitals, Book care. | The screen list I worked from. |
| Appointment cards say "Intake form not filled" or "Intake form completed." | Members already know intake as a step, so a better one drops into a slot they recognize. |
| A Vitals tile, plus "Health & Fitness" in the privacy label. | Health data is already flowing through the app. Probably the strongest case for going native first. |
| A "Finish setup" banner asks for an insurance card and photo ID. | Card capture is already part of onboarding, and it's a good native camera flow. |
| Messages and Urgent care show "call 911" / "call 988" notices. | There's already a house style for safety language, and AI features should follow it. |
| iOS 15.1+, runs on Apple Silicon Macs, no accessibility features declared yet. | The minimum iOS version is a real SwiftUI decision. Raising it makes SwiftUI nicer to work with but could leave members behind, and I wouldn't pick a number without device data. Accessibility looks like an early win people would notice. |
| No ratings showing yet. | Review prompts and retention look like open ground. |

Everything else is an assumption. If any of these are off, the calls that depend on them change:

| Assumption | Where it's from | If it's wrong |
|---|---|---|
| The app is React Native today, and the rebuild ships with a new brand | Rezilient's public job listings | Migration order changes. The per-screen thinking still holds. |
| Wearables beyond Apple Health (Whoop, Oura, Garmin, etc.) are on the roadmap | Rezilient's public job listings mention third-party wearables APIs | Device work shrinks to HealthKit and Health Connect. |
| Backend is TypeScript on AWS, with FHIR and HL7 feeds from partner health systems | Rezilient's public job listings | Device data needs a different home. |
| Mobile is a small team, with product and design being hired now | Rezilient's public job listings | Sequencing, and how much stays shared. |

## Native or shared, screen by screen

The question per screen: is the platform the product here? I'd score each one with real data from the first month (crash and ANR rate per screen, usage, how often it changes, whether it touches PHI) against roughly these signals:

| Leans native | Leans shared |
|---|---|
| Deep OS APIs: HealthKit, Health Connect, Bluetooth LE, biometrics, background delivery, video calls | Mostly server-driven content that changes often |
| Tight performance budgets: launch, long scrolling histories, live video | Supposed to behave the same on both platforms |
| Holds or shows PHI in ways that need platform security features | Low crash rate and not many complaints today |
| Accessibility that depends on native controls (Dynamic Type, VoiceOver, TalkBack) | Rarely used, so a rewrite costs more than it gives back |

My guess at where each screen lands, before seeing any data:

| Screen | Call | Why |
|---|---|---|
| Launch, navigation, sign-in, session | Native, first | Owns the token and every deep link. Everything else depends on it. |
| Vitals, health data, wearables | Native | Native APIs with background delivery and per-type permissions. A bridge costs more than it saves. |
| Insurance card and ID capture | Native | Camera, document scanning, on-device text recognition (VisionKit, ML Kit). |
| Bluetooth devices (cuffs, scales, oximeters) | Native | Pairing, reconnection and background modes are platform-specific and easy to get subtly wrong. |
| Pre-visit intake and voice input | Native | On-device speech recognition, keyboard accessories, Apple Health prefill. |
| The visit (video with the provider) | Native | Audio sessions, picture in picture, call interruptions. Depends a lot on the video vendor's SDKs. |
| Booking and clinic finder | Shared for now | Server-driven, same on both platforms. Moves if it shows up in crash or speed data. |
| Messages | Decide with data | Push and attachments lean native, the thread view doesn't. |
| Lab results, appointment summaries, prescriptions | Shared for now | Mostly server-rendered records. Results could move later for charts and accessibility. |
| Settings, account, billing | Shared | Low risk, low change. Last to move, if ever. |

Each call would get a short decision record with the evidence and the number that would flip it, something like "move booking native if its crash rate is above the app median for two releases." That way when a call turns out wrong, a number catches it and nobody has to win an argument.

### "Why not keep React Native as the host?"

Honestly it's a real option. React Native stays in charge, native modules handle health data and devices, and most screens keep one codebase. It's cheaper for the first quarter, and with the New Architecture the JS-to-native boundary costs less than it used to.

I lean the other way because sign-in, navigation and the hardest integrations would live across that boundary for good, and those are exactly where native depth matters most. But if the first month's data says most of the app's value is in shared screens, keeping React Native as the host is probably the right call. It's the first thing I'd want to check with the team, and honestly I could see it going either way.

## Moving a live app

I've migrated React Native apps to Swift before. The version that works here keeps the app in the stores the whole time, with native screens replacing old ones a piece at a time. If it goes well, members notice the app getting better and never notice the move.

| When | What | Done when |
|---|---|---|
| Weeks 0 to 4 | Measure crash-free sessions, ANR, launch time and usage per screen. Ship the native shell hosting every existing React Native screen, so the first release changes nothing visible. Generate the new brand's design tokens for Swift, Kotlin and TypeScript from one source. | Shell at 100% of users, crash-free sessions no worse than before. |
| Months 2 to 3 | Sign-in and session go native. Existing tokens migrate into Keychain / Keystore on first launch so nobody gets signed out, and one router keeps every old deep link working. | Zero forced sign-outs, every old deep link still opens. |
| Months 3 to 5 | Intake, vitals and devices, each behind a flag and compared against the old screen on completion rate and time to finish. | Native screen matches or beats the old one at full rollout. |
| After that | The rest move only when the per-screen scores say so. Dropping React Native entirely would get its own decision record. | |

## Release engineering

What I'm after: small changes, shipped often, with the store rollout and flags doing the risk management instead of someone watching a dashboard on release day.

| Piece | How |
|---|---|
| Every PR | Unit tests (XCTest, JUnit), UI tests on the critical flows (Maestro across both platforms, XCUITest / Espresso where needed), lint, a size check, and a look at what any new SDK collects. |
| Signing and builds | Fastlane, with certs and keys held by CI, not on laptops. Every build traces back to a commit. |
| Store rollout | App Store phased release (seven days, 1% to 100%) and Play staged rollout, paused when a gate fails. |
| Gates | Crash-free sessions and ANR vs the last release, with Google Play's bad-behavior thresholds (1.09% user-perceived crash rate, 0.47% ANR) as hard limits. |
| Feature flags | Every new screen ships dark, rolls out by percentage, and has a server-side kill switch that works on old app versions too. |
| Weekly report | Crash-free users and sessions, ANR, launch p50/p90, adoption by version, anything that got paused. One page, same format every week. |

Over-the-air updates need a written policy, since they're the easiest way to ship something nobody reviewed:

- Fine for shared React Native screens: copy, layout and logic fixes, reviewed like any release.
- Never for sign-in, token handling, PHI storage, analytics schemas, or a new use of a native module.
- Signed, rolled out by percentage, revertible in minutes, and inside the App Store's rules for interpreted code.

The POC does the server-side version of this. Every alert is tied to an error budget ([`ops/slo`](../ops/slo)), and a deliberate model outage turned up a real timeout bug, written up in [`ops/postmortems`](../ops/postmortems).

## PHI on the device

| Area | Approach |
|---|---|
| Sign-in | OAuth 2.0 with PKCE in the system browser (`ASWebAuthenticationSession`, Custom Tabs), per RFC 8252. No passwords typed into app views. |
| Tokens | Keychain with `WhenUnlockedThisDeviceOnly`, Android Keystore-backed encryption. Short-lived access tokens, rotated refresh tokens. |
| Biometrics | Face ID / Touch ID / BiometricPrompt unlock the stored session after a timeout. They gate local access, identity still comes from the server. |
| Data at rest | Cache only what a screen needs, encrypted, cleared on sign-out. Keep PHI out of anything the OS backs up. |
| Screens | Cover sensitive screens in the app switcher, `FLAG_SECURE` where policy calls for it. |
| Notifications | Keep PHI out of push payloads and off the lock screen. "You have a new message," then fetch after unlock. One of the store screenshots shows message text on the lock screen. Might just be marketing art, but worth a written policy either way. |
| Analytics and crashes | Typed event schemas checked against a field allowlist at build time, scrubbed crash breadcrumbs, and every SDK either covered by a BAA or sent nothing about health. |

Analytics is the row I'd expect to go wrong first, because nothing breaks when it does. In the POC, logs can only carry allowlisted fields, the type checker enforces it, and a test fails if a patient's complaint or name ends up in a log line ([`src/api/log.ts`](../src/api/log.ts), [`test/api.test.ts`](../test/api.test.ts)). Same setup works for mobile analytics.

## Wearables, and health data clinicians can trust

I think this is the strongest reason to go native. The app already has a Vitals tile and collects health data, and Rezilient's public job listings mention HealthKit, Health Connect and third-party wearables by name. It's also work I've done: at Alpha School (Texas Sports Academy) I built a native iOS app in Swift for student athletes' health and diet tracking, connected to Whoop, Apple Watch, Fitbit and other wearables.

Device data gets to the member app two ways, and each needs different plumbing:

```
On the phone                                   Vendor clouds
─────────────                                  ─────────────
Apple Watch, cuffs, scales ─► HealthKit        Whoop, Oura, Garmin ─► vendor OAuth + webhooks
Samsung, Pixel, Fitbit ─────► Health Connect                          │
              │                                                       ▼
              ▼                                                 Rezilient backend
   native app reads with per-type permission,  ──────────────►  normalize, dedupe, provenance
   background delivery, uploads deltas                                │
                                                                      ▼
                                                     FHIR Observations next to clinic vitals
```

- **On-device first.** HealthKit and Health Connect already collect from the Apple Watch and most phones and Bluetooth devices, so one native integration per platform covers most members. Both are native-only APIs with background delivery, which is why this part can't live behind a bridge.
- **Vendor clouds for the rest.** Whoop, Oura and Garmin have their own APIs. Those are server integrations (OAuth, webhooks), so the app handles consent and the backend handles syncing. Worth pricing a third-party aggregator against building three of these ourselves. Building gives control, an aggregator gives speed, and cost, BAAs and lock-in decide it. I don't know Rezilient's constraints there yet.
- **Apple Watch app: later, maybe.** Watch data already lands in HealthKit. A watchOS app only makes sense for something like a check-in reminder on the wrist, and I'd wait until members ask.
- **Clinic-issued Bluetooth devices.** Cuffs and scales for remote monitoring pair natively, from a short list of validated models.

A blood pressure in the chart only helps if the provider knows where it came from and how old it is. So every reading that reaches a clinician carries its source, method and age:

```
BP 128/82  ·  Omron cuff via Apple Health  ·  measured 2 days ago
BP 141/90  ·  entered by member            ·  measured 3 weeks ago (stale)
```

- **Provenance.** Keep the source app and device (HealthKit's source and device, Health Connect's data origin), plus whether a value was measured or typed in (`HKMetadataKeyWasUserEntered`, Health Connect's recording method).
- **Units and time in code.** Normalize units and compute staleness on the server, in one tested function, not in each view.
- **Dedupe.** The same walk counted by a watch and a phone is one walk.
- **FHIR.** Readings become Observations with device and method, so they sit next to clinic vitals in the record the provider already reads.
- **Fewer permission prompts.** Ask for each data type when it's actually needed, with a plain reason, not all at once at sign-up.
- **Stay on the wellness side of the line.** Show and trend readings, don't diagnose from them. Anything that interprets a reading gets a regulatory review first (FDA general wellness vs software as a medical device).

The POC already does this on the clinic side. It reads FHIR R4 charts and keeps every date, age and staleness check in code, and the model never sees a date ([`src/core/chart.ts`](../src/core/chart.ts)).

## AI in members' hands

Safe patterns matter a lot here. These are the rules the POC runs on, adapted for a member app:

1. **The model answers narrow questions, code decides.** Specific, typed questions with a probability, like "did they mention chest pain?" Thresholds and actions live in tested code ([`src/core/plan.ts`](../src/core/plan.ts)).
2. **Clinical judgments go to clinicians.** The app never shows a member a triage verdict or a diagnosis. Red flags route to a provider.
3. **Every AI feature has a plain fallback.** If the model is slow or down, the member still finishes: the form asks every question and a person triages. The fallback gets tested like any other feature ([`src/core/breaker.ts`](../src/core/breaker.ts)).
4. **Models are pinned, changes are measured.** A model upgrade is a release. Evaluate it against a bar written down before the run, then shadow it on real traffic before it serves anyone ([`eval/PREREGISTRATION.md`](../eval/PREREGISTRATION.md), [`src/core/shadow.ts`](../src/core/shadow.ts)).
5. **PHI only goes to covered endpoints.** Health data goes to a model provider under a BAA, or it stays on the device. On-device models (Apple's Foundation Models, Gemini Nano) are getting interesting here. My default is still to keep anything clinical on a pinned, evaluated server model, but I'm open to that changing as they get better.

What the POC has to back these up: ten model setups compared on 224 cases with labels known by construction, and a model outage under synthetic traffic where no intake failed. The red-flag number is the one I'd be careful with. The winning model caught 7 of 8 emergency vignettes, and 8 cases is way too few to call anything safe. I'd want clinicians to help set that bar, with a lot more cases, before anyone leans on it.

On using AI to build the app itself: I built the POC with coding agents, and the rules that kept that manageable would carry over. Agents work inside the same gates as people (tests, lint, CI, review), the repo has its own rules for them ([`AGENTS.md`](../AGENTS.md)), anything touching sign-in, storage or analytics gets a human security review, and production data never goes into a tool without a BAA.

## First slice: intake and vitals

Members already see "Intake form not filled" on their upcoming appointments, so a better intake improves a step they already know instead of adding a new one. It leans on the platform (on-device dictation, Apple Health prefill), it's easy to measure (completion rate, time to finish, fields typed), and it saves the medic and the remote provider time on every visit.

On two synthetic patients, the POC turned a 29-field form into 6 questions to type, and a 27-field form into 14. How much it saves depends on how complete the chart already is.

The prototypes follow one visit through the app, styled after the current screens:

| Step | Prototype | What it shows |
|---|---|---|
| 1 | [Home](prototypes/home.html) | Upcoming visit says "Intake form not filled," next to the Vitals tile. |
| 2 | [Intake](prototypes/intake.html) | The member says what's going on in their own words, by voice or text, and an automated assistant asks for what's still missing, two items at a time. Apple Health offers a recent blood pressure to confirm. |
| 3 | [Vitals](prototypes/vitals.html) | Every reading shows where it came from and how old it is. "Connect a device" splits Apple Health on the phone from accounts like Whoop. |
| 4 | [Clinic view](prototypes/clinic.html) | What the provider sees: the prep card with home vitals and their sources, and every decision the assistant made with its probability and rule. This probably belongs in a clinician tool rather than the member app team's scope, but I sketched it because the intake only matters if the provider can trust what comes out. |

Intake runs on the same "did they already say this?" questions the model answers in the POC today, so it's still one model call with one set of rules.

I have an opinion on voice. I think speech-to-text is important to think through correctly and implement intelligently, because a lot of people can say what's wrong faster than they can type it into a form on a phone. The intake prototype is my stab at it. I'm still tinkering with how it should feel, and there's plenty I'm not sure about yet: medical words, accents and a noisy waiting room are all hard on speech recognition, on-device keeps audio private but server-side is usually more accurate, and I don't know how much members will actually want to edit the transcript.

## First 90 days

| By | What |
|---|---|
| Day 30 | Read the codebase and the crash, ANR and usage data, and fix everything in this doc that turns out wrong. Agree on the per-screen calls with product and design and write them down. Get the weekly release-health report going. |
| Day 60 | Native shell at 100% with no visible change. Release pipeline with signing in CI, rollout gates and kill switches. Analytics allowlist in place. |
| Day 90 | Native sign-in shipped with no forced sign-outs. First native screen (intake or vitals, whichever the data favors) rolling out behind a flag with an agreed success metric. Mobile engineering standards written down and actually used in review. |

## Disclosure

Everything about Rezilient's current app here comes from public info, and the rest is assumption. The POC runs on synthetic patients only, its model provider has no BAA, and it's never been in production.

The parts I'm least sure about are the per-screen calls and the timeline, since both depend on data I haven't seen. Those are the bits I'd most want to go through with the team, and I'd expect them to change.
