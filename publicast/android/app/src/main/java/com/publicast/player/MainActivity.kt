package com.publicast.player

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.ImageDecoder
import android.graphics.Typeface
import android.graphics.drawable.AnimatedImageDrawable
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.inputmethod.EditorInfo
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors

/**
 * Reproductor a pantalla completa. Muestra la configuración inicial, el código de
 * emparejamiento y, una vez autorizado, reproduce en bucle la programación vigente.
 */
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
class MainActivity : Activity(), SyncManager.Listener {

    private lateinit var prefs: Prefs
    private lateinit var cache: MediaCache
    private var sync: SyncManager? = null

    private lateinit var root: FrameLayout
    private lateinit var stage: FrameLayout
    private lateinit var videoView: PlayerView
    private lateinit var ticker: TickerView
    private lateinit var announceView: TextView
    private lateinit var identifyView: TextView
    private lateinit var statusView: TextView
    private lateinit var setupScreen: View
    private lateinit var pairingScreen: View
    private lateinit var idleScreen: View

    private var player: ExoPlayer? = null
    private val handler = Handler(Looper.getMainLooper())
    private val decoder = Executors.newSingleThreadExecutor()

    private var manifest: Manifest? = null
    private var sequence: List<Item> = emptyList()
    private var sequenceKey = ""
    private var index = 0
    private var playlist: Playlist? = null
    @Volatile private var current: Item? = null
    private var currentView: View? = null
    private var playing: Item? = null
    private var playStarted = 0L
    private var renderToken = 0
    private var playbackStarted = false

    private val advance = Runnable { next() }
    private val scheduleCheck = object : Runnable {
        override fun run() {
            checkSchedule()
            handler.postDelayed(this, 30_000)
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
        videoView = findViewById(R.id.video)
        ticker = findViewById(R.id.ticker)
        announceView = findViewById(R.id.announce)
        identifyView = findViewById(R.id.identify)
        statusView = findViewById(R.id.status)
        setupScreen = findViewById(R.id.setupScreen)
        pairingScreen = findViewById(R.id.pairingScreen)
        idleScreen = findViewById(R.id.idleScreen)

        createPlayer()
        setupConfigScreen()
        hideSystemUi()

        if (prefs.serverUrl.isEmpty()) showSetup() else startSync()
    }

    override fun onResume() {
        super.onResume()
        hideSystemUi()
        if (currentView === videoView) player?.play()
    }

    override fun onPause() {
        super.onPause()
        player?.pause()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        sync?.stop()
        sync = null
        decoder.shutdownNow()
        player?.release()
        player = null
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

    private fun createPlayer() {
        val p = ExoPlayer.Builder(this).build()
        p.repeatMode = Player.REPEAT_MODE_OFF
        p.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_ENDED && currentView === videoView && current?.type == "video") next()
            }

            override fun onPlayerError(error: PlaybackException) {
                Log.w(TAG, "Error de video: ${error.errorCodeName}")
                if (current?.type == "video") {
                    handler.removeCallbacks(advance)
                    handler.postDelayed(advance, 1000)
                }
            }
        })
        videoView.player = p
        player = p
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
                    val ok = Api(url, prefs.displayKey).health()
                    handler.post {
                        button.isEnabled = true
                        if (ok) {
                            prefs.serverUrl = url
                            error.text = ""
                            startSync()
                        } else {
                            error.text = "No se pudo conectar con $url\nCompruebe la dirección, el puerto y la red."
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
            next()
            handler.postDelayed(scheduleCheck, 30_000)
        } else {
            checkSchedule()
        }
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
            "identify" -> {
                identifyView.text = manifest?.displayName ?: getString(R.string.app_name)
                identifyView.visibility = View.VISIBLE
                handler.removeCallbacks(hideIdentify)
                handler.postDelayed(hideIdentify, 10_000)
            }
            "reload" -> {
                sequenceKey = ""
                sync?.requestSync()
                next()
            }
        }
    }

    override fun onStatus(message: String?) {
        statusView.text = message ?: ""
        statusView.visibility = if (message.isNullOrEmpty()) View.GONE else View.VISIBLE
    }

    override fun currentItem(): Item? = current

    // ------------------------------------------------------------------ reproducción
    private fun computeSequence(): Triple<String, List<Item>, Playlist?> {
        val m = manifest ?: return Triple("", emptyList(), null)
        val lists = Scheduler.resolve(m.schedules, m.defaultPlaylistId)
            .mapNotNull { m.playlists[it] }
            .map { p -> p to p.items.filter { cache.isPlayable(it) } }
            .filter { it.second.isNotEmpty() }
        if (lists.isEmpty()) return Triple("", emptyList(), null)
        // Varias listas con la misma prioridad: se intercalan sus contenidos
        val items = ArrayList<Item>()
        val max = lists.maxOf { it.second.size }
        for (i in 0 until max) lists.forEach { (_, its) -> if (i < its.size) items.add(its[i]) }
        val key = lists.joinToString("+") { it.first.id } + "@" + m.version + "#" + items.size
        return Triple(key, items, lists.first().first)
    }

    private fun checkSchedule() {
        if (computeSequence().first != sequenceKey) next()
    }

    private fun next() {
        handler.removeCallbacks(advance)
        finishStat()
        val (key, items, pl) = computeSequence()
        if (key != sequenceKey) {
            sequenceKey = key
            sequence = items
            index = 0
            playlist = pl
            applyPlaylistChrome(pl)
        }
        if (sequence.isEmpty()) {
            showIdle(if (manifest == null) "Conectando con el servidor…" else "Sin contenido programado en este momento")
            clearStage()
            current = null
            handler.postDelayed(advance, 15_000)
            return
        }
        idleScreen.visibility = View.GONE
        val item = sequence[index % sequence.size]
        index++
        // Un único contenido estático: no se vuelve a dibujar para evitar parpadeos
        if (sequence.size == 1 && current?.id == item.id && item.type != "video" && currentView != null) {
            beginStat(item)
            handler.postDelayed(advance, seconds(item) * 1000L)
            return
        }
        render(item, playlist ?: return)
    }

    private fun seconds(item: Item) = if (item.duration > 0) item.duration else 10

    private fun render(item: Item, pl: Playlist) {
        val token = ++renderToken
        when (item.type) {
            "image" -> {
                val file = cache.fileFor(item.file ?: "")
                val w = root.width.coerceAtLeast(1280)
                val h = root.height.coerceAtLeast(720)
                decoder.execute {
                    val drawable = decodeImage(file, w, h)
                    handler.post {
                        if (token != renderToken || isFinishing) return@post
                        if (drawable == null) {
                            handler.postDelayed(advance, 1000)
                            return@post
                        }
                        val iv = ImageView(this)
                        iv.scaleType = when (pl.fit) {
                            "cover" -> ImageView.ScaleType.CENTER_CROP
                            "fill" -> ImageView.ScaleType.FIT_XY
                            else -> ImageView.ScaleType.FIT_CENTER
                        }
                        iv.setImageDrawable(drawable)
                        startAnimated(drawable)
                        show(iv, item, pl)
                        handler.postDelayed(advance, seconds(item) * 1000L)
                    }
                }
            }
            "video" -> {
                val p = player ?: return
                videoView.resizeMode = when (pl.fit) {
                    "cover" -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM
                    "fill" -> AspectRatioFrameLayout.RESIZE_MODE_FILL
                    else -> AspectRatioFrameLayout.RESIZE_MODE_FIT
                }
                p.setMediaItem(MediaItem.fromUri(Uri.fromFile(cache.fileFor(item.file ?: ""))))
                p.prepare()
                p.playWhenReady = true
                show(videoView, item, pl)
                // duración 0 = video completo (límite de seguridad de 3 h)
                handler.postDelayed(advance, if (item.duration > 0) item.duration * 1000L else 3 * 3600 * 1000L)
            }
            "web" -> {
                val wv = createWebView(item.url ?: "")
                if (wv == null) {
                    handler.postDelayed(advance, 1000)
                    return
                }
                show(wv, item, pl)
                handler.postDelayed(advance, seconds(item) * 1000L)
            }
            "text" -> {
                show(buildTextSlide(item.text!!), item, pl)
                handler.postDelayed(advance, seconds(item) * 1000L)
            }
            else -> handler.postDelayed(advance, 1000)
        }
    }

    /** Coloca la nueva vista en el escenario con la transición de la lista. */
    private fun show(view: View, item: Item, pl: Playlist) {
        val old = currentView
        current = item
        beginStat(item)
        if (view === old) return // video seguido de video: se reutiliza el reproductor
        view.animate().cancel()
        // Retira vistas sobrantes de transiciones interrumpidas
        for (i in stage.childCount - 1 downTo 0) {
            val v = stage.getChildAt(i)
            if (v !== old && v !== videoView) discard(v)
        }
        if (view === videoView) {
            videoView.visibility = View.VISIBLE
            videoView.bringToFront()
        } else {
            stage.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }
        currentView = view
        val width = stage.width.toFloat()
        when (pl.transition) {
            "fade" -> {
                view.translationX = 0f
                view.alpha = 0f
                view.animate().alpha(1f).setDuration(TRANSITION_MS).withEndAction { cleanupStage() }.start()
            }
            "slide" -> {
                view.alpha = 1f
                view.translationX = width
                view.animate().translationX(0f).setDuration(TRANSITION_MS).withEndAction { cleanupStage() }.start()
                old?.animate()?.translationX(-width)?.setDuration(TRANSITION_MS)?.start()
            }
            else -> {
                view.alpha = 1f
                view.translationX = 0f
                cleanupStage()
            }
        }
    }

    /** Deja en el escenario sólo la vista actual (el reproductor de video se oculta, no se elimina). */
    private fun cleanupStage() {
        for (i in stage.childCount - 1 downTo 0) {
            val v = stage.getChildAt(i)
            if (v !== currentView) discard(v)
        }
    }

    private fun discard(v: View) {
        v.animate().cancel()
        if (v === videoView) {
            if (videoView.visibility != View.GONE) {
                videoView.visibility = View.GONE
                player?.stop()
                player?.clearMediaItems()
            }
            videoView.alpha = 1f
            videoView.translationX = 0f
            return
        }
        stage.removeView(v)
        if (v is WebView) {
            v.stopLoading()
            v.destroy()
        }
        if (v is ImageView) v.setImageDrawable(null)
    }

    private fun clearStage() {
        currentView = null
        cleanupStage()
    }

    private fun stopPlayback() {
        handler.removeCallbacks(advance)
        handler.removeCallbacks(scheduleCheck)
        finishStat()
        renderToken++
        playbackStarted = false
        sequenceKey = ""
        sequence = emptyList()
        current = null
        clearStage()
        ticker.visibility = View.GONE
    }

    private fun applyPlaylistChrome(pl: Playlist?) {
        stage.setBackgroundColor(pl?.background ?: Color.BLACK)
        val t = pl?.ticker
        if (t != null && t.enabled && t.text.isNotBlank()) {
            val h = (resources.displayMetrics.heightPixels * 0.08f).toInt().coerceAtLeast(dp(36))
            ticker.layoutParams = (ticker.layoutParams as FrameLayout.LayoutParams).apply { height = h }
            ticker.visibility = View.VISIBLE
            ticker.configure(t.text, t.speed, t.bg, t.color)
        } else {
            ticker.visibility = View.GONE
        }
    }

    private fun showIdle(message: String) {
        findViewById<TextView>(R.id.idleName).text = manifest?.displayName ?: getString(R.string.app_name)
        findViewById<TextView>(R.id.idleMessage).text = message
        if (pairingScreen.visibility != View.VISIBLE && setupScreen.visibility != View.VISIBLE) idleScreen.visibility = View.VISIBLE
    }

    // ------------------------------------------------------------------ tipos de contenido
    private fun decodeImage(file: File, reqW: Int, reqH: Int): Drawable? = try {
        if (!file.exists()) null
        else if (Build.VERSION.SDK_INT >= 28) {
            ImageDecoder.decodeDrawable(ImageDecoder.createSource(file)) { dec, info, _ ->
                var sample = 1
                while (info.size.width / (sample * 2) >= reqW && info.size.height / (sample * 2) >= reqH) sample *= 2
                dec.setTargetSampleSize(sample)
            }
        } else {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(file.absolutePath, bounds)
            var sample = 1
            while (bounds.outWidth / (sample * 2) >= reqW && bounds.outHeight / (sample * 2) >= reqH) sample *= 2
            BitmapFactory.decodeFile(file.absolutePath, BitmapFactory.Options().apply { inSampleSize = sample })
                ?.let { BitmapDrawable(resources, it) }
        }
    } catch (e: Throwable) {
        Log.w(TAG, "No se pudo decodificar ${file.name}", e)
        null
    }

    private fun startAnimated(d: Drawable) {
        if (Build.VERSION.SDK_INT >= 28 && d is AnimatedImageDrawable) {
            d.repeatCount = AnimatedImageDrawable.REPEAT_INFINITE
            d.start()
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView(url: String): WebView? = try {
        WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.loadWithOverviewMode = true
            settings.useWideViewPort = true
            webViewClient = WebViewClient()
            webChromeClient = WebChromeClient()
            setBackgroundColor(Color.WHITE)
            isFocusable = false
            loadUrl(url)
        }
    } catch (e: Exception) {
        // Algunos TV Box no traen WebView instalado
        Log.w(TAG, "WebView no disponible", e)
        null
    }

    private fun buildTextSlide(t: TextStyle): View {
        val minDim = minOf(root.width, root.height).takeIf { it > 0 } ?: 720
        val gravity = when (t.align) {
            "left" -> Gravity.START
            "right" -> Gravity.END
            else -> Gravity.CENTER_HORIZONTAL
        }
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(t.bg)
            this.gravity = Gravity.CENTER_VERTICAL or gravity
            val pad = (minDim * 0.07f).toInt()
            setPadding(pad, pad, pad, pad)
            if (t.title.isNotEmpty()) addView(TextView(context).apply {
                text = t.title
                setTextColor(t.accent)
                setTextSize(TypedValue.COMPLEX_UNIT_PX, minDim * 0.09f)
                typeface = Typeface.DEFAULT_BOLD
                this.gravity = gravity
                setPadding(0, 0, 0, (minDim * 0.03f).toInt())
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
            if (t.body.isNotEmpty()) addView(TextView(context).apply {
                text = t.body
                setTextColor(t.color)
                setTextSize(TypedValue.COMPLEX_UNIT_PX, minDim * 0.05f)
                setLineSpacing(0f, 1.2f)
                this.gravity = gravity
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
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

    // ------------------------------------------------------------------ estadísticas
    private fun beginStat(item: Item) {
        playing = item
        playStarted = System.currentTimeMillis()
    }

    private fun finishStat() {
        val item = playing ?: return
        playing = null
        val secs = ((System.currentTimeMillis() - playStarted) / 1000).toInt()
        sync?.recordPlay(item, playStarted, secs)
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
                    2 -> confirm("Se generará una nueva identidad y habrá que autorizar la pantalla otra vez. ¿Continuar?") {
                        stopSync()
                        stopPlayback()
                        prefs.resetPairing()
                        startSync()
                    }
                    3 -> showInfo()
                    4 -> try {
                        startActivity(Intent(Settings.ACTION_SETTINGS))
                    } catch (_: Exception) {
                    }
                    5 -> finish()
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
            appendLine("Pantalla: ${m?.displayName ?: "(sin autorizar)"}")
            appendLine("Versión de contenido: ${m?.version ?: "-"}")
            appendLine("Reproduciendo: ${current?.name ?: "-"}")
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

    companion object {
        private const val TAG = "PubliCast"
        private const val TRANSITION_MS = 800L
    }
}
