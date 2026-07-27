package com.epic.reika.android.ui.relay

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@Composable
fun RelayConfigScreen(
    viewModel: RelayConfigViewModel = hiltViewModel(),
    onConnected: () -> Unit = {},
) {
    val url by viewModel.url.collectAsStateWithLifecycle()
    val state by viewModel.state.collectAsStateWithLifecycle()

    // Once connected, advance to the device roster.
    LaunchedEffect(state) {
        if (state is RelayConfigViewModel.ConfigState.Connected) onConnected()
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            text = "REIKA",
            style = MaterialTheme.typography.displaySmall,
            color = MaterialTheme.colorScheme.primary,
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = "Your Reika ecosystem, in your pocket.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(modifier = Modifier.height(32.dp))

        OutlinedTextField(
            value = url,
            onValueChange = viewModel::onUrlChange,
            label = { Text("Relay URL") },
            placeholder = { Text("https://relay.techexplore.us  (default)") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(modifier = Modifier.height(16.dp))

        Button(
            onClick = viewModel::testConnection,
            enabled = url.isNotBlank() && state !is RelayConfigViewModel.ConfigState.Testing,
            modifier = Modifier.fillMaxWidth(),
        ) {
            if (state is RelayConfigViewModel.ConfigState.Testing) {
                CircularProgressIndicator(modifier = Modifier.height(20.dp))
            } else {
                Text("Test connection")
            }
        }
        Spacer(modifier = Modifier.height(16.dp))

        when (val s = state) {
            is RelayConfigViewModel.ConfigState.Connected -> {
                val health = s.check.health
                Text(
                    text = "Connected" + (health?.let { " — ${it.deviceCount} device(s), account ${it.accountId}" } ?: ""),
                    color = MaterialTheme.colorScheme.primary,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            is RelayConfigViewModel.ConfigState.Error -> {
                Text(
                    text = s.message,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            else -> Unit
        }
        Spacer(modifier = Modifier.height(24.dp))

        Text(
            text = "Reika connects only to a relay you control. Your devices, agents, " +
                "and conversations stay on your own Reika Nodes — this app is a " +
                "secure remote control surface, not a cloud chatbot.",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}
