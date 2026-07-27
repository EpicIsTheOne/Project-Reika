package com.epic.reika.android.ui.pairing

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.epic.reika.android.data.RelayRepository
import com.epic.reika.android.data.RelaySession
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class PairingViewModel @Inject constructor(
    private val repository: RelayRepository,
    private val session: RelaySession,
) : ViewModel() {

    private val _code = MutableStateFlow<String?>(null)
    val code: StateFlow<String?> = _code.asStateFlow()

    private val _statusText = MutableStateFlow("")
    val statusText: StateFlow<String> = _statusText.asStateFlow()

    private val _state = MutableStateFlow<PairingUiState>(PairingUiState.Idle)
    val state: StateFlow<PairingUiState> = _state.asStateFlow()

    fun start() {
        val config = session.config ?: run {
            _state.value = PairingUiState.Error("No relay configured.")
            return
        }
        _state.value = PairingUiState.Creating
        viewModelScope.launch {
            val pairing = runCatching { repository.createPairing(config) }.getOrNull()
            if (pairing == null) {
                _state.value = PairingUiState.Error("Could not create a pairing code.")
                return@launch
            }
            _code.value = pairing.code
            _statusText.value = "Waiting for the device to claim this code…"
            poll(config, pairing.code)
        }
    }

    private suspend fun poll(config: com.epic.reika.android.data.RelayConfig, code: String) {
        var claimed = false
        while (viewModelScope.isActive) {
            val status = runCatching { repository.pairingStatus(config, code) }.getOrNull()
            when (status?.pairing?.status) {
                "claimed" -> {
                    claimed = true
                    _statusText.value = "Device claimed — approve it in the relay/devices UI to finish."
                }
                "approved" -> {
                    _state.value = PairingUiState.Approved
                    return
                }
                else -> if (!claimed) {
                    _statusText.value = "Waiting for the device to claim this code…"
                }
            }
            delay(2500)
        }
    }

    sealed interface PairingUiState {
        data object Idle : PairingUiState
        data object Creating : PairingUiState
        data object Approved : PairingUiState
        data class Error(val message: String) : PairingUiState
    }
}
