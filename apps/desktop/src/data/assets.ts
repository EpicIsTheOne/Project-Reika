import logo from "../../assets/reika_phase1_webp/brand/reika_logo_icon_alpha.webp";
import logoSmall from "../../assets/reika_phase1_webp/brand/reika_logo_icon_alpha_256.webp";
import wordmark from "../../assets/reika_phase1_webp/brand/reika_wordmark.svg";
import combined from "../../assets/reika_phase1_webp/brand/reika_lockup.svg";
import chibi from "../../assets/reika_phase1_webp/character/reika/chibi.webp";
import avatar from "../../assets/reika_phase1_webp/character/reika/circular_avatar_source.webp";
import splash from "../../assets/reika_phase1_webp/character/reika/full_splash_illustration.webp";
import halfBody from "../../assets/reika_phase1_webp/character/reika/half_body_portrait.webp";
import expressionNeutral from "../../assets/reika_phase1_webp/character/reika/expressions/neutral.webp";
import expressionHappy from "../../assets/reika_phase1_webp/character/reika/expressions/happy.webp";
import expressionThinking from "../../assets/reika_phase1_webp/character/reika/expressions/thinking.webp";
import expressionPlayful from "../../assets/reika_phase1_webp/character/reika/expressions/playful.webp";
import roomFull from "../../assets/reika_phase1_webp/room/full_room_night.webp";
import roomBlurred from "../../assets/reika_phase1_webp/room/blurred_ui_background.webp";
import roomHero from "../../assets/reika_phase1_webp/room/hero_banner.webp";
import loadingBackground from "../../assets/reika_phase1_webp/loading/loading_splash_background.webp";
import bootBackdrop from "../../assets/reika_phase1_webp/loading/reika_boot_backdrop.webp";
import loadingProgress from "../../assets/reika_phase1_webp/loading/progress_bar_alpha.webp";
import noAgents from "../../assets/reika_phase1_webp/empty_states/no_agents_connected.webp";
import noChat from "../../assets/reika_phase1_webp/empty_states/no_chat_history.webp";
import devicePc from "../../assets/reika_phase1_webp/icons/devices/pc_alpha_256.webp";
import deviceLaptop from "../../assets/reika_phase1_webp/icons/devices/laptop_alpha_256.webp";
import deviceServer from "../../assets/reika_phase1_webp/icons/devices/vps_server_alpha_256.webp";
import providerHermes from "../../assets/reika_phase1_webp/icons/providers/hermes_alpha_256.webp";
import providerOpenClaw from "../../assets/reika_phase1_webp/icons/providers/openclaw_alpha_256.webp";
import statusOnline from "../../assets/reika_phase1_webp/icons/status/online_alpha.webp";
import statusOffline from "../../assets/reika_phase1_webp/icons/status/offline_alpha.webp";
import glow from "../../assets/reika_phase1_webp/decorative/blue_glow_overlay_alpha.webp";
import glass from "../../assets/reika_phase1_webp/decorative/glass_panel_texture_alpha.webp";
import noise from "../../assets/reika_phase1_webp/decorative/subtle_noise_texture_alpha.webp";

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
