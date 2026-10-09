package com.publicast.player

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.URLEncoder
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

class HttpException(val code: Int, val body: String) : IOException("HTTP $code")

/** Cliente de la API de reproductores de PubliCast. */
class Api(val baseUrl: String, private val key: String) {
    private val json = "application/json; charset=utf-8".toMediaType()

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .pingInterval(25, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    fun absolute(url: String): String = if (url.startsWith("http://") || url.startsWith("https://")) url else baseUrl + url

    private fun call(method: String, path: String, body: JSONObject? = null): String {
        val builder = Request.Builder().url(absolute(path)).header("Authorization", "Bearer $key")
        if (method == "POST") builder.post((body ?: JSONObject()).toString().toRequestBody(json)) else builder.get()
        client.newCall(builder.build()).execute().use { res ->
            val text = res.body?.string() ?: ""
            if (!res.isSuccessful) throw HttpException(res.code, text)
            return text
        }
    }

    fun health(): Boolean = try {
        JSONObject(call("GET", "/api/health")).optBoolean("ok")
    } catch (e: Exception) {
        false
    }

    fun register(info: JSONObject): JSONObject =
        JSONObject(call("POST", "/api/player/register", JSONObject().put("key", key).put("info", info)))

    fun manifest(): String = call("GET", "/api/player/manifest")

    fun heartbeat(body: JSONObject): JSONObject = JSONObject(call("POST", "/api/player/heartbeat", body))

    /** Envía una captura JPEG de lo que muestra la pantalla (vista previa en el panel). */
    fun screenshot(jpeg: ByteArray) {
        val req = Request.Builder().url(absolute("/api/player/screenshot")).header("Authorization", "Bearer $key")
            .post(jpeg.toRequestBody("image/jpeg".toMediaType())).build()
        client.newCall(req).execute().use { if (!it.isSuccessful) throw HttpException(it.code, "") }
    }

    fun stats(body: JSONObject) {
        call("POST", "/api/player/stats", body)
    }

    /** Descarga un archivo a [dest] verificando su MD5. Devuelve true si quedó correcto. */
    fun download(url: String, dest: File, md5: String?): Boolean {
        val tmp = File(dest.parentFile, dest.name + ".part")
        val req = Request.Builder().url(absolute(url)).build()
        client.newCall(req).execute().use { res ->
            if (!res.isSuccessful) throw HttpException(res.code, "")
            val digest = MessageDigest.getInstance("MD5")
            res.body!!.byteStream().use { input ->
                tmp.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        digest.update(buf, 0, n)
                        out.write(buf, 0, n)
                    }
                }
            }
            val hex = digest.digest().joinToString("") { "%02x".format(it) }
            if (!md5.isNullOrEmpty() && !hex.equals(md5, ignoreCase = true)) {
                tmp.delete()
                return false
            }
            if (dest.exists()) dest.delete()
            return tmp.renameTo(dest)
        }
    }

    fun openSocket(listener: WebSocketListener): WebSocket {
        val wsUrl = baseUrl.replaceFirst("http", "ws") + "/ws?key=" + URLEncoder.encode(key, "UTF-8")
        return client.newWebSocket(Request.Builder().url(wsUrl).build(), listener)
    }

    fun shutdown() {
        client.dispatcher.cancelAll()
        client.dispatcher.executorService.shutdown()
        client.connectionPool.evictAll()
    }
}
