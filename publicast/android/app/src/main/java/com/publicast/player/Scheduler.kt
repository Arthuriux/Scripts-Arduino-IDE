package com.publicast.player

import java.util.Calendar
import java.util.Locale

/**
 * Resolución de la programación. Es una copia fiel de public/shared/schedule.js del servidor,
 * así la pantalla sigue respetando los horarios aunque pierda la conexión.
 */
object Scheduler {
    private val HHMM = Regex("^(\\d{1,2}):(\\d{2})$")

    fun toMinutes(value: String?, fallback: Int): Int {
        val m = HHMM.find(value?.trim() ?: return fallback) ?: return fallback
        return minOf(24 * 60, m.groupValues[1].toInt() * 60 + m.groupValues[2].toInt())
    }

    fun ymd(c: Calendar): String =
        String.format(Locale.US, "%04d-%02d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH))

    private fun dayMatches(s: Schedule, c: Calendar): Boolean {
        val dow = c.get(Calendar.DAY_OF_WEEK) - 1 // 0 = domingo, igual que JavaScript
        if (s.days.isNotEmpty() && !s.days.contains(dow)) return false
        val day = ymd(c)
        if (s.startDate.isNotEmpty() && day < s.startDate) return false
        if (s.endDate.isNotEmpty() && day > s.endDate) return false
        return true
    }

    fun isActive(s: Schedule, now: Calendar): Boolean {
        val t = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE)
        val start = toMinutes(s.startTime, 0)
        val end = toMinutes(s.endTime, 24 * 60)
        if (start < end) return dayMatches(s, now) && t >= start && t < end
        if (start == end) return dayMatches(s, now)
        val yesterday = now.clone() as Calendar
        yesterday.add(Calendar.DAY_OF_MONTH, -1)
        return (t >= start && dayMatches(s, now)) || (t < end && dayMatches(s, yesterday))
    }

    /** Devuelve los IDs de las listas que deben reproducirse ahora. */
    fun resolve(schedules: List<Schedule>, defaultPlaylistId: String?, now: Calendar = Calendar.getInstance()): List<String> {
        val active = schedules.filter { it.playlistId.isNotEmpty() && isActive(it, now) }
        if (active.isNotEmpty()) {
            val top = active.maxOf { it.priority }
            return active.filter { it.priority == top }.map { it.playlistId }.distinct()
        }
        return if (defaultPlaylistId != null) listOf(defaultPlaylistId) else emptyList()
    }
}
