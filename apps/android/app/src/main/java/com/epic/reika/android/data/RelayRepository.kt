package com.epic.reika.android.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume

class RelayRepository(
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build(),
) {
    private val json = Json { ignoreUnknownKeys = true }

    /** True iff the relay REST /v1/health returns ok and the app WS opens. */
    suspend fun checkConnection(config: RelayConfig): ConnectionCheck = withContext(Dispatchers.IO) {
        val health = runCatching { getHealth(config) }.getOrNull()
        val restOk = health?.ok == true
        val wsOk = runCatching { openAppSocket(config) }.getOrDefault(false)
        ConnectionCheck(restOk = restOk, webSocketOk = wsOk, health = health)
    }

    /** GET /v1/devices — the device roster with online/offline + provider/agent counts. */
    suspend fun listDevices(config: RelayConfig): List<RelayDeviceSummary> = withContext(Dispatchers.IO) {
        val request = Request.Builder().url(config.devicesUrl()).get().build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return@withContext emptyList()
            val body = response.body?.string().orEmpty()
            runCatching { json.decodeFromString<RelayDevicesResponse>(body) }
                .getOrNull()?.devices ?: emptyList()
        }
    }

    /** POST /v1/pairing/create — returns a short-lived pairing code. */
    suspend fun createPairing(config: RelayConfig): RelayPairing? = withContext(Dispatchers.IO) {
        val mediaType = "application/json".toMediaType()
        val request = Request.Builder()
            .url(config.pairingCreateUrl())
            .post("{}".toRequestBody(mediaType))
            .build()
        client.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            runCatching { json.decodeFromString<RelayPairingResponse>(body) }
                .getOrNull()?.pairing
        }
    }

    /** GET /v1/pairing/{code} — poll pairing status while the device claims/approves. */
    suspend fun pairingStatus(config: RelayConfig, code: String): RelayPairingResponse? = withContext(Dispatchers.IO) {
        val request = Request.Builder().url(config.pairingStatusUrl(code)).get().build()
        client.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            runCatching { json.decodeFromString<RelayPairingResponse>(body) }.getOrNull()
        }
    }

    private fun getHealth(config: RelayConfig): RelayHealth {
        val request = Request.Builder().url(config.healthUrl()).get().build()
        return client.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            json.decodeFromString<RelayHealth>(body)
        }
    }

    private suspend fun openAppSocket(config: RelayConfig): Boolean =
        suspendCancellableCoroutine { cont ->
            val request = Request.Builder().url(config.appWebSocketUrl).build()
            val socket = client.newWebSocket(
                request,
                object : WebSocketListener() {
                    override fun onOpen(webSocket: WebSocket, response: Response) {
                        webSocket.close(1000, "health-check")
                        if (cont.isActive) cont.resume(true)
                    }

                    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                        if (cont.isActive) cont.resume(false)
                    }
                },
            )
            cont.invokeOnCancellation { socket.close(1000, "cancelled") }
        }
}

data class ConnectionCheck(
    val restOk: Boolean,
    val webSocketOk: Boolean,
    val health: RelayHealth?,
) {
    val connected: Boolean get() = restOk && webSocketOk
}
