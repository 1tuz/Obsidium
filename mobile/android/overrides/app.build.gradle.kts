plugins {
    id("com.android.application")
}

val appVersion = providers.gradleProperty("appVersion").getOrElse("@VERSION@")
val appVersionCode = providers.gradleProperty("appVersionCode").map(String::toInt).getOrElse(@VERSION_CODE@)
val keystorePath = providers.environmentVariable("OBSIDIUM_ANDROID_KEYSTORE").orNull
val releaseRequested = gradle.startParameter.taskNames.any { it.contains("Release", ignoreCase = true) }

if (releaseRequested && keystorePath.isNullOrBlank()) {
    error("A release requires an independent Obsidium signing key; use assembleDebug for previews")
}

android {
    namespace = "com.dmitriy.aquilum"
    compileSdk = @COMPILE_SDK@
    buildToolsVersion = "@BUILD_TOOLS@"
    ndkVersion = "@NDK@"

    defaultConfig {
        applicationId = "@APPLICATION_ID@"
        minSdk = @MIN_SDK@
        targetSdk = @COMPILE_SDK@
        versionName = appVersion
        versionCode = appVersionCode
        resValue("string", "app_name", "Obsidium")
        ndk {
            abiFilters += "arm64-v8a"
        }
    }

    signingConfigs {
        if (!keystorePath.isNullOrBlank()) {
            create("obsidium") {
                storeFile = file(keystorePath)
                storePassword = providers.environmentVariable("OBSIDIUM_ANDROID_STORE_PASSWORD").get()
                keyAlias = providers.environmentVariable("OBSIDIUM_ANDROID_KEY_ALIAS").get()
                keyPassword = providers.environmentVariable("OBSIDIUM_ANDROID_KEY_PASSWORD").get()
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-preview"
            resValue("string", "app_name", "Obsidium Preview")
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("obsidium")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.core:core:1.16.0")
    implementation("androidx.games:games-activity:4.4.0")
}
