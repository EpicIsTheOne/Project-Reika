package com.epic.reika.android.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class RelayHealth(
    val ok: Boolean = false,
    val service: String? = null,
    @SerialName("accountId") val accountId: String? = null,
    @SerialName("deviceCount") val deviceCount: Int = 0,
    @SerialName("appSocketCount") val appSocketCount: Int = 0,
    @SerialName("deploymentMode") val deploymentMode: String? = null,
)

@Serializable
data class RelayDeviceSummary(
    val device: RelayDevice,
    @SerialName("activeProviderId") val activeProviderId: String? = null,
    @SerialName("providerCount") val providerCount: Int = 0,
    @SerialName("agentCount") val agentCount: Int = 0,
    @SerialName("projectCount") val projectCount: Int = 0,
    @SerialName("socketConnected") val socketConnected: Boolean = false,
    @SerialName("lastHeartbeatAt") val lastHeartbeatAt: String? = null,
)

@Serializable
data class RelayDevice(
    val id: String = "",
    val name: String? = null,
    val platform: String? = null,
    val status: String? = null,
    val providers: List<RelayProvider> = emptyList(),
)

@Serializable
data class RelayProvider(
    val id: String = "",
    val name: String? = null,
    val status: String? = null,
    val agents: List<RelayAgent> = emptyList(),
)

@Serializable
data class RelayAgent(
    val id: String = "",
    val name: String? = null,
    val status: String? = null,
)

@Serializable
data class RelayDevicesResponse(
    val ok: Boolean = false,
    val devices: List<RelayDeviceSummary> = emptyList(),
)

@Serializable
data class RelayPairing(
    val code: String = "",
    @SerialName("accountId") val accountId: String? = null,
    val status: String? = null,
    @SerialName("expiresAt") val expiresAt: String? = null,
    @SerialName("claimedAt") val claimedAt: String? = null,
    @SerialName("approvedAt") val approvedAt: String? = null,
    val deviceId: String? = null,
)

@Serializable
data class RelayPairingResponse(
    val ok: Boolean = false,
    val pairing: RelayPairing? = null,
    val device: RelayDevice? = null,
    val error: String? = null,
)
