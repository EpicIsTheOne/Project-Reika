import { assets } from "./assets";
import type { CharacterProfile, ChatMessage, Device } from "../types";

export const reikaProfile: CharacterProfile = {
  id: "reika",
  displayName: "Reika",
  shortDescription: "Hermes agent for system management, retrieval, and calm tactical judgment.",
  providerId: "hermes-local",
  deviceId: "epic-pc",
  avatarPath: assets.reika.avatar,
  splashPath: assets.reika.splash,
  halfBodyPath: assets.reika.halfBody,
  chibiPath: assets.reika.chibi,
  roomBackgroundPath: assets.room.full,
  themeColor: "#4D8DFF",
  defaultExpression: "neutral",
  availableExpressions: assets.reika.expressions,
  statusMessages: {
    online: "Already monitoring the local stack.",
    thinking: "Tracing the cleanest path.",
    busy: "Working. Quietly, for once.",
    offline: "Connection sleeping.",
    error: "Something is dressed up as a bug."
  }
};

export const devices: Device[] = [
  {
    id: "epic-pc",
    name: "Epic PC",
    type: "pc",
    status: "online",
    location: "Local",
    providers: [
      {
        id: "hermes-local",
        name: "Hermes",
        deviceId: "epic-pc",
        status: "online",
        latency: "12 ms",
        agents: [
          {
            id: "reika",
            name: "Reika",
            providerId: "hermes-local",
            deviceId: "epic-pc",
            role: "Personal assistant",
            status: "online",
            lastActivity: "Standing by",
            characterId: "reika"
          }
        ]
      },
      {
        id: "openclaw-local",
        name: "OpenClaw",
        deviceId: "epic-pc",
        status: "busy",
        latency: "28 ms",
        agents: [
          {
            id: "local-assistant",
            name: "Local Assistant",
            providerId: "openclaw-local",
            deviceId: "epic-pc",
            role: "Mock agent",
            status: "busy",
            lastActivity: "Indexing mock context",
            characterId: "local"
          }
        ]
      }
    ]
  },
  {
    id: "hostinger-vps",
    name: "Hostinger VPS",
    type: "server",
    status: "online",
    location: "Remote",
    providers: [
      {
        id: "openclaw-vps",
        name: "OpenClaw",
        deviceId: "hostinger-vps",
        status: "online",
        latency: "34 ms",
        agents: [
          {
            id: "astra",
            name: "Astra",
            providerId: "openclaw-vps",
            deviceId: "hostinger-vps",
            role: "Mission control agent",
            status: "online",
            lastActivity: "Monitoring remote stack",
            characterId: "astra"
          },
          {
            id: "miyabi",
            name: "Miyabi",
            providerId: "openclaw-vps",
            deviceId: "hostinger-vps",
            role: "Remote assistant",
            status: "online",
            lastActivity: "Ready",
            characterId: "miyabi"
          }
        ]
      },
      {
        id: "hermes-vps",
        name: "Hermes",
        deviceId: "hostinger-vps",
        status: "online",
        latency: "41 ms",
        agents: [
          {
            id: "nyxie",
            name: "Nyxie",
            providerId: "hermes-vps",
            deviceId: "hostinger-vps",
            role: "Remote Hermes agent",
            status: "online",
            lastActivity: "Quietly observing",
            characterId: "nyxie"
          }
        ]
      }
    ]
  },
  {
    id: "epic-laptop",
    name: "Laptop",
    type: "laptop",
    status: "offline",
    location: "LAN",
    providers: [
      {
        id: "hermes-laptop",
        name: "Hermes",
        deviceId: "epic-laptop",
        status: "offline",
        latency: "--",
        agents: []
      },
      {
        id: "openclaw-laptop",
        name: "OpenClaw",
        deviceId: "epic-laptop",
        status: "offline",
        latency: "--",
        agents: []
      }
    ]
  }
];

export const chatMessages: ChatMessage[] = [];
