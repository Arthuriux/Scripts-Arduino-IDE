package com.publicast.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Lee un manifiesto real generado por el servidor (src/test/resources/manifest.json). */
class ManifestTest {
    private val raw = javaClass.classLoader!!.getResource("manifest.json")!!.readText()

    @Test
    fun leeLayoutVideowallYCintillo() {
        val m = Manifest.parse(raw)
        assertEquals("TV", m.displayName)
        assertEquals(1, m.displayNumber)
        assertTrue(m.serverTimeMs > 1_700_000_000_000L)

        val wall = m.wall!!
        assertEquals(3, wall.cols)
        assertEquals(2, wall.rows)
        assertEquals(1, wall.row)
        assertEquals(2, wall.col)

        assertTrue(m.defaultContent!!.startsWith("l:"))
        val layout = m.layouts.getValue(m.defaultContent!!.substring(2))
        assertEquals(3, layout.regions.size)
        val main = layout.regions.first { it.type == "playlist" }
        assertEquals(75f, main.w)
        assertNotNull(m.playlists[main.playlistId])
        val ticker = layout.regions.first { it.type == "ticker" }.ticker!!
        assertEquals("Cinta", ticker.text)
        val clock = layout.regions.first { it.type == "clock" }.clock!!
        assertTrue(clock.format12)
        assertTrue(clock.seconds)

        val p = m.playlists.getValue(main.playlistId!!)
        assertEquals("condensed", p.ticker.font)
        assertEquals(5.5f, p.ticker.size)
        assertEquals(40, p.ticker.opacity)
        assertEquals("top", p.ticker.position)
        assertEquals(7, p.items[0].duration)
        assertNull(p.items[0].file)

        assertTrue(m.schedules[0].content.startsWith("p:"))
        assertEquals(listOf(6), m.schedules[0].days)
    }
}
