package com.epic.reika.android.data

import javax.inject.Singleton

/**
 * Holds the relay configuration for the current session. Set after a
 * successful connection test so downstream screens (devices, pairing) can
 * call the relay without re-entering the URL.
 */
@Singleton
class RelaySession {
    var config: RelayConfig? = null
        private set

    fun setRelay(config: RelayConfig) {
        this.config = config
    }
}
