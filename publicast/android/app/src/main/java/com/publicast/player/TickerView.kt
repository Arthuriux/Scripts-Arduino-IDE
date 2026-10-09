package com.publicast.player

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.util.AttributeSet
import android.view.View

/** Cintillo de texto en movimiento continuo: velocidad, tipo de letra, tamaño, colores y opacidad. */
class TickerView @JvmOverloads constructor(context: Context, attrs: AttributeSet? = null) : View(context, attrs) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private var text = ""
    private var textWidth = 0f
    private var offset = Float.NaN
    private var speedPx = 80f
    private var lastFrame = 0L

    /** @param textPx tamaño de la letra en píxeles */
    fun configure(style: TickerStyle, textPx: Float) {
        text = "${style.text}     •     "
        speedPx = style.speed * resources.displayMetrics.density
        setBackgroundColor(Manifest.withOpacity(style.bg, style.opacity))
        paint.color = style.color
        paint.typeface = Fonts.typeface(style.font, style.bold)
        paint.textSize = textPx
        textWidth = paint.measureText(text)
        offset = Float.NaN
        lastFrame = 0L
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (text.isEmpty() || textWidth <= 0f) return
        if (offset.isNaN()) offset = width.toFloat()
        val now = System.nanoTime()
        if (lastFrame != 0L) offset -= speedPx * ((now - lastFrame) / 1_000_000_000f)
        lastFrame = now
        if (offset < -textWidth) offset += textWidth
        val y = height / 2f - (paint.descent() + paint.ascent()) / 2f
        var x = offset
        while (x < width) {
            canvas.drawText(text, x, y, paint)
            x += textWidth
        }
        postInvalidateOnAnimation()
    }
}
