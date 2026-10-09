package com.publicast.player

import android.graphics.Typeface

/** Tipos de letra del panel ("sans", "condensed"...) → fuentes del sistema Android. */
object Fonts {
    fun typeface(font: String?, bold: Boolean): Typeface {
        val style = if (bold) Typeface.BOLD else Typeface.NORMAL
        return when (font) {
            "condensed" -> Typeface.create("sans-serif-condensed", style)
            "light" -> Typeface.create("sans-serif-light", Typeface.NORMAL)
            "black" -> Typeface.create("sans-serif-black", Typeface.NORMAL)
            "serif" -> Typeface.create(Typeface.SERIF, style)
            "mono" -> Typeface.create(Typeface.MONOSPACE, style)
            "casual" -> Typeface.create("casual", style)
            "cursive" -> Typeface.create("cursive", style)
            else -> Typeface.create(Typeface.SANS_SERIF, style)
        }
    }
}
