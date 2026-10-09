package com.publicast.player

import android.graphics.Color
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/** Estructuras del manifiesto que entrega el servidor en /api/player/manifest. */
data class TextStyle(
    val title: String,
    val body: String,
    val bg: Int,
    val color: Int,
    val accent: Int,
    val align: String,
)

data class Item(
    val id: String,
    val mediaId: String,
    val name: String,
    val type: String, // image | video | web | text | html
    val duration: Int,
    val naturalDuration: Int,
    val file: String?,
    val url: String?,
    val size: Long,
    val text: TextStyle?,
    val playlistId: String = "",
    val playlistName: String = "",
    /** Transición de entrada propia ("" = la de la lista). */
    val transition: String = "",
)

/** Cintillo: tamaño en % del alto de la pantalla, opacidad del fondo 0-100. */
data class TickerStyle(
    val enabled: Boolean,
    val text: String,
    val speed: Int,
    val bg: Int,
    val color: Int,
    val font: String,
    val size: Float,
    val opacity: Int,
    val position: String,
    val bold: Boolean,
)

data class ClockStyle(
    val format12: Boolean,
    val seconds: Boolean,
    val date: Boolean,
    val font: String,
    val size: Float,
    val color: Int,
    val bg: Int,
    val opacity: Int,
    val align: String,
)

data class Playlist(
    val id: String,
    val name: String,
    val transition: String,
    val transitionMs: Long,
    val fit: String,
    val background: Int,
    val ticker: TickerStyle,
    val items: List<Item>,
)

/** Zona de un layout, con posición y tamaño en % del lienzo. */
data class Region(
    val id: String,
    val type: String, // playlist | ticker | clock
    val x: Float,
    val y: Float,
    val w: Float,
    val h: Float,
    val z: Int,
    val playlistId: String?,
    val ticker: TickerStyle?,
    val clock: ClockStyle?,
)

data class LayoutDef(val id: String, val name: String, val background: Int, val regions: List<Region>)

data class WallInfo(val name: String, val rows: Int, val cols: Int, val row: Int, val col: Int)

data class Schedule(
    val id: String,
    val content: String, // 'p:<id>' lista · 'l:<id>' layout
    /** always | daily | weekly | custom ("" = versión anterior: días + horas + fechas) */
    val repeat: String = "",
    val startAt: String = "",
    val endAt: String = "",
    val days: List<Int>,
    val startTime: String,
    val endTime: String,
    val startDate: String,
    val endDate: String,
    val priority: Int,
)

data class FileRef(val file: String, val url: String, val size: Long, val md5: String)

data class Manifest(
    val version: Long,
    val serverTimeMs: Long,
    val displayId: String,
    val displayName: String,
    val displayNumber: Int,
    val orientation: String,
    val performance: String,
    val defaultContent: String?,
    val wall: WallInfo?,
    val schedules: List<Schedule>,
    val playlists: Map<String, Playlist>,
    val layouts: Map<String, LayoutDef>,
    val files: List<FileRef>,
    val heartbeatSeconds: Int,
) {
    companion object {
        fun parse(raw: String): Manifest {
            val o = JSONObject(raw)
            val display = o.optJSONObject("display") ?: JSONObject()
            val playlists = LinkedHashMap<String, Playlist>()
            val pl = o.optJSONObject("playlists") ?: JSONObject()
            pl.keys().forEach { key -> playlists[key] = parsePlaylist(pl.getJSONObject(key)) }
            val layouts = LinkedHashMap<String, LayoutDef>()
            val ll = o.optJSONObject("layouts") ?: JSONObject()
            ll.keys().forEach { key -> layouts[key] = parseLayout(ll.getJSONObject(key)) }
            val schedules = ArrayList<Schedule>()
            val sa = o.optJSONArray("schedules")
            if (sa != null) for (i in 0 until sa.length()) {
                val s = sa.getJSONObject(i)
                val days = ArrayList<Int>()
                val da = s.optJSONArray("days")
                if (da != null) for (j in 0 until da.length()) days.add(da.optInt(j))
                val content = s.optString("content").ifEmpty { s.str("playlistId")?.let { "p:$it" } ?: "" }
                schedules.add(
                    Schedule(
                        id = s.optString("id"),
                        content = content,
                        repeat = s.optString("repeat"),
                        startAt = s.optString("startAt"),
                        endAt = s.optString("endAt"),
                        days = days,
                        startTime = s.optString("startTime"),
                        endTime = s.optString("endTime"),
                        startDate = s.optString("startDate"),
                        endDate = s.optString("endDate"),
                        priority = s.optInt("priority", 0),
                    )
                )
            }
            val files = ArrayList<FileRef>()
            val fa = o.optJSONArray("files")
            if (fa != null) for (i in 0 until fa.length()) {
                val f = fa.getJSONObject(i)
                files.add(FileRef(f.getString("file"), f.getString("url"), f.optLong("size"), f.optString("md5")))
            }
            val w = o.optJSONObject("wall")
            return Manifest(
                version = o.optLong("version"),
                serverTimeMs = parseIso(o.optString("serverTime")),
                displayId = display.optString("id"),
                displayName = display.optString("name", "PubliCast"),
                displayNumber = display.optInt("number", 0),
                orientation = display.optString("orientation", "auto"),
                performance = display.optString("performance", "auto"),
                defaultContent = o.str("defaultContent") ?: o.str("defaultPlaylistId")?.let { "p:$it" },
                wall = w?.let { WallInfo(it.optString("name"), it.optInt("rows", 1), it.optInt("cols", 1), it.optInt("row"), it.optInt("col")) },
                schedules = schedules,
                playlists = playlists,
                layouts = layouts,
                files = files,
                heartbeatSeconds = o.optJSONObject("settings")?.optInt("heartbeatSeconds", 60) ?: 60,
            )
        }

        /** optString devuelve "null" para valores nulos: aquí se tratan como ausentes. */
        private fun JSONObject.str(key: String): String? =
            if (isNull(key)) null else optString(key).takeIf { it.isNotEmpty() && it != "null" }

        private fun parsePlaylist(p: JSONObject): Playlist {
            val id = p.optString("id")
            val name = p.optString("name")
            val items = ArrayList<Item>()
            val ia = p.optJSONArray("items")
            if (ia != null) for (i in 0 until ia.length()) {
                val it = ia.getJSONObject(i)
                val txt = it.optJSONObject("text")
                items.add(
                    Item(
                        id = it.optString("id"),
                        mediaId = it.optString("mediaId"),
                        name = it.optString("name"),
                        type = it.optString("type"),
                        duration = it.optInt("duration", 10),
                        naturalDuration = it.optInt("naturalDuration", 0),
                        file = it.str("file"),
                        url = it.str("url"),
                        size = it.optLong("size"),
                        text = txt?.let { x ->
                            TextStyle(
                                title = x.optString("title"),
                                body = x.optString("body"),
                                bg = color(x.optString("bg"), Color.rgb(15, 23, 42)),
                                color = color(x.optString("color"), Color.WHITE),
                                accent = color(x.optString("accent"), Color.rgb(245, 158, 11)),
                                align = x.optString("align", "center"),
                            )
                        },
                        playlistId = id,
                        playlistName = name,
                        transition = it.optString("transition"),
                    )
                )
            }
            return Playlist(
                id = id,
                name = name,
                transition = p.optString("transition", "fade"),
                transitionMs = p.optLong("transitionDuration", 800L).coerceIn(100L, 5000L),
                fit = p.optString("fit", "contain"),
                background = color(p.optString("background"), Color.BLACK),
                ticker = parseTicker(p.optJSONObject("ticker") ?: JSONObject()),
                items = items,
            )
        }

        private fun parseLayout(l: JSONObject): LayoutDef {
            val regions = ArrayList<Region>()
            val ra = l.optJSONArray("regions")
            if (ra != null) for (i in 0 until ra.length()) {
                val r = ra.getJSONObject(i)
                regions.add(
                    Region(
                        id = r.optString("id"),
                        type = r.optString("type", "playlist"),
                        x = r.optDouble("x", 0.0).toFloat(),
                        y = r.optDouble("y", 0.0).toFloat(),
                        w = r.optDouble("w", 100.0).toFloat(),
                        h = r.optDouble("h", 100.0).toFloat(),
                        z = r.optInt("z", i),
                        playlistId = r.str("playlistId"),
                        ticker = r.optJSONObject("ticker")?.let { parseTicker(it, true) },
                        clock = r.optJSONObject("clock")?.let { parseClock(it) } ?: if (r.optString("type") == "clock") parseClock(JSONObject()) else null,
                    )
                )
            }
            return LayoutDef(l.optString("id"), l.optString("name"), color(l.optString("background"), Color.BLACK), regions.sortedBy { it.z })
        }

        private fun parseTicker(t: JSONObject, enabled: Boolean = t.optBoolean("enabled")) = TickerStyle(
            enabled = enabled,
            text = t.optString("text"),
            speed = t.optInt("speed", 80),
            bg = color(t.optString("bg"), Color.rgb(185, 28, 28)),
            color = color(t.optString("color"), Color.WHITE),
            font = t.optString("font", "sans"),
            size = t.optDouble("size", 4.4).toFloat(),
            opacity = t.optInt("opacity", 100),
            position = t.optString("position", "bottom"),
            bold = t.optBoolean("bold", true),
        )

        private fun parseClock(c: JSONObject) = ClockStyle(
            format12 = c.optString("format") == "12",
            seconds = c.optBoolean("seconds", false),
            date = c.optBoolean("date", true),
            font = c.optString("font", "sans"),
            size = c.optDouble("size", 8.0).toFloat(),
            color = color(c.optString("color"), Color.WHITE),
            bg = color(c.optString("bg"), Color.BLACK),
            opacity = c.optInt("opacity", 60),
            align = c.optString("align", "center"),
        )

        fun parseIso(value: String?): Long {
            if (value.isNullOrEmpty()) return 0L
            for (pattern in arrayOf("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", "yyyy-MM-dd'T'HH:mm:ss'Z'")) {
                try {
                    val f = SimpleDateFormat(pattern, Locale.US)
                    f.timeZone = TimeZone.getTimeZone("UTC")
                    return f.parse(value)?.time ?: continue
                } catch (_: Exception) {
                }
            }
            return 0L
        }

        fun color(value: String?, fallback: Int): Int =
            try {
                if (value.isNullOrBlank()) fallback else Color.parseColor(value)
            } catch (e: IllegalArgumentException) {
                fallback
            }

        /** Aplica la opacidad (0-100) a un color. */
        fun withOpacity(color: Int, opacity: Int): Int =
            Color.argb((opacity.coerceIn(0, 100) * 255) / 100, Color.red(color), Color.green(color), Color.blue(color))
    }
}
