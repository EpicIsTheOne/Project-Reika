package com.epic.reika.android.ui.relay

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.epic.reika.android.data.ConnectionCheck
import com.epic.reika.android.data.RelayConfig
import com.epic.reika.android.data.RelayRepository
import com.epic.reika.android.data.SessionPreferences
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class RelayConfigViewModel @Inject constructor(
    private val repository: RelayRepository,
    private val session: SessionPreferences,
    private val relaySession: RelaySession,
) : ViewModel() {

    private val _url = MutableStateFlow("")
    val url: StateFlow<String> = _url.asStateFlow()

    private val _state = MutableStateFlow<ConfigState>(ConfigState.Idle)
    val state: StateFlow<ConfigState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            _url.value = session.relayOrigin.first().orEmpty()
        }
    }

    fun onUrlChange(value: String) {
        _url.value = value
    }

    fun testConnection() {
        val config = RelayConfig.fromRaw(_url.value) ?: run {
            _state.value = ConfigState.Error("Enter a relay URL first.")
            return
        }
        _state.value = ConfigState.Testing
        viewModelScope.launch {
            val check = repository.checkConnection(config)
            if (check.connected) {
                session.saveRelayOrigin(config.origin)
                relaySession.setRelay(config)
                _state.value = ConfigState.Connected(check)
            } else {
                _state.value = ConfigState.Error(buildErrorMessage(check))
            }
        }
    }

    private fun buildErrorMessage(check: ConnectionCheck): String {
        return when {
            !check.restOk && !check.webSocketOk ->
                "Could not reach the relay. Check the URL and that the relay is running."
            !check.restOk ->
                "Relay REST API is unreachable (is the relay up?)."
            else ->
                "Relay REST answered but the app WebSocket (/v1/app) would not open."
        }
    }

    sealed interface ConfigState {
        data object Idle : ConfigState
        data object Testing : ConfigState
        data class Connected(val check: ConnectionCheck) : ConfigState
        data class Error(val message: String) : ConfigState
    }
}
