import logo from "../../assets/agenthub_phase1_generated/brand/agenthub_logo_icon_alpha.png";
import logoSmall from "../../assets/agenthub_phase1_generated/brand/agenthub_logo_icon_alpha_256.png";
import wordmark from "../../assets/agenthub_phase1_generated/brand/agenthub_wordmark_text_alpha.png";
import combined from "../../assets/agenthub_phase1_generated/brand/agenthub_combined_deterministic_alpha.png";
import chibi from "../../assets/agenthub_phase1_generated/character/reika/chibi.png";
import avatar from "../../assets/agenthub_phase1_generated/character/reika/circular_avatar_source.png";
import splash from "../../assets/agenthub_phase1_generated/character/reika/full_splash_illustration.png";
import halfBody from "../../assets/agenthub_phase1_generated/character/reika/half_body_portrait.png";
import expressionNeutral from "../../assets/agenthub_phase1_generated/character/reika/expressions/neutral.png";
import expressionHappy from "../../assets/agenthub_phase1_generated/character/reika/expressions/happy.png";
import expressionThinking from "../../assets/agenthub_phase1_generated/character/reika/expressions/thinking.png";
import expressionPlayful from "../../assets/agenthub_phase1_generated/character/reika/expressions/playful.png";
import roomFull from "../../assets/agenthub_phase1_generated/room/full_room_night.png";
import roomBlurred from "../../assets/agenthub_phase1_generated/room/blurred_ui_background.png";
import roomHero from "../../assets/agenthub_phase1_generated/room/hero_banner.png";
import loadingBackground from "../../assets/agenthub_phase1_generated/loading/loading_splash_background.png";
import bootBackdrop from "../../assets/agenthub_phase1_generated/loading/reika_boot_backdrop.png";
import loadingProgress from "../../assets/agenthub_phase1_generated/loading/progress_bar_alpha.png";
import noAgents from "../../assets/agenthub_phase1_generated/empty_states/no_agents_connected.png";
import noChat from "../../assets/agenthub_phase1_generated/empty_states/no_chat_history.png";
import devicePc from "../../assets/agenthub_phase1_generated/icons/devices/pc_alpha_256.png";
import deviceLaptop from "../../assets/agenthub_phase1_generated/icons/devices/laptop_alpha_256.png";
import deviceServer from "../../assets/agenthub_phase1_generated/icons/devices/vps_server_alpha_256.png";
import providerHermes from "../../assets/agenthub_phase1_generated/icons/providers/hermes_alpha_256.png";
import providerOpenClaw from "../../assets/agenthub_phase1_generated/icons/providers/openclaw_alpha_256.png";
import statusOnline from "../../assets/agenthub_phase1_generated/icons/status/online_alpha.png";
import statusOffline from "../../assets/agenthub_phase1_generated/icons/status/offline_alpha.png";
import glow from "../../assets/agenthub_phase1_generated/decorative/blue_glow_overlay_alpha.png";
import glass from "../../assets/agenthub_phase1_generated/decorative/glass_panel_texture_alpha.png";
import noise from "../../assets/agenthub_phase1_generated/decorative/subtle_noise_texture_alpha.png";

export const assets = {
  brand: {
    logo,
    logoSmall,
    wordmark,
    combined
  },
  reika: {
    chibi,
    avatar,
    splash,
    halfBody,
    expressions: {
      neutral: expressionNeutral,
      happy: expressionHappy,
      thinking: expressionThinking,
      playful: expressionPlayful
    }
  },
  room: {
    full: roomFull,
    blurred: roomBlurred,
    hero: roomHero
  },
  loading: {
    background: loadingBackground,
    bootBackdrop,
    progress: loadingProgress
  },
  empty: {
    noAgents,
    noChat
  },
  icons: {
    devices: {
      pc: devicePc,
      laptop: deviceLaptop,
      server: deviceServer,
      phone: deviceLaptop,
      unknown: deviceServer
    },
    providers: {
      Hermes: providerHermes,
      OpenClaw: providerOpenClaw,
      CommandCenter: providerOpenClaw,
      Mock: providerOpenClaw,
      Custom: providerOpenClaw
    },
    status: {
      online: statusOnline,
      offline: statusOffline
    }
  },
  decorative: {
    glow,
    glass,
    noise
  }
} as const;
