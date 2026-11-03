#!/usr/bin/env bash
# Everything that can run on this Mac: server tests, typecheck, lint, Swift goldens + sync tests,
# Kotlin goldens + sync tests, both clients against the live server, and both apps build.
# Needs Xcode, xcodegen, JDK 21 and the Android SDK.
set -euo pipefail
cd "$(dirname "$0")"

echo "── server"
(cd server && bun test && bun run typecheck && bun run lint)

echo "── swift"
PORT=${PORT:-3199}
PORT=$PORT bun server/src/server.ts >/dev/null &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
for _ in $(seq 50); do curl -sf "http://localhost:$PORT/v1/health/config" >/dev/null && break; sleep 0.1; done

export BP_SERVER_URL="http://localhost:$PORT/"
swift test --package-path ios

echo "── ios app e2e"
# A new simulator each run: HealthKit keeps every seed, and a second week would double the readings.
(cd ios/App && xcodegen generate --quiet)
SIM=$(xcrun simctl create bp-pathway-e2e "iPhone 18 Pro")
trap 'kill $SERVER 2>/dev/null; xcrun simctl shutdown $SIM 2>/dev/null; xcrun simctl delete $SIM' EXIT
xcrun simctl boot "$SIM" && xcrun simctl bootstatus "$SIM" >/dev/null
# A new simulator's healthd ignores HealthKit calls for ~90s after boot, and those calls never return.
for _ in $(seq 60); do
  [[ $(xcrun simctl spawn "$SIM" log show --last 10m --style compact \
    --predicate 'process == "healthd" AND eventMessage CONTAINS "Daemon Ready Observers"') == *Ready* ]] && break
  sleep 5
done
TEST_RUNNER_BP_SERVER_URL=$BP_SERVER_URL xcodebuild test -project ios/App/BPPathway.xcodeproj -scheme BPPathway \
  -destination "id=$SIM" -derivedDataPath .build/xcode -quiet

echo "── kotlin"
(cd android && JAVA_HOME=${JAVA_HOME:-/opt/homebrew/opt/openjdk@21} ./gradlew :core:test :app:assembleDebug --console=plain | grep -E "PASSED|FAILED|SKIPPED|BUILD|^e: ")
