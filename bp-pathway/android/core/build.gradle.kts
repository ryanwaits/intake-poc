plugins {
  alias(libs.plugins.kotlin.jvm)
  alias(libs.plugins.kotlin.serialization)
}

kotlin { jvmToolchain(21) }

dependencies {
  api(libs.coroutines.core)
  api(libs.serialization.json)
  testImplementation(kotlin("test"))
  testImplementation(platform(libs.junit.bom))
  testImplementation(libs.junit.jupiter)
  testRuntimeOnly(libs.junit.launcher)
}

tasks.test {
  useJUnitPlatform()
  // Same goldens as the server and iOS.
  val goldens = rootDir.resolve("../goldens")
  inputs.dir(goldens)
  systemProperty("goldens", goldens.absolutePath)
  // Set by ../check.sh, which starts a fresh server: the contract test always runs against it.
  System.getenv("BP_SERVER_URL")?.let {
    environment("BP_SERVER_URL", it)
    outputs.upToDateWhen { false }
  }
  testLogging { events("passed", "failed", "skipped") }
}
