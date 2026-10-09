package com.publicast.player

import android.app.ActivityManager
import android.content.Context
import android.os.Build

/** Detecta equipos modestos (Fire TV Stick, TV Box económicos) para activar el modo ligero. */
object DeviceProfile {
    fun totalRamMb(context: Context): Long {
        val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val info = ActivityManager.MemoryInfo()
        am.getMemoryInfo(info)
        return info.totalMem / (1024 * 1024)
    }

    fun isFireTv(context: Context): Boolean =
        Build.MODEL.startsWith("AFT") || context.packageManager.hasSystemFeature("amazon.hardware.fire_tv")

    fun isLowEnd(context: Context): Boolean {
        val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        return am.isLowRamDevice || totalRamMb(context) < 2600 || isFireTv(context) || Runtime.getRuntime().availableProcessors() <= 2
    }

    /** "lite" / "high" vienen del panel; "auto" decide según el equipo. */
    fun liteMode(context: Context, setting: String?): Boolean = when (setting) {
        "lite" -> true
        "high" -> false
        else -> isLowEnd(context)
    }
}
