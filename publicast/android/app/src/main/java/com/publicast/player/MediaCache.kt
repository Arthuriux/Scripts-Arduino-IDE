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

    /**
     * Archivo local de un contenido. Admite subcarpetas (contenido HTML con sus imágenes, CSS y JS)
     * sin permitir salir de la carpeta de caché.
     */
    fun fileFor(name: String): File {
        val parts = name.replace('\\', '/').split('/').filter { it.isNotEmpty() && it != "." && it != ".." }
        if (parts.isEmpty()) return File(dir, "_")
        return parts.fold(dir) { acc, p -> File(acc, p) }
    }

    fun has(ref: FileRef): Boolean {
        val f = fileFor(ref.file)
        return f.exists() && (ref.size <= 0 || f.length() == ref.size)
    }

    fun isPlayable(item: Item): Boolean = when (item.type) {
        "image", "video", "html" -> item.file != null && fileFor(item.file).exists()
        "web", "stream" -> !item.url.isNullOrEmpty()
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
                    fileFor(ref.file).parentFile?.mkdirs()
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
        val keep = manifest.files.map { fileFor(it.file).absolutePath }.toSet()
        dir.walkBottomUp().forEach { f ->
            if (f == dir) return@forEach
            if (f.isFile && f.absolutePath !in keep) f.delete()
            if (f.isDirectory && f.list().isNullOrEmpty()) f.delete()
        }
        return failed
    }

    fun freeSpace(): Long = dir.usableSpace

    companion object {
        private const val TAG = "PubliCast"
    }
}
