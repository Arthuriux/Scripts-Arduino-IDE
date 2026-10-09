package com.publicast.player

import android.content.Context
import java.security.SecureRandom

/** Configuración persistente del reproductor. */
class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("publicast", Context.MODE_PRIVATE)

    var serverUrl: String
        get() = sp.getString("server", "") ?: ""
        set(v) = sp.edit().putString("server", v).apply()

    /** Clave secreta única de esta pantalla. El servidor sólo guarda su hash. */
    val displayKey: String
        get() {
            var key = sp.getString("key", null)
            if (key.isNullOrEmpty()) {
                val bytes = ByteArray(32)
                SecureRandom().nextBytes(bytes)
                key = bytes.joinToString("") { "%02x".format(it) }
                sp.edit().putString("key", key).apply()
            }
            return key
        }

    var manifestJson: String?
        get() = sp.getString("manifest", null)
        set(v) = sp.edit().putString("manifest", v).apply()

    fun resetPairing() {
        sp.edit().remove("key").remove("manifest").apply()
    }

    companion object {
        /** Normaliza lo que escribe el usuario: añade http:// y quita la barra final. */
        fun normalizeUrl(input: String): String {
            var s = input.trim()
            if (s.isEmpty()) return s
            if (!s.startsWith("http://", true) && !s.startsWith("https://", true)) s = "http://$s"
            return s.trimEnd('/')
        }
    }
}
