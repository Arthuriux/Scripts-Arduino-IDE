package com.publicast.player

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * Se encarga de toda la comunicación con el servidor:
 * emparejamiento, manifiesto, descarga de contenidos, latido, estadísticas y WebSocket.
 * Todas las devoluciones de llamada al [Listener] se hacen en el hilo principal.
 */
class SyncManager(
    private val context: Context,
    private val prefs: Prefs,
    private val cache: MediaCache,
    private val listener: Listener,
) {
    interface Listener {
        fun onPairing(code: String)
        fun onManifest(manifest: Manifest)
        fun onUnpaired()
        fun onCommand(msg: JSONObject)
        fun onStatus(message: String?)
        fun currentItem(): Item?
    }

    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    private val downloader = Executors.newSingleThreadExecutor()
    private val api = Api(prefs.serverUrl, prefs.displayKey)
    private var socket: WebSocket? = null
    private var socketRetryMs = 1000L
    private var running = false
    @Volatile private var authorized = false
    private var syncing = false
    private var pendingSync = false
    @Volatile var manifest: Manifest? = null
        private set
    @Volatile private var lastError: String = ""

    /** Milisegundos a sumar a la hora local para obtener la del servidor (sincronía de videowall). */
    @Volatile var clockOffsetMs = 0L
        private set

    fun serverNow(): Long = System.currentTimeMillis() + clockOffsetMs

    private fun updateClock(serverMs: Long, sentAt: Long, receivedAt: Long) {
        if (serverMs > 0) clockOffsetMs = serverMs - (sentAt + receivedAt) / 2
    }
    private val stats = ArrayList<JSONObject>()

    fun start() {
        running = true
        prefs.manifestJson?.let { raw ->
            try {
                manifest = Manifest.parse(raw).also { listener.onManifest(it) }
            } catch (e: Exception) {
                Log.w(TAG, "Manifiesto guardado inválido", e)
            }
        }
        io.execute { register() }
        main.postDelayed(heartbeatTask, 30_000)
    }

    fun stop() {
        running = false
        main.removeCallbacksAndMessages(null)
        socket?.close(1000, "bye")
        socket = null
        io.shutdownNow()
        downloader.shutdownNow()
        api.shutdown()
    }

    fun recordPlay(item: Item, startedAt: Long, seconds: Int) {
        if (seconds < 1) return
        synchronized(stats) {
            if (stats.size > 5000) stats.removeAt(0)
            stats.add(
                JSONObject()
                    .put("mediaId", item.mediaId)
                    .put("playlistId", item.playlistId)
                    .put("startedAt", isoDate(startedAt))
                    .put("duration", seconds)
            )
        }
    }

    // ------------------------------------------------------------------ emparejamiento
    private fun register() {
        if (!running) return
        try {
            val r = api.register(deviceInfo())
            if (!r.optBoolean("authorized")) {
                authorized = false
                val code = r.optString("code")
                main.post {
                    listener.onPairing(code)
                    connectSocket()
                }
                schedule(5_000) { register() }
                return
            }
            authorized = true
            main.post { connectSocket() }
            requestSync()
        } catch (e: Exception) {
            lastError = e.message ?: e.javaClass.simpleName
            main.post { listener.onStatus("Sin conexión con el servidor · reintentando") }
            schedule(10_000) { register() }
        }
    }

    private fun schedule(delayMs: Long, task: () -> Unit) {
        main.postDelayed({ if (running) io.execute { task() } }, delayMs)
    }

    // ------------------------------------------------------------------ sincronización
    fun requestSync() {
        main.post {
            if (syncing) {
                pendingSync = true
                return@post
            }
            syncing = true
            downloader.execute { doSync() }
        }
    }

    private fun doSync() {
        try {
            val sentAt = System.currentTimeMillis()
            val raw = api.manifest()
            val m = Manifest.parse(raw)
            updateClock(m.serverTimeMs, sentAt, System.currentTimeMillis())
            val firstRun = manifest == null
            val failed = cache.sync(api, m) { done, total ->
                if (total > 0) main.post { listener.onStatus("Descargando contenido $done/$total…") }
            }
            prefs.manifestJson = raw
            manifest = m
            main.post {
                listener.onStatus(if (failed > 0) "$failed archivo(s) no se pudieron descargar" else null)
                listener.onManifest(m)
            }
            if (failed > 0) lastError = "$failed archivo(s) sin descargar"
            else lastError = ""
            if (firstRun) Log.i(TAG, "Primer manifiesto recibido v${m.version}")
        } catch (e: HttpException) {
            if (e.code == 401 || e.code == 403) {
                main.post { unpaired() }
            } else {
                lastError = "HTTP ${e.code}"
            }
        } catch (e: Exception) {
            lastError = e.message ?: e.javaClass.simpleName
            main.post { listener.onStatus("Sin conexión · reproduciendo contenido guardado") }
        } finally {
            main.post {
                syncing = false
                if (pendingSync) {
                    pendingSync = false
                    requestSync()
                }
            }
        }
    }

    private fun unpaired() {
        if (!running) return
        authorized = false
        manifest = null
        prefs.manifestJson = null
        listener.onUnpaired()
        io.execute { register() }
    }

    // ------------------------------------------------------------------ latido
    private val heartbeatTask = object : Runnable {
        override fun run() {
            if (!running) return
            io.execute { heartbeat() }
            val secs = manifest?.heartbeatSeconds ?: 60
            main.postDelayed(this, secs * 1000L)
        }
    }

    private fun heartbeat() {
        val m = manifest ?: return
        if (!authorized) return
        try {
            val current = listener.currentItem()
            val sentAt = System.currentTimeMillis()
            val r = api.heartbeat(
                JSONObject()
                    .put("currentItem", current?.name ?: "")
                    .put("currentPlaylist", current?.playlistName ?: "")
                    .put("contentVersion", m.version)
                    .put("cacheReady", m.files.all { cache.has(it) })
                    .put("error", lastError)
                    .put("info", deviceInfo())
            )
            updateClock(Manifest.parseIso(r.optString("serverTime")), sentAt, System.currentTimeMillis())
            if (r.optLong("version") != m.version) requestSync()
            main.post { if (!syncing) listener.onStatus(null) }
            flushStats()
        } catch (e: HttpException) {
            if (e.code == 401 || e.code == 403) main.post { unpaired() }
        } catch (e: Exception) {
            main.post { listener.onStatus("Sin conexión · reproduciendo contenido guardado") }
        }
    }

    private fun flushStats() {
        val batch: List<JSONObject>
        synchronized(stats) {
            if (stats.isEmpty()) return
            batch = ArrayList(stats)
            stats.clear()
        }
        try {
            api.stats(JSONObject().put("records", JSONArray(batch)))
        } catch (e: Exception) {
            synchronized(stats) { stats.addAll(0, batch) }
        }
    }

    // ------------------------------------------------------------------ WebSocket
    private fun connectSocket() {
        if (!running || socket != null) return
        socket = api.openSocket(object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                socketRetryMs = 1000L
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val msg = try {
                    JSONObject(text)
                } catch (e: Exception) {
                    return
                }
                main.post { handleMessage(msg) }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = reconnect(webSocket)

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = reconnect(webSocket)
        })
    }

    private fun reconnect(ws: WebSocket) {
        main.post {
            if (socket !== ws) return@post
            socket = null
            if (!running) return@post
            val delay = socketRetryMs
            socketRetryMs = minOf(socketRetryMs * 2, 60_000L)
            main.postDelayed({ if (running) connectSocket() }, delay)
        }
    }

    private fun handleMessage(msg: JSONObject) {
        when (msg.optString("type")) {
            "hello", "version" -> {
                val v = msg.optLong("version")
                if (authorized && v != manifest?.version) requestSync()
            }
            "authorized" -> io.execute { register() }
            "unpaired" -> unpaired()
            else -> listener.onCommand(msg)
        }
    }

    // ------------------------------------------------------------------ utilidades
    private fun deviceInfo(): JSONObject {
        val dm = context.resources.displayMetrics
        return JSONObject()
            .put("model", "${Build.MANUFACTURER} ${Build.MODEL}".trim())
            .put("android", "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
            .put("resolution", "${dm.widthPixels}x${dm.heightPixels}")
            .put("appVersion", BuildConfigCompat.versionName(context))
            .put("freeSpace", "${cache.freeSpace() / (1024 * 1024)} MB")
            .put("ram", "${DeviceProfile.totalRamMb(context)} MB")
            .put("lowEnd", DeviceProfile.isLowEnd(context))
    }

    private fun isoDate(ms: Long): String {
        val f = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
        f.timeZone = java.util.TimeZone.getTimeZone("UTC")
        return f.format(java.util.Date(ms))
    }

    companion object {
        private const val TAG = "PubliCast"
    }
}

object BuildConfigCompat {
    fun versionName(context: Context): String = try {
        context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "?"
    } catch (e: Exception) {
        "?"
    }
}
