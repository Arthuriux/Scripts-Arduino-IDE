package com.publicast.player

import android.graphics.Color
import org.json.JSONObject

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
    val type: String, // image | video | web | text
    val duration: Int,
    val file: String?,
    val url: String?,
    val size: Long,
    val text: TextStyle?,
    val playlistId: String = "",
    val playlistName: String = "",
)

data class Ticker(val enabled: Boolean, val text: String, val speed: Int, val bg: Int, val color: Int)

data class Playlist(
    val id: String,
    val name: String,
    val transition: String,
    val fit: String,
    val background: Int,
    val ticker: Ticker,
    val items: List<Item>,
)

data class Schedule(
    val id: String,
    val playlistId: String,
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
    val displayId: String,
    val displayName: String,
    val orientation: String,
    val defaultPlaylistId: String?,
    val schedules: List<Schedule>,
    val playlists: Map<String, Playlist>,
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
            val schedules = ArrayList<Schedule>()
            val sa = o.optJSONArray("schedules")
            if (sa != null) for (i in 0 until sa.length()) {
                val s = sa.getJSONObject(i)
                val days = ArrayList<Int>()
                val da = s.optJSONArray("days")
                if (da != null) for (j in 0 until da.length()) days.add(da.optInt(j))
                schedules.add(
                    Schedule(
                        id = s.optString("id"),
                        playlistId = s.optString("playlistId"),
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
            return Manifest(
                version = o.optLong("version"),
                displayId = display.optString("id"),
                displayName = display.optString("name", "PubliCast"),
                orientation = display.optString("orientation", "auto"),
                defaultPlaylistId = o.optString("defaultPlaylistId").takeIf { it.isNotEmpty() && it != "null" },
                schedules = schedules,
                playlists = playlists,
                files = files,
                heartbeatSeconds = o.optJSONObject("settings")?.optInt("heartbeatSeconds", 60) ?: 60,
            )
        }

        private fun parsePlaylist(p: JSONObject): Playlist {
            val id = p.optString("id")
            val name = p.optString("name")
            val t = p.optJSONObject("ticker") ?: JSONObject()
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
                        file = it.optString("file").takeIf { f -> f.isNotEmpty() },
                        url = it.optString("url").takeIf { u -> u.isNotEmpty() },
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
                    )
                )
            }
            return Playlist(
                id = id,
                name = name,
                transition = p.optString("transition", "fade"),
                fit = p.optString("fit", "contain"),
                background = color(p.optString("background"), Color.BLACK),
                ticker = Ticker(
                    enabled = t.optBoolean("enabled"),
                    text = t.optString("text"),
                    speed = t.optInt("speed", 80),
                    bg = color(t.optString("bg"), Color.rgb(185, 28, 28)),
                    color = color(t.optString("color"), Color.WHITE),
                ),
                items = items,
            )
        }

        fun color(value: String?, fallback: Int): Int =
            try {
                if (value.isNullOrBlank()) fallback else Color.parseColor(value)
            } catch (e: IllegalArgumentException) {
                fallback
            }
    }
}
