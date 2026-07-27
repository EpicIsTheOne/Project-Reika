package com.epic.reika.android.data

import org.junit.Assert.assertEquals
import org.junit.Test

class RelayConfigTest {

    @Test
    fun derivesRestAndWebSocketFromHttpsOrigin() {
        val config = RelayConfig.fromRaw("https://relay.example.com")!!
        assertEquals("https://relay.example.com/v1/health", config.healthUrl())
        assertEquals("https://relay.example.com/v1/devices", config.devicesUrl())
        assertEquals("wss://relay.example.com/v1/app", config.appWebSocketUrl)
    }

    @Test
    fun derivesFromWsOrigin() {
        val config = RelayConfig.fromRaw("ws://127.0.0.1:8790")!!
        assertEquals("https://127.0.0.1:8790/v1/health", config.healthUrl())
        assertEquals("wss://127.0.0.1:8790/v1/app", config.appWebSocketUrl)
    }

    @Test
    fun stripsTrailingSlashAndV1() {
        val config = RelayConfig.fromRaw("https://relay.example.com/v1/")!!
        assertEquals("https://relay.example.com/v1/health", config.healthUrl())
        assertEquals("wss://relay.example.com/v1/app", config.appWebSocketUrl)
    }

    @Test
    fun nullForBlank() {
        assertEquals(null, RelayConfig.fromRaw("   "))
    }
}
