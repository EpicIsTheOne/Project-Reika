package com.epic.reika.android.data

/**
 * Derives REST and WebSocket endpoints from a user-entered relay origin.
 *
 * The relay exposes its API under /v1 and accepts app WebSockets at /v1/app.
 * The user enters a base origin (e.g. "https://relay.example.com" or
 * "ws://127.0.0.1:8790"); everything else is derived from that.
 */
data class RelayConfig(
    val origin: String,
) {
    val restBase: String
        get() = normalize(origin, "https", "")

    val appWebSocketUrl: String
        get() = normalize(origin, "wss", "app")

    /** e.g. GET https://relay.example.com/v1/health */
    fun healthUrl(): String = "$restBase/v1/health"

    /** e.g. GET https://relay.example.com/v1/devices */
    fun devicesUrl(): String = "$restBase/v1/devices"

    /** e.g. POST https://relay.example.com/v1/pairing/create */
    fun pairingCreateUrl(): String = "$restBase/v1/pairing/create"

    /** e.g. GET https://relay.example.com/v1/pairing/{code} */
    fun pairingStatusUrl(code: String): String = "$restBase/v1/pairing/${code.trim()}"

    companion object {
        fun fromRaw(value: String): RelayConfig? {
            val trimmed = value.trim().trimEnd('/')
            if (trimmed.isEmpty()) return null
            return RelayConfig(trimmed)
        }
    }
}

private fun normalize(raw: String, scheme: String, endpoint: String): String {
    // Allow ws:// / wss:// / http(s):// inputs; force the requested scheme family.
    val base = raw
        .replace(Regex("^wss?://", RegexOption.IGNORECASE), "https://")
        .replace(Regex("^https?://", RegexOption.IGNORECASE), "https://")
    val withoutQuery = base.replace(Regex("[?#].*$"), "")
    val stripped = withoutQuery.replace(Regex("/v1/?$"), "").replace(Regex("/+$"), "")
    val wsScheme = if (scheme == "wss") "wss://" else "https://"
    val httpScheme = "https://"
    val path = if (endpoint.isEmpty()) "" else "/v1/$endpoint"
    return if (scheme == "wss") "$wsScheme${stripped.removePrefix("https://")}$path"
    else "$httpScheme${stripped.removePrefix("https://")}$path"
}
