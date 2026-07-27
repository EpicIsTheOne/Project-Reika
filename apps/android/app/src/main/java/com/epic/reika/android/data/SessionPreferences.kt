package com.epic.reika.android.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "reika_session")

class SessionPreferences(private val context: Context) {
    private val relayOriginKey = stringPreferencesKey("relay_origin")
    private val lastDeviceIdKey = stringPreferencesKey("last_device_id")

    val relayOrigin: Flow<String?> = context.dataStore.data.map { it[relayOriginKey] }
    val lastDeviceId: Flow<String?> = context.dataStore.data.map { it[lastDeviceIdKey] }

    suspend fun saveRelayOrigin(origin: String) {
        context.dataStore.edit { it[relayOriginKey] = origin }
    }

    suspend fun saveLastDeviceId(deviceId: String) {
        context.dataStore.edit { it[lastDeviceIdKey] = deviceId }
    }
}
