package com.publicast.player

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import android.util.AttributeSet
import android.view.View

/** Cintillo de texto en movimiento continuo con velocidad configurable. */
class TickerView @JvmOverloads constructor(context: Context, attrs: AttributeSet? = null) : View(context, attrs) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = Typeface.DEFAULT_BOLD }
    private var text = ""
    private var textWidth = 0f
    private var offset = 0f
    private var speedPx = 80f
    private var lastFrame = 0L

    fun configure(message: String, speedDp: Int, bg: Int, color: Int) {
        text = "$message     •     "
        speedPx = speedDp * resources.displayMetrics.density
        setBackgroundColor(bg)
        paint.color = color
        if (height > 0) paint.textSize = height * 0.55f
        textWidth = paint.measureText(text)
        offset = width.toFloat()
        lastFrame = 0L
        requestLayout()
        invalidate()
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        paint.textSize = h * 0.55f
        textWidth = paint.measureText(text)
        if (offset == 0f) offset = w.toFloat()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (text.isEmpty() || visibility != VISIBLE) return
        if (textWidth == 0f) textWidth = paint.measureText(text)
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
