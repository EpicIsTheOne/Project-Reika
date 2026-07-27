package com.epic.reika.android.ui.devices

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.epic.reika.android.data.RelayDeviceSummary
import com.epic.reika.android.data.RelayRepository
import com.epic.reika.android.data.RelaySession
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class DevicesViewModel @Inject constructor(
    private val repository: RelayRepository,
    private val session: RelaySession,
) : ViewModel() {

    private val _devices = MutableStateFlow<List<RelayDeviceSummary>>(emptyList())
    val devices: StateFlow<List<RelayDeviceSummary>> = _devices.asStateFlow()

    private val _loading = MutableStateFlow(false)
    val loading: StateFlow<Boolean> = _loading.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    fun load() {
        val config = session.config ?: run {
            _error.value = "No relay configured. Go back and connect first."
            return
        }
        _loading.value = true
        _error.value = null
        viewModelScope.launch {
            runCatching { repository.listDevices(config) }
                .onSuccess { _devices.value = it }
                .onFailure { _error.value = it.message ?: "Failed to load devices." }
            _loading.value = false
        }
    }
}
