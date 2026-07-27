package com.epic.reika.android.ui.pairing

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PairingScreen(
    viewModel: PairingViewModel = hiltViewModel(),
    onBack: () -> Unit = {},
    onPaired: () -> Unit = {},
) {
    val code by viewModel.code.collectAsStateWithLifecycle()
    val statusText by viewModel.statusText.collectAsStateWithLifecycle()
    val state by viewModel.state.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) {
        if (state is PairingViewModel.PairingUiState.Idle) viewModel.start()
    }
    LaunchedEffect(state) {
        if (state is PairingViewModel.PairingUiState.Approved) onPaired()
    }

    Scaffold(
        topBar = { TopAppBar(title = { Text("Pair a device") }) },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text("Pairing code", style = MaterialTheme.typography.titleMedium)
            if (code != null) {
                Text(
                    text = code!!,
                    style = MaterialTheme.typography.displaySmall,
                    color = MaterialTheme.colorScheme.primary,
                    textAlign = TextAlign.Center,
                )
                Text(
                    "On the Reika Node, run the install script with this code, " +
                        "then approve it in the relay/devices UI.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (state is PairingViewModel.PairingUiState.Creating) {
                CircularProgressIndicator()
            }
            Text(statusText, style = MaterialTheme.typography.bodySmall)

            OutlinedButton(onClick = onBack, modifier = Modifier.fillMaxWidth()) {
                Text("Back")
            }
            if (state is PairingViewModel.PairingUiState.Approved) {
                Button(onClick = onPaired, modifier = Modifier.fillMaxWidth()) {
                    Text("Done")
                }
            }
            if (state is PairingViewModel.PairingUiState.Error) {
                Text(
                    (state as PairingViewModel.PairingUiState.Error).message,
                    color = MaterialTheme.colorScheme.error,
                )
            }
        }
    }
}
