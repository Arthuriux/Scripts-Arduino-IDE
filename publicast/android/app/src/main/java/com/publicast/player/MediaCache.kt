package com.publicast.player

import android.content.Context
import android.util.Log
import java.io.File

/**
 * Caché local de contenidos: todo lo que se reproduce se descarga antes al almacenamiento
 * interno, así la pantalla sigue funcionando aunque se caiga la red.
 */
class MediaCache(context: Context) {
    val dir: File = File(context.filesDir, "media").apply { mkdirs() }

    fun fileFor(name: String): File = File(dir, File(name).name)

    fun has(ref: FileRef): Boolean {
        val f = fileFor(ref.file)
        return f.exists() && (ref.size <= 0 || f.length() == ref.size)
    }

    fun isPlayable(item: Item): Boolean = when (item.type) {
        "image", "video" -> item.file != null && fileFor(item.file).exists()
        "web" -> !item.url.isNullOrEmpty()
        "text" -> item.text != null
        else -> false
    }

    /**
     * Descarga lo que falta y elimina lo que ya no se usa.
     * @return número de archivos que no se pudieron descargar
     */
    fun sync(api: Api, manifest: Manifest, progress: (done: Int, total: Int) -> Unit): Int {
        val missing = manifest.files.filter { !has(it) }
        var failed = 0
        missing.forEachIndexed { i, ref ->
            progress(i, missing.size)
            var ok = false
            for (attempt in 1..3) {
                try {
                    if (api.download(ref.url, fileFor(ref.file), ref.md5)) {
                        ok = true
                        break
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Error al descargar ${ref.file} (intento $attempt): ${e.message}")
                }
            }
            if (!ok) failed++
        }
        progress(missing.size, missing.size)
        // Limpieza de archivos que ya no pertenecen a ninguna lista
        val keep = manifest.files.map { it.file }.toSet()
        dir.listFiles()?.forEach { f -> if (f.name !in keep) f.delete() }
        return failed
    }

    fun freeSpace(): Long = dir.usableSpace

    companion object {
        private const val TAG = "PubliCast"
    }
}
