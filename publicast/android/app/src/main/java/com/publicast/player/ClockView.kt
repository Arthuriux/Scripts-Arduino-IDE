package com.publicast.player

import android.content.Context
import android.util.TypedValue
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Reloj con fecha en español, actualizado cada segundo. */
class ClockView(context: Context, private val style: ClockStyle, screenHeight: Int, private val now: () -> Long) : LinearLayout(context) {
    private val time = TextView(context)
    private val date = TextView(context)
    private val es = Locale("es", "ES")
    private val timeFormat = SimpleDateFormat(
        (if (style.format12) "h:mm" else "HH:mm") + if (style.seconds) ":ss" else "", es
    )
    private val dateFormat = SimpleDateFormat("EEEE, d 'de' MMMM 'de' yyyy", es)
    private val ampm = SimpleDateFormat("a", Locale.US)
    private val tick = object : Runnable {
        override fun run() {
            update()
            postDelayed(this, 1000L - (now() % 1000L))
        }
    }

    init {
        orientation = VERTICAL
        val g = when (style.align) {
            "left" -> Gravity.START
            "right" -> Gravity.END
            else -> Gravity.CENTER_HORIZONTAL
        }
        gravity = Gravity.CENTER_VERTICAL or g
        setBackgroundColor(Manifest.withOpacity(style.bg, style.opacity))
        val pad = (screenHeight * 0.03f).toInt()
        setPadding(pad, 0, pad, 0)
        val px = screenHeight * style.size / 100f
        listOf(time to px, date to px * 0.38f).forEach { (tv, size) ->
            tv.setTextColor(style.color)
            tv.typeface = Fonts.typeface(style.font, true)
            tv.setTextSize(TypedValue.COMPLEX_UNIT_PX, size)
            tv.gravity = g
            tv.includeFontPadding = false
        }
        addView(time, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
        if (style.date) addView(date, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT).apply { topMargin = (px * 0.1f).toInt() })
        update()
    }

    private fun update() {
        val d = Date(now())
        var t = timeFormat.format(d)
        if (style.format12) t += if (ampm.format(d) == "AM") " a. m." else " p. m."
        time.text = t
        date.text = dateFormat.format(d).replaceFirstChar { it.titlecase(es) }
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        removeCallbacks(tick)
        post(tick)
    }

    override fun onDetachedFromWindow() {
        removeCallbacks(tick)
        super.onDetachedFromWindow()
    }
}
