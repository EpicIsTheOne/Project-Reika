package com.epic.reika.android.data

/**
 * Derives REST and WebSocket endpoints from a user-entered relay origin.
 *
 * The relay exposes its API under /v1 and accepts app WebSockets at /v1/app.
 * The user enters a base origin (e.g. "https://relay.example.com" or
 * "ws://127.0.0.1:8790"); everything else is derived from that.
 *
 * The WebSocket scheme mirrors the transport security of the origin:
 *   https:// or wss://  -> REST https://,  app socket wss://
 *   http://  or ws://   -> REST http://,   app socket ws://
 * This matters for self-hosted relays that run plain (non-TLS) HTTP.
 */
data class RelayConfig(
    val origin: String,
) {
    private val parsed = parse(origin)

    val restBase: String
        get() = parsed.restBase

    val appWebSocketUrl: String
        get() = parsed.appWebSocketUrl

    /** e.g. GET http(s)://relay.example.com/v1/health */
    fun healthUrl(): String = "$restBase/v1/health"

    /** e.g. GET http(s)://relay.example.com/v1/devices */
    fun devicesUrl(): String = "$restBase/v1/devices"

    /** e.g. POST http(s)://relay.example.com/v1/pairing/create */
    fun pairingCreateUrl(): String = "$restBase/v1/pairing/create"

    /** e.g. GET http(s)://relay.example.com/v1/pairing/{code} */
    fun pairingStatusUrl(code: String): String = "$restBase/v1/pairing/${code.trim()}"

    companion object {
        /**
         * Default relay for this deployment: the Reika Relay exposed publicly
         * at relay.techexplore.us (reverse-proxied to the relay on this server
         * via Traefik). Editable in-app. Confirmed live:
         * https://relay.techexplore.us/v1/health -> {ok:true,service:reika-relay}
         */
        const val DEFAULT_RELAY_ORIGIN = "https://relay.techexplore.us"

        fun fromRaw(value: String): RelayConfig? {
            val trimmed = value.trim().trimEnd('/')
            if (trimmed.isEmpty()) return null
            return RelayConfig(trimmed)
        }
    }
}

private data class Parsed(val restBase: String, val appWebSocketUrl: String)

private fun parse(raw: String): Parsed {
    val lower = raw.lowercase()
    val tls = lower.startsWith("https://") || lower.startsWith("wss://")
    val withoutScheme = lower
        .removePrefix("https://")
        .removePrefix("http://")
        .removePrefix("wss://")
        .removePrefix("ws://")
    val host = withoutScheme
        .replace(Regex("[?#].*$"), "")
        .replace(Regex("/v1/?$"), "")
        .replace(Regex("/+$"), "")
    val restScheme = if (tls) "https" else "http"
    val wsScheme = if (tls) "wss" else "ws"
    return Parsed(
        restBase = "$restScheme://$host",
        appWebSocketUrl = "$wsScheme://$host/v1/app",
    )
}
