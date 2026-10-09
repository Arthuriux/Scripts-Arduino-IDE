package com.publicast.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar

/** Mismos casos que server/test/api.test.js: ambas implementaciones deben coincidir. */
class SchedulerTest {
    private fun at(y: Int, mo: Int, d: Int, h: Int, mi: Int = 0): Calendar =
        Calendar.getInstance().apply { clear(); set(y, mo - 1, d, h, mi) }

    private fun sch(
        playlistId: String = "A",
        days: List<Int> = emptyList(),
        start: String = "",
        end: String = "",
        startDate: String = "",
        endDate: String = "",
        priority: Int = 1,
    ) = Schedule(
        id = "id-$playlistId-$priority",
        content = if (playlistId.contains(':')) playlistId else "p:$playlistId",
        days = days,
        startTime = start,
        endTime = end,
        startDate = startDate,
        endDate = endDate,
        priority = priority,
    )

    @Test
    fun franjaDiurna() {
        // 2026-10-05 es lunes (día 1)
        assertTrue(Scheduler.isActive(sch(days = listOf(1), start = "08:00", end = "12:00"), at(2026, 10, 5, 9)))
        assertFalse(Scheduler.isActive(sch(days = listOf(2), start = "08:00", end = "12:00"), at(2026, 10, 5, 9)))
        assertFalse(Scheduler.isActive(sch(start = "08:00", end = "12:00"), at(2026, 10, 5, 12)))
    }

    @Test
    fun franjaNocturnaCruzaMedianoche() {
        val night = sch(days = listOf(1), start = "22:00", end = "06:00")
        assertTrue(Scheduler.isActive(night, at(2026, 10, 5, 23)))
        assertTrue(Scheduler.isActive(night, at(2026, 10, 6, 2)))
        assertFalse(Scheduler.isActive(night, at(2026, 10, 7, 2)))
    }

    @Test
    fun rangoDeFechas() {
        assertFalse(Scheduler.isActive(sch(startDate = "2026-10-06"), at(2026, 10, 5, 9)))
        assertTrue(Scheduler.isActive(sch(startDate = "2026-10-01", endDate = "2026-10-05"), at(2026, 10, 5, 23, 59)))
    }

    @Test
    fun prioridadEIntercalado() {
        val r = Scheduler.resolve(
            listOf(sch("A", priority = 1), sch("B", priority = 5), sch("C", priority = 5)),
            "D",
            at(2026, 10, 5, 9),
        )
        assertEquals(listOf("p:B", "p:C"), r)
        assertEquals(listOf("p:D"), Scheduler.resolve(emptyList(), "D", at(2026, 10, 5, 9)))
        assertEquals(listOf("l:L"), Scheduler.resolve(listOf(sch("l:L")), "p:D", at(2026, 10, 5, 9)))
        assertEquals(emptyList<String>(), Scheduler.resolve(emptyList(), null, at(2026, 10, 5, 9)))
    }

    @Test
    fun modosDeRepeticion() {
        val now = at(2026, 10, 5, 9)
        assertTrue(Scheduler.isActive(sch().copy(repeat = "always"), now))
        assertTrue(Scheduler.isActive(sch().copy(repeat = "custom", startAt = "2026-10-05T08:30", endAt = "2026-10-05T09:30"), now))
        assertFalse(Scheduler.isActive(sch().copy(repeat = "custom", startAt = "2026-10-05T09:01", endAt = "2026-10-06T00:00"), now))
        // "daily" ignora los días marcados; "weekly" los respeta
        assertTrue(Scheduler.isActive(sch(days = listOf(2), start = "08:00", end = "10:00").copy(repeat = "daily"), now))
        assertFalse(Scheduler.isActive(sch(days = listOf(2), start = "08:00", end = "10:00").copy(repeat = "weekly"), now))
    }

    @Test
    fun normalizaUrl() {
        assertEquals("http://192.168.1.10:8080", Prefs.normalizeUrl(" 192.168.1.10:8080/ "))
        assertEquals("https://cms.ejemplo.com", Prefs.normalizeUrl("https://cms.ejemplo.com"))
        assertEquals(listOf("http://192.168.100.50", "http://192.168.100.50:8080"), Prefs.candidateUrls("http://192.168.100.50"))
        assertEquals(listOf("http://192.168.100.50:9000"), Prefs.candidateUrls("http://192.168.100.50:9000"))
    }
}
