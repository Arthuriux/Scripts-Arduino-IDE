package com.publicast.player

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.PixelCopy
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.TextView
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.Calendar
import java.util.concurrent.Executors

/**
 * Reproductor a pantalla completa. Muestra la configuración inicial, el código de
 * emparejamiento y, una vez autorizado, reproduce la programación vigente: una o varias
 * listas a pantalla completa o un layout con varias zonas. Si la pantalla forma parte de
 * un videowall, el lienzo mide (columnas × filas) pantallas y cada una muestra su porción.
 */
class MainActivity : Activity(), SyncManager.Listener {

    private lateinit var prefs: Prefs
    private lateinit var cache: MediaCache
    private var sync: SyncManager? = null

    private lateinit var root: FrameLayout
    private lateinit var stage: FrameLayout
    private lateinit var announceView: TextView
    private lateinit var identifyView: View
    private lateinit var statusView: TextView
    private lateinit var setupScreen: View
    private lateinit var pairingScreen: View
    private lateinit var idleScreen: View

    private val handler = Handler(Looper.getMainLooper())
    private val decoder = Executors.newSingleThreadExecutor()

    private var manifest: Manifest? = null
    private val regions = ArrayList<RegionPlayer>()
    private var canvas: FrameLayout? = null
    private var renderKey: String? = null
    private var playbackStarted = false
    private var liteActive = false

    private val scheduleCheck = object : Runnable {
        override fun run() {
            refresh()
            handler.postDelayed(this, 15_000)
        }
    }
    /** Captura automática cada 5 minutos para la miniatura del panel. */
    private val screenshotTask = object : Runnable {
        override fun run() {
            sendScreenshot()
            handler.postDelayed(this, 5 * 60_000L)
        }
    }
    private val hideAnnouncement = Runnable { announceView.visibility = View.GONE }
    private val hideIdentify = Runnable { identifyView.visibility = View.GONE }

    // ------------------------------------------------------------------ ciclo de vida
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        prefs = Prefs(this)
        cache = MediaCache(this)

        root = findViewById(R.id.root)
        stage = findViewById(R.id.stage)
        announceView = findViewById(R.id.announce)
        identifyView = findViewById(R.id.identify)
        statusView = findViewById(R.id.status)
        setupScreen = findViewById(R.id.setupScreen)
        pairingScreen = findViewById(R.id.pairingScreen)
        idleScreen = findViewById(R.id.idleScreen)

        setupConfigScreen()
        hideSystemUi()

        if (prefs.serverUrl.isEmpty()) showSetup() else startSync()
    }

    override fun onResume() {
        super.onResume()
        hideSystemUi()
        regions.forEach { it.resume() }
    }

    override fun onPause() {
        super.onPause()
        regions.forEach { it.pause() }
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        teardown()
        sync?.stop()
        sync = null
        decoder.shutdownNow()
        super.onDestroy()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemUi()
    }

    @Suppress("DEPRECATION")
    private fun hideSystemUi() {
        if (Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(false)
            window.insetsController?.let {
                it.hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN)
        }
    }

    // ------------------------------------------------------------------ configuración inicial
    private fun setupConfigScreen() {
        val input = findViewById<EditText>(R.id.serverInput)
        val button = findViewById<Button>(R.id.connectButton)
        val error = findViewById<TextView>(R.id.setupError)
        val connect = {
            val url = Prefs.normalizeUrl(input.text.toString())
            if (url.length < 10) {
                error.text = "Escriba una dirección válida"
            } else {
                error.text = "Conectando con $url…"
                button.isEnabled = false
                Executors.newSingleThreadExecutor().execute {
                    // Si no se indicó puerto, se prueba también el 8080 (puerto por defecto del servidor)
                    val found = Prefs.candidateUrls(url).firstOrNull { Api(it, prefs.displayKey).health() }
                    handler.post {
                        button.isEnabled = true
                        if (found != null) {
                            prefs.serverUrl = found
                            error.text = ""
                            startSync()
                        } else {
                            error.text = "No se pudo conectar con $url\n" +
                                "Compruebe la dirección y el puerto (normalmente :8080), que el dispositivo esté " +
                                "en la misma red y que el Firewall de Windows permita el puerto."
                        }
                    }
                }
            }
        }
        button.setOnClickListener { connect() }
        input.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_GO || actionId == EditorInfo.IME_ACTION_DONE) {
                connect(); true
            } else false
        }
    }

    private fun showSetup() {
        stopSync()
        stopPlayback()
        pairingScreen.visibility = View.GONE
        idleScreen.visibility = View.GONE
        setupScreen.visibility = View.VISIBLE
        val input = findViewById<EditText>(R.id.serverInput)
        input.setText(prefs.serverUrl.ifEmpty { "http://" })
        input.setSelection(input.text.length)
        input.requestFocus()
    }

    private fun startSync() {
        setupScreen.visibility = View.GONE
        stopSync()
        showIdle("Conectando con el servidor…")
        sync = SyncManager(this, prefs, cache, this).also { it.start() }
    }

    private fun stopSync() {
        sync?.stop()
        sync = null
    }

    // ------------------------------------------------------------------ SyncManager.Listener
    override fun onPairing(code: String) {
        stopPlayback()
        idleScreen.visibility = View.GONE
        pairingScreen.visibility = View.VISIBLE
        findViewById<TextView>(R.id.pairCode).text = code
        findViewById<TextView>(R.id.pairServer).text = "Servidor: ${prefs.serverUrl}"
    }

    override fun onManifest(manifest: Manifest) {
        pairingScreen.visibility = View.GONE
        this.manifest = manifest
        applyOrientation(manifest.orientation)
        if (!playbackStarted) {
            playbackStarted = true
            handler.postDelayed(scheduleCheck, 15_000)
            handler.removeCallbacks(screenshotTask)
            handler.postDelayed(screenshotTask, 20_000)
        }
        // Las medidas de la pantalla se conocen tras el primer layout
        if (root.width == 0) root.post { refresh() } else refresh()
    }

    override fun onUnpaired() {
        stopPlayback()
        manifest = null
        showIdle("Pantalla desvinculada · registrando de nuevo…")
    }

    override fun onCommand(msg: JSONObject) {
        when (msg.optString("type")) {
            "announce" -> showAnnouncement(msg)
            "clearAnnouncement" -> {
                handler.removeCallbacks(hideAnnouncement)
                announceView.visibility = View.GONE
            }
            "identify" -> showIdentify(msg)
            "screenshot" -> sendScreenshot()
            "reload" -> {
                renderKey = null
                sync?.requestSync()
                refresh()
            }
        }
    }

    override fun onStatus(message: String?) {
        statusView.text = message ?: ""
        statusView.visibility = if (message.isNullOrEmpty()) View.GONE else View.VISIBLE
    }

    override fun currentItem(): Item? = regions.firstOrNull()?.current

    // ------------------------------------------------------------------ qué reproducir
    private sealed class Content(val key: String) {
        class Lists(key: String, val items: List<Item>, val first: Playlist) : Content(key)
        class Layout(key: String, val layout: LayoutDef) : Content(key)
    }

    private fun serverNow(): Long = sync?.serverNow() ?: System.currentTimeMillis()

    private fun playableItems(p: Playlist) = p.items.filter { cache.isPlayable(it) }

    /** Intercala los contenidos de varias listas con la misma prioridad. */
    private fun interleave(lists: List<Pair<Playlist, List<Item>>>): List<Item> {
        val items = ArrayList<Item>()
        val max = lists.maxOf { it.second.size }
        for (i in 0 until max) lists.forEach { (_, its) -> if (i < its.size) items.add(its[i]) }
        return items
    }

    private fun currentContent(): Content? {
        val m = manifest ?: return null
        val now = Calendar.getInstance().apply { timeInMillis = serverNow() }
        val keys = Scheduler.resolve(m.schedules, m.defaultContent, now)
        keys.firstOrNull { it.startsWith("l:") && m.layouts.containsKey(it.substring(2)) }?.let { k ->
            val layout = m.layouts.getValue(k.substring(2))
            // La clave incluye cuántos archivos están listos: al terminar de descargar se reconstruye
            val ready = layout.regions.sumOf { r -> r.playlistId?.let { m.playlists[it] }?.let { playableItems(it).size } ?: 0 }
            return Content.Layout("$k#$ready", layout)
        }
        val lists = keys.filter { it.startsWith("p:") }
            .mapNotNull { m.playlists[it.substring(2)] }
            .map { it to playableItems(it) }
            .filter { it.second.isNotEmpty() }
        if (lists.isEmpty()) return null
        val items = interleave(lists)
        return Content.Lists(lists.joinToString("+") { "p:" + it.first.id } + "#" + items.size, items, lists.first().first)
    }

    private fun refresh() {
        val m = manifest
        val content = currentContent()
        val w = m?.wall
        val key = if (content == null) "" else "${content.key}@${m?.version}|${w?.let { "${it.rows}x${it.cols}:${it.row},${it.col}" } ?: ""}|${root.width}x${root.height}"
        if (key == renderKey) return
        renderKey = key
        build(content, w)
    }

    private fun teardown() {
        regions.forEach { it.stop() }
        regions.clear()
        stage.removeAllViews()
        canvas = null
    }

    private fun stopPlayback() {
        handler.removeCallbacks(scheduleCheck)
        handler.removeCallbacks(screenshotTask)
        playbackStarted = false
        renderKey = null
        teardown()
    }

    /** Construye la pantalla: lienzo (videowall), zonas del layout, cintillos y relojes. */
    private fun build(content: Content?, wall: WallInfo?) {
        teardown()
        if (content == null) {
            showIdle(if (manifest == null) "Conectando con el servidor…" else "Sin contenido programado en este momento")
            return
        }
        idleScreen.visibility = View.GONE
        val screenW = root.width.takeIf { it > 0 } ?: resources.displayMetrics.widthPixels
        val screenH = root.height.takeIf { it > 0 } ?: resources.displayMetrics.heightPixels
        val cols = wall?.cols ?: 1
        val rows = wall?.rows ?: 1
        val cw = screenW * cols
        val ch = screenH * rows
        val c = FrameLayout(this)
        c.clipChildren = true
        stage.addView(c, FrameLayout.LayoutParams(cw, ch))
        if (wall != null) {
            c.translationX = -(wall.col * screenW).toFloat()
            c.translationY = -(wall.row * screenH).toFloat()
        }
        canvas = c
        val syncMode = wall != null
        val screenMin = minOf(screenW, screenH)
        val lite = DeviceProfile.liteMode(this, manifest?.performance)
        liteActive = lite
        val tickerFps = if (lite) 30 else 60

        fun region(x: Float, y: Float, w: Float, h: Float): FrameLayout {
            val f = FrameLayout(this)
            f.clipChildren = true
            val lp = FrameLayout.LayoutParams((cw * w / 100f).toInt(), (ch * h / 100f).toInt())
            lp.gravity = Gravity.TOP or Gravity.START
            lp.leftMargin = (cw * x / 100f).toInt()
            lp.topMargin = (ch * y / 100f).toInt()
            c.addView(f, lp)
            return f
        }

        fun player(container: FrameLayout, items: List<Item>, p: Playlist) {
            val rp = RegionPlayer(this, container, items, p, cache, decoder, syncMode, lite, screenMin, { serverNow() }) { item, started, secs ->
                sync?.recordPlay(item, started, secs)
            }
            regions.add(rp)
            // Las medidas de la zona se conocen tras el layout
            container.post { rp.start() }
        }

        when (content) {
            is Content.Lists -> {
                c.setBackgroundColor(content.first.background)
                player(region(0f, 0f, 100f, 100f), content.items, content.first)
                val t = content.first.ticker
                if (t.enabled && t.text.isNotBlank()) {
                    val tv = TickerView(this)
                    val textPx = screenH * t.size / 100f
                    val lp = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (textPx * 1.8f).toInt())
                    lp.gravity = if (t.position == "top") Gravity.TOP else Gravity.BOTTOM
                    c.addView(tv, lp)
                    tv.configure(t, textPx, tickerFps)
                }
            }
            is Content.Layout -> {
                val m = manifest ?: return
                c.setBackgroundColor(content.layout.background)
                // Modo ligero: sólo la zona de lista más grande reproduce videos (un único decodificador)
                val videoRegion = content.layout.regions.filter { it.type == "playlist" }.maxByOrNull { it.w * it.h }?.id
                content.layout.regions.forEach { r ->
                    val f = region(r.x, r.y, r.w, r.h)
                    when (r.type) {
                        "ticker" -> r.ticker?.takeIf { it.text.isNotBlank() }?.let { t ->
                            val tv = TickerView(this)
                            f.addView(tv, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
                            tv.configure(t, screenH * t.size / 100f, tickerFps)
                        }
                        "clock" -> r.clock?.let { cs ->
                            f.addView(ClockView(this, cs, screenH) { serverNow() }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
                        }
                        else -> r.playlistId?.let { m.playlists[it] }?.let { p ->
                            val all = playableItems(p)
                            val items = if (lite && r.id != videoRegion) all.filter { it.type != "video" } else all
                            if (items.isNotEmpty()) player(f, items, p)
                        }
                    }
                }
            }
        }
    }

    private fun showIdle(message: String) {
        findViewById<TextView>(R.id.idleName).text = manifest?.displayName ?: getString(R.string.app_name)
        findViewById<TextView>(R.id.idleMessage).text = message
        if (pairingScreen.visibility != View.VISIBLE && setupScreen.visibility != View.VISIBLE) idleScreen.visibility = View.VISIBLE
    }

    // ------------------------------------------------------------------ capturas de pantalla
    /** Copia lo que se ve (incluido el video) a una imagen pequeña de 480 px de ancho. */
    private fun captureScreen(done: (Bitmap?) -> Unit) {
        val w = root.width
        val hh = root.height
        if (w <= 0 || hh <= 0) return done(null)
        val tw = 480
        val th = (hh * tw / w).coerceAtLeast(1)
        val bmp = Bitmap.createBitmap(tw, th, Bitmap.Config.ARGB_8888)
        if (Build.VERSION.SDK_INT >= 26) {
            try {
                PixelCopy.request(window, bmp, { result -> done(if (result == PixelCopy.SUCCESS) bmp else null) }, handler)
            } catch (e: Exception) {
                done(null)
            }
        } else {
            // Android 7 o anterior: el video puede salir en negro
            val c = Canvas(bmp)
            c.scale(tw.toFloat() / w, th.toFloat() / hh)
            root.draw(c)
            done(bmp)
        }
    }

    private fun sendScreenshot() {
        captureScreen { bmp ->
            if (bmp == null) return@captureScreen
            decoder.execute {
                val out = ByteArrayOutputStream()
                bmp.compress(Bitmap.CompressFormat.JPEG, 72, out)
                bmp.recycle()
                sync?.uploadScreenshot(out.toByteArray())
            }
        }
    }

    // ------------------------------------------------------------------ superposiciones
    /** Número grande de la pantalla, como "Identificar" en la configuración de pantallas de Windows. */
    private fun showIdentify(msg: JSONObject) {
        val minDim = minOf(root.width, root.height).takeIf { it > 0 } ?: 720
        val number = msg.optInt("number", manifest?.displayNumber ?: 0)
        findViewById<TextView>(R.id.identifyNumber).apply {
            text = if (number > 0) number.toString() else "?"
            setTextSize(TypedValue.COMPLEX_UNIT_PX, minDim * 0.34f)
        }
        findViewById<TextView>(R.id.identifyName).apply {
            text = msg.optString("name").ifEmpty { manifest?.displayName ?: "" }
            setTextSize(TypedValue.COMPLEX_UNIT_PX, minDim * 0.045f)
        }
        findViewById<TextView>(R.id.identifyDetail).apply {
            text = msg.optString("detail")
            visibility = if (text.isNullOrEmpty()) View.GONE else View.VISIBLE
            setTextSize(TypedValue.COMPLEX_UNIT_PX, minDim * 0.03f)
        }
        identifyView.visibility = View.VISIBLE
        handler.removeCallbacks(hideIdentify)
        handler.postDelayed(hideIdentify, msg.optInt("seconds", 15) * 1000L)
    }

    private fun showAnnouncement(msg: JSONObject) {
        val minDim = minOf(root.width, root.height).takeIf { it > 0 } ?: 720
        val position = msg.optString("position", "full")
        announceView.text = msg.optString("text")
        announceView.setBackgroundColor(Manifest.color(msg.optString("bg"), Color.RED))
        announceView.setTextColor(Manifest.color(msg.optString("color"), Color.WHITE))
        val lp = announceView.layoutParams as FrameLayout.LayoutParams
        if (position == "full") {
            lp.height = ViewGroup.LayoutParams.MATCH_PARENT
            lp.gravity = Gravity.CENTER
            announceView.setTextSize(TypedValue.COMPLEX_UNIT_PX, minDim * 0.08f)
        } else {
            lp.height = (root.height * 0.18f).toInt().coerceAtLeast(dp(72))
            lp.gravity = if (position == "top") Gravity.TOP else Gravity.BOTTOM
            announceView.setTextSize(TypedValue.COMPLEX_UNIT_PX, minDim * 0.05f)
        }
        announceView.layoutParams = lp
        announceView.visibility = View.VISIBLE
        announceView.alpha = 0f
        announceView.animate().alpha(1f).setDuration(300).start()
        handler.removeCallbacks(hideAnnouncement)
        handler.postDelayed(hideAnnouncement, msg.optInt("duration", 30) * 1000L)
    }

    private fun applyOrientation(o: String) {
        requestedOrientation = when (o) {
            "landscape" -> ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
            "portrait" -> ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
            "reverseLandscape" -> ActivityInfo.SCREEN_ORIENTATION_REVERSE_LANDSCAPE
            "reversePortrait" -> ActivityInfo.SCREEN_ORIENTATION_REVERSE_PORTRAIT
            else -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }
    }

    override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {
        super.onConfigurationChanged(newConfig)
        // Al girar la pantalla cambian sus medidas: se reconstruye el lienzo
        root.post { refresh() }
    }

    // ------------------------------------------------------------------ menú oculto
    private var cornerTaps = 0
    private var firstTapAt = 0L

    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        if (ev.actionMasked == MotionEvent.ACTION_DOWN && setupScreen.visibility != View.VISIBLE) {
            val inCorner = ev.x < root.width * 0.15f && ev.y < root.height * 0.15f
            val now = System.currentTimeMillis()
            if (inCorner) {
                if (now - firstTapAt > 3000) {
                    firstTapAt = now
                    cornerTaps = 0
                }
                cornerTaps++
                if (cornerTaps >= 5) {
                    cornerTaps = 0
                    showMenu()
                    return true
                }
            }
        }
        return super.dispatchTouchEvent(ev)
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (setupScreen.visibility == View.VISIBLE) {
            if (keyCode == KeyEvent.KEYCODE_BACK && prefs.serverUrl.isNotEmpty()) {
                startSync()
                return true
            }
            return super.onKeyDown(keyCode, event)
        }
        return when (keyCode) {
            KeyEvent.KEYCODE_MENU, KeyEvent.KEYCODE_SETTINGS, KeyEvent.KEYCODE_INFO -> {
                showMenu(); true
            }
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> {
                event.startTracking(); true
            }
            KeyEvent.KEYCODE_BACK -> true // modo quiosco: no se sale con "atrás"
            else -> super.onKeyDown(keyCode, event)
        }
    }

    override fun onKeyLongPress(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_ENTER || keyCode == KeyEvent.KEYCODE_BACK) {
            showMenu()
            return true
        }
        return super.onKeyLongPress(keyCode, event)
    }

    private fun showMenu() {
        val options = arrayOf(
            "Cambiar servidor",
            "Forzar sincronización",
            "Identificar esta pantalla",
            "Volver a emparejar esta pantalla",
            "Información",
            "Ajustes de Android",
            "Salir de PubliCast",
        )
        AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert)
            .setTitle(getString(R.string.app_name))
            .setItems(options) { _, which ->
                when (which) {
                    0 -> showSetup()
                    1 -> {
                        sync?.requestSync()
                        onStatus("Sincronizando…")
                    }
                    2 -> showIdentify(JSONObject().put("seconds", 10))
                    3 -> confirm("Se generará una nueva identidad y habrá que autorizar la pantalla otra vez. ¿Continuar?") {
                        stopSync()
                        stopPlayback()
                        prefs.resetPairing()
                        startSync()
                    }
                    4 -> showInfo()
                    5 -> try {
                        startActivity(Intent(Settings.ACTION_SETTINGS))
                    } catch (_: Exception) {
                    }
                    6 -> finish()
                }
            }
            .setNegativeButton("Cerrar", null)
            .show()
    }

    private fun confirm(text: String, action: () -> Unit) {
        AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert)
            .setMessage(text)
            .setPositiveButton("Sí") { _, _ -> action() }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    private fun showInfo() {
        val m = manifest
        val files = cache.dir.listFiles()?.size ?: 0
        val size = cache.dir.listFiles()?.sumOf { it.length() } ?: 0L
        val text = buildString {
            appendLine("Servidor: ${prefs.serverUrl}")
            appendLine("Pantalla: ${m?.let { "#${it.displayNumber} ${it.displayName}" } ?: "(sin autorizar)"}")
            m?.wall?.let { appendLine("Videowall: ${it.name} · fila ${it.row + 1}, columna ${it.col + 1} de ${it.cols}×${it.rows}") }
            appendLine("Versión de contenido: ${m?.version ?: "-"}")
            appendLine("Reproduciendo: ${currentItem()?.name ?: "-"}")
            appendLine("Diferencia de reloj con el servidor: ${sync?.clockOffsetMs ?: 0} ms")
            appendLine("Modo ligero: ${if (liteActive) "activado" else "desactivado"} (ajuste: ${m?.performance ?: "auto"}) · RAM ${DeviceProfile.totalRamMb(this@MainActivity)} MB")
            appendLine("Archivos en caché: $files (${size / (1024 * 1024)} MB)")
            appendLine("Espacio libre: ${cache.freeSpace() / (1024 * 1024)} MB")
            appendLine("App: ${BuildConfigCompat.versionName(this@MainActivity)}")
            append("Dispositivo: ${Build.MANUFACTURER} ${Build.MODEL} · Android ${Build.VERSION.RELEASE}")
        }
        AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert)
            .setTitle("Información")
            .setMessage(text)
            .setPositiveButton("Aceptar", null)
            .show()
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
}
