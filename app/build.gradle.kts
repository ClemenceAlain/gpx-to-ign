import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

// A release keystore is optional: drop one at release.keystore and set the three
// KEYSTORE_* properties, otherwise the build falls back to the debug key. See README.
val releaseKeystore = rootProject.file("release.keystore")

android {
    namespace = "io.gpxtoign.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "io.gpxtoign.app"
        minSdk = 26
        targetSdk = 35
        versionCode = (findProperty("appVersionCode") as String?)?.toInt() ?: 1
        versionName = (findProperty("appVersionName") as String?) ?: "0.1.0"
    }

    signingConfigs {
        if (releaseKeystore.exists()) {
            create("release") {
                storeFile = releaseKeystore
                storePassword = System.getenv("KEYSTORE_PASSWORD")
                keyAlias = System.getenv("KEY_ALIAS")
                keyPassword = System.getenv("KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName(
                if (releaseKeystore.exists()) "release" else "debug",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
    }

    testOptions {
        unitTests {
            isIncludeAndroidResources = true
        }
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

java {
    // The system JVM is a JRE without javac, so ask Gradle to provision a real JDK 17.
    toolchain { languageVersion.set(JavaLanguageVersion.of(17)) }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(project(":core"))
    implementation(libs.kotlinx.coroutines.core)

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.work.runtime.ktx)
    implementation(libs.androidx.datastore.preferences)

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.graphics)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)

    // Screenshot rendering on the JVM: this project has no attached device and no KVM,
    // so Robolectric draws the real Compose tree and Roborazzi writes it to PNG.
    testImplementation(libs.junit4)
    testImplementation(libs.robolectric)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    testImplementation(libs.roborazzi.junit.rule)
    testImplementation(libs.compose.ui.test.junit4)
    debugImplementation(libs.compose.ui.test.manifest)
}

tasks.withType<Test>().configureEach {
    // Roborazzi reads these from the test JVM, not from Gradle's own properties.
    systemProperty("robolectric.graphicsMode", "NATIVE")
    systemProperty("roborazzi.test.record", "true")
    systemProperty("roborazzi.output.dir", layout.buildDirectory.dir("screenshots").get().asFile.path)
}
