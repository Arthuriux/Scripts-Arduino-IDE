package com.publicast.player

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Inicia el reproductor automáticamente al encender el dispositivo. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action !in ACTIONS) return
        val launch = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        try {
            context.startActivity(launch)
        } catch (_: Exception) {
            // En Android 10+ el sistema puede bloquear el arranque desde segundo plano si
            // PubliCast no es la pantalla de inicio. Configúrelo como launcher (modo quiosco).
        }
    }

    companion object {
        private val ACTIONS = setOf(
            Intent.ACTION_BOOT_COMPLETED,
            "android.intent.action.QUICKBOOT_POWERON",
            Intent.ACTION_MY_PACKAGE_REPLACED,
        )
    }
}
