plugins {
  alias(libs.plugins.android.application)
  alias(libs.plugins.kotlin.compose)
}

android {
  namespace = "dev.waits.bppathway"
  compileSdk = 37

  defaultConfig {
    applicationId = "dev.waits.bppathway"
    minSdk = 28
    targetSdk = 36
    versionCode = 1
    versionName = "0.1"
    // The host machine, as the emulator sees it.
    buildConfigField("String", "API", "\"http://10.0.2.2:3100/\"")
  }

  buildFeatures {
    compose = true
    buildConfig = true
  }
}

kotlin { jvmToolchain(21) }

dependencies {
  implementation(project(":core"))
  implementation(libs.health.connect)
  implementation(libs.coroutines.android)
  implementation(libs.work.runtime)
  implementation(libs.lifecycle.runtime)
  implementation(libs.activity.compose)
  implementation(platform(libs.compose.bom))
  implementation(libs.compose.ui)
  implementation(libs.compose.material3)
}
