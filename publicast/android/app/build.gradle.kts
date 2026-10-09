plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.publicast.player"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.publicast.player"
        minSdk = 21          // Android 5.0+: cubre la mayoría de TV Box y tablets
        targetSdk = 35
        versionCode = 6
        versionName = "1.4.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Para publicar, configure su propia firma (signingConfigs). Para pruebas
            // se firma con la clave de depuración y así puede instalarse directamente.
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    testOptions {
        unitTests.isReturnDefaultValues = true // android.graphics.Color devuelve 0 en las pruebas JVM
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.media3:media3-exoplayer:1.4.1")
    implementation("androidx.media3:media3-ui:1.4.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    testImplementation("junit:junit:4.13.2")
    // org.json real (en las pruebas JVM el de Android es sólo un esqueleto)
    testImplementation("org.json:json:20240303")
}
