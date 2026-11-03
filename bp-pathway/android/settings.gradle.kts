pluginManagement {
  repositories {
    google()
    mavenCentral()
    gradlePluginPortal()
  }
}

dependencyResolutionManagement {
  repositories {
    google()
    mavenCentral()
  }
}

rootProject.name = "bp-pathway"

// The contract, rules, sync engine and API client: plain JVM, testable without an Android SDK.
include(":core")
// Health Connect, background sync and the member screen.
include(":app")
