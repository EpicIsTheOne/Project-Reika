package com.epic.reika.android.ui.navigation

import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.epic.reika.android.ui.devices.DevicesScreen
import com.epic.reika.android.ui.pairing.PairingScreen
import com.epic.reika.android.ui.relay.RelayConfigScreen

object Routes {
    const val RELAY_CONFIG = "relay_config"
    const val DEVICES = "devices"
    const val PAIRING = "pairing"
}

@Composable
fun ReikaNavHost(
    navController: NavHostController = rememberNavController(),
) {
    NavHost(navController = navController, startDestination = Routes.RELAY_CONFIG) {
        composable(Routes.RELAY_CONFIG) {
            RelayConfigScreen(
                onConnected = { navController.navigate(Routes.DEVICES) },
            )
        }
        composable(Routes.DEVICES) {
            DevicesScreen(
                onAddDevice = { navController.navigate(Routes.PAIRING) },
            )
        }
        composable(Routes.PAIRING) {
            PairingScreen(
                onBack = { navController.popBackStack() },
                onPaired = { navController.popBackStack() },
            )
        }
    }
}
