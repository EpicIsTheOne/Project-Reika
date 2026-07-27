package com.epic.reika.android.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

private val Context.dataStore by preferencesDataStore(name = "reika_session")

/**
 * Persists the relay origin the user last connected to (and, later, the last
 * paired device id). On first launch the relay origin defaults to the
 * deployment's own Reika Relay so the app "just works" without typing a URL.
 */
@Singleton
class SessionPreferences @Inject constructor(private val context: Context) {
    val relayOrigin = context.dataStore.data
        .map { prefs -> prefs[KEY_RELAY_ORIGIN] ?: RelayConfig.DEFAULT_RELAY_ORIGIN }

    suspend fun saveRelayOrigin(origin: String) {
        context.dataStore.edit { prefs -> prefs[KEY_RELAY_ORIGIN] = origin }
    }

    suspend fun getRelayOrigin(): String = relayOrigin.first()

    companion object {
        private val KEY_RELAY_ORIGIN = stringPreferencesKey("relay_origin")
    }
}
