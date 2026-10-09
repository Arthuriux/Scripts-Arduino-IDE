package com.publicast.player

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.ImageDecoder
import android.graphics.Typeface
import android.graphics.drawable.AnimatedImageDrawable
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import java.io.File
import java.util.concurrent.ExecutorService

/**
 * Reproduce en bucle una secuencia de contenidos dentro de un contenedor (una zona del layout
 * o la pantalla completa). En modo [sync] (videowall) la posición se calcula a partir de la
 * hora del servidor, de modo que todas las pantallas muestran lo mismo al mismo tiempo.
 */
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
class RegionPlayer(
    private val activity: Activity,
    /** Dirección del servidor: los videos en línea se abren con su página /player/embed.html */
    private val serverUrl: String,
    private val container: FrameLayout,
    private val items: List<Item>,
    playlist: Playlist,
    private val cache: MediaCache,
    private val decoder: ExecutorService,
    private val sync: Boolean,
    /** Modo ligero: SurfaceView, sin fundidos en video, GIF estáticos y transiciones cortas. */
    private val lite: Boolean,
    private val screenMin: Int,
    private val serverNow: () -> Long,
    private val onPlayed: (item: Item, startedAt: Long, seconds: Int) -> Unit,
) {
    private val handler = Handler(Looper.getMainLooper())
    private val transition = playlist.transition
    private val transitionMs = if (lite) minOf(playlist.transitionMs, 450L) else playlist.transitionMs
    private val fit = playlist.fit
    private var player: ExoPlayer? = null
    private var videoView: PlayerView? = null
    private var currentView: View? = null
    private var index = 0
    private var token = 0
    private var stopped = false
    private var playStarted = 0L
    private var playing: Item? = null
    @Volatile var current: Item? = null
        private set

    private val advance = Runnable { next() }

    init {
        container.setBackgroundColor(playlist.background)
    }

    fun start() = next()

    fun stop() {
        stopped = true
        token++
        handler.removeCallbacksAndMessages(null)
        finishStat()
        for (i in container.childCount - 1 downTo 0) discard(container.getChildAt(i))
        player?.release()
        player = null
        videoView = null
        currentView = null
    }

    fun pause() = player?.pause()

    fun resume() {
        if (currentView != null && currentView === videoView) player?.play()
    }

    private fun durationOf(item: Item): Int = when {
        item.duration > 0 -> item.duration
        item.type == "video" -> if (item.naturalDuration > 0) item.naturalDuration else 30
        item.type == "stream" -> 30
        else -> 10
    }

    private data class Position(val index: Int, val offsetMs: Long, val remainingMs: Long)

    /** Posición en la secuencia según la hora del servidor (videowall). */
    private fun syncPosition(): Position {
        val totalMs = items.sumOf { durationOf(it) * 1000L }
        var t = ((serverNow() % totalMs) + totalMs) % totalMs
        items.forEachIndexed { i, it ->
            val d = durationOf(it) * 1000L
            if (t < d) return Position(i, t, d - t)
            t -= d
        }
        return Position(0, 0, durationOf(items[0]) * 1000L)
    }

    private fun next() {
        if (stopped || items.isEmpty()) return
        handler.removeCallbacks(advance)
        finishStat()
        val item: Item
        var offsetMs = 0L
        val waitMs: Long
        if (sync) {
            val p = syncPosition()
            item = items[p.index]
            offsetMs = p.offsetMs
            waitMs = p.remainingMs
        } else {
            item = items[index % items.size]
            index++
            waitMs = durationOf(item) * 1000L
        }
        // Un único contenido estático: no se vuelve a dibujar para evitar parpadeos
        if (items.size == 1 && current?.id == item.id && item.type != "video" && item.type != "stream" && currentView != null) {
            beginStat(item)
            handler.postDelayed(advance, waitMs)
            return
        }
        render(item, offsetMs, waitMs)
    }

    private fun render(item: Item, offsetMs: Long, waitMs: Long) {
        val t = ++token
        when (item.type) {
            "image" -> {
                val file = cache.fileFor(item.file ?: "")
                val w = container.width.coerceAtLeast(640)
                val h = container.height.coerceAtLeast(360)
                decoder.execute {
                    val drawable = decodeImage(file, w, h)
                    handler.post {
                        if (t != token || stopped) return@post
                        if (drawable == null) {
                            handler.postDelayed(advance, 1000)
                            return@post
                        }
                        val iv = ImageView(activity)
                        iv.scaleType = when (fit) {
                            "cover" -> ImageView.ScaleType.CENTER_CROP
                            "fill" -> ImageView.ScaleType.FIT_XY
                            else -> ImageView.ScaleType.FIT_CENTER
                        }
                        iv.setImageDrawable(drawable)
                        startAnimated(drawable)
                        show(iv, item)
                        handler.postDelayed(advance, waitMs)
                    }
                }
            }
            "video" -> {
                val (p, view) = ensureVideo()
                view.resizeMode = when (fit) {
                    "cover" -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM
                    "fill" -> AspectRatioFrameLayout.RESIZE_MODE_FILL
                    else -> AspectRatioFrameLayout.RESIZE_MODE_FIT
                }
                p.setMediaItem(MediaItem.fromUri(Uri.fromFile(cache.fileFor(item.file ?: ""))), if (offsetMs > 500) offsetMs else 0L)
                p.prepare()
                p.playWhenReady = true
                show(view, item)
                // Sin videowall: duración 0 = video completo (límite de seguridad de 3 h)
                handler.postDelayed(advance, if (sync || item.duration > 0) waitMs else 3 * 3600 * 1000L)
            }
            "stream" -> {
                // Video en línea (YouTube, TikTok…): la página embed.html avisa por el puente cuándo termina
                val wv = createWebView(serverUrl + (item.url ?: ""), local = false, bridge = Bridge(t))
                if (wv == null) {
                    handler.postDelayed(advance, 1000)
                    return
                }
                show(wv, item)
                val untilEnd = item.duration <= 0 && item.streamProvider == "youtube"
                handler.postDelayed(advance, if (sync || item.duration > 0) waitMs else if (untilEnd) 3 * 3600 * 1000L else 30_000L)
            }
            "web", "html" -> {
                // HTML local: se abre la copia descargada (funciona sin conexión, con sus imágenes y estilos)
                val url = if (item.type == "html") Uri.fromFile(cache.fileFor(item.file ?: "")).toString() else item.url ?: ""
                val wv = createWebView(url, item.type == "html")
                if (wv == null) {
                    handler.postDelayed(advance, 1000)
                    return
                }
                show(wv, item)
                handler.postDelayed(advance, waitMs)
            }
            "text" -> {
                show(buildTextSlide(item.text!!), item)
                handler.postDelayed(advance, waitMs)
            }
            else -> handler.postDelayed(advance, 1000)
        }
    }

    private fun ensureVideo(): Pair<ExoPlayer, PlayerView> {
        val existing = player
        val view = videoView
        if (existing != null && view != null) return existing to view
        // En videowall con Android < 7 SurfaceView no sigue bien la traslación del lienzo
        val surface = lite && (!sync || Build.VERSION.SDK_INT >= 24)
        val layout = if (surface) R.layout.region_video_surface else R.layout.region_video
        val v = activity.layoutInflater.inflate(layout, container, false) as PlayerView
        // Archivos locales: basta un búfer pequeño (menos memoria en equipos de 1-2 GB)
        val loadControl = DefaultLoadControl.Builder()
            .setBufferDurationsMs(2_000, 8_000, 500, 1_000)
            .setPrioritizeTimeOverSizeThresholds(true)
            .build()
        // Si el decodificador por hardware falla, prueba con otro en lugar de quedarse en negro
        val renderers = DefaultRenderersFactory(activity).setEnableDecoderFallback(true)
        val p = ExoPlayer.Builder(activity, renderers).setLoadControl(loadControl).build()
        p.repeatMode = Player.REPEAT_MODE_OFF
        p.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                if (!sync && state == Player.STATE_ENDED && currentView === videoView && current?.type == "video") next()
            }

            override fun onPlayerError(error: PlaybackException) {
                Log.w(TAG, "Error de video: ${error.errorCodeName}")
                if (current?.type == "video") {
                    handler.removeCallbacks(advance)
                    handler.postDelayed(advance, 1000)
                }
            }
        })
        v.player = p
        v.visibility = View.GONE
        container.addView(v, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        player = p
        videoView = v
        return p to v
    }

    /** Coloca la nueva vista con la transición de la lista. */
    private fun show(view: View, item: Item) {
        val old = currentView
        current = item
        beginStat(item)
        if (view === old) return // video seguido de video: se reutiliza el reproductor
        view.animate().cancel()
        for (i in container.childCount - 1 downTo 0) {
            val v = container.getChildAt(i)
            if (v !== old && v !== videoView) discard(v)
        }
        if (view === videoView) {
            view.visibility = View.VISIBLE
            view.bringToFront()
        } else {
            container.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }
        currentView = view
        val width = container.width.toFloat()
        val height = container.height.toFloat()
        // Videowall: corte para mantener la sincronía. SurfaceView (modo ligero) no admite transparencia.
        val effective = when {
            sync -> "none"
            lite && view === videoView -> "none"
            else -> item.transition.ifEmpty { transition }
        }
        // Estado de partida del contenido que entra y destino del que sale
        view.alpha = 1f
        view.translationX = 0f
        view.translationY = 0f
        view.scaleX = 1f
        view.scaleY = 1f
        var outX = 0f
        var outY = 0f
        when (effective) {
            "fade" -> view.alpha = 0f
            "slide" -> { view.translationX = width; outX = -width }
            "slide-right" -> { view.translationX = -width; outX = width }
            "slide-up" -> { view.translationY = height; outY = -height }
            "slide-down" -> { view.translationY = -height; outY = height }
            "zoom" -> { view.alpha = 0f; view.scaleX = 1.18f; view.scaleY = 1.18f }
            else -> {
                cleanup()
                return
            }
        }
        // withLayer(): la GPU anima una textura en lugar de redibujar la vista en cada fotograma
        view.animate().alpha(1f).translationX(0f).translationY(0f).scaleX(1f).scaleY(1f)
            .setDuration(transitionMs).withLayer().withEndAction { cleanup() }.start()
        if (old != null && (outX != 0f || outY != 0f)) {
            old.animate().translationX(outX).translationY(outY).setDuration(transitionMs).withLayer().start()
        }
    }

    /** Deja sólo la vista actual (el reproductor de video se oculta, no se elimina). */
    private fun cleanup() {
        for (i in container.childCount - 1 downTo 0) {
            val v = container.getChildAt(i)
            if (v !== currentView) discard(v)
        }
    }

    private fun discard(v: View) {
        v.animate().cancel()
        if (v === videoView) {
            if (v.visibility != View.GONE) {
                v.visibility = View.GONE
                if (!stopped) {
                    player?.stop()
                    player?.clearMediaItems()
                }
            }
            v.alpha = 1f
            v.translationX = 0f
            v.translationY = 0f
            v.scaleX = 1f
            v.scaleY = 1f
            if (!stopped) return
        }
        container.removeView(v)
        if (v is WebView) {
            v.stopLoading()
            v.destroy()
        }
        if (v is ImageView) v.setImageDrawable(null)
    }

    // ------------------------------------------------------------------ tipos de contenido
    private fun decodeImage(file: File, reqW: Int, reqH: Int): Drawable? = try {
        if (!file.exists()) null
        else if (Build.VERSION.SDK_INT >= 28 && lite) {
            // Modo ligero: imagen estática (los GIF animados consumen mucha CPU)
            BitmapDrawable(activity.resources, ImageDecoder.decodeBitmap(ImageDecoder.createSource(file)) { dec, info, _ ->
                var sample = 1
                while (info.size.width / (sample * 2) >= reqW && info.size.height / (sample * 2) >= reqH) sample *= 2
                dec.setTargetSampleSize(sample)
            })
        } else if (Build.VERSION.SDK_INT >= 28) {
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
            BitmapFactory.decodeFile(file.absolutePath, BitmapFactory.Options().apply {
                inSampleSize = sample
                // JPEG sin transparencia: RGB_565 usa la mitad de memoria en equipos antiguos
                if (lite && file.extension.lowercase() in setOf("jpg", "jpeg")) inPreferredConfig = android.graphics.Bitmap.Config.RGB_565
            })
                ?.let { BitmapDrawable(activity.resources, it) }
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

    /** Recibe los avisos de /player/embed.html: "ended" (terminó) o "error" (no se puede reproducir). */
    inner class Bridge(private val forToken: Int) {
        @JavascriptInterface
        fun event(name: String, detail: String) {
            handler.post {
                if (stopped || forToken != token || current?.type != "stream") return@post
                when (name) {
                    "ended" -> if ((current?.duration ?: 0) <= 0 && !sync) next()
                    "error" -> {
                        Log.w(TAG, "Video en línea no disponible: $detail")
                        handler.removeCallbacks(advance)
                        handler.postDelayed(advance, 1500)
                    }
                }
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    private fun createWebView(url: String, local: Boolean = false, bridge: Bridge? = null): WebView? = try {
        WebView(activity).apply {
            settings.allowFileAccess = local
            if (bridge != null) addJavascriptInterface(bridge, "PubliCastBridge")
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.loadWithOverviewMode = true
            settings.useWideViewPort = true
            webViewClient = object : WebViewClient() {
                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                    // Sin conexión con la página principal: se pasa al siguiente contenido
                    if (request.isForMainFrame && bridge != null) bridge.event("error", "sin conexión")
                }
            }
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
        val minDim = minOf(container.width, container.height).takeIf { it > 0 } ?: screenMin
        val gravity = when (t.align) {
            "left" -> Gravity.START
            "right" -> Gravity.END
            else -> Gravity.CENTER_HORIZONTAL
        }
        return LinearLayout(activity).apply {
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

    // ------------------------------------------------------------------ estadísticas
    private fun beginStat(item: Item) {
        playing = item
        playStarted = System.currentTimeMillis()
    }

    private fun finishStat() {
        val item = playing ?: return
        playing = null
        onPlayed(item, playStarted, ((System.currentTimeMillis() - playStarted) / 1000).toInt())
    }

    companion object {
        private const val TAG = "PubliCast"
    }
}
