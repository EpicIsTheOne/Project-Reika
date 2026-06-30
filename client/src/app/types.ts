import type { ElementType } from "react";

export type BackendMode = "loading" | "live" | "fallback";
export type BootStepState = "idle" | "active" | "done" | "error";

export interface BootStep {
  id: "health" | "settings" | "art" | "state" | "notifications" | "uplink" | "startup" | "relay";
  label: string;
  icon: ElementType;
  state: BootStepState;
  detail?: string;
}
