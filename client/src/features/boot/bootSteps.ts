import { Activity, Bell, Brush, CheckCircle2, Images, Link2, ShieldCheck, Users } from "lucide-react";
import type { BootStep } from "../../app/types";

export function createBootSteps(): BootStep[] {
  return [
    { id: "health", label: "Initializing", icon: Activity, state: "idle" },
    { id: "settings", label: "Loading Settings", icon: Brush, state: "idle" },
    { id: "art", label: "Loading Art Studio", icon: Images, state: "idle" },
    { id: "state", label: "Loading Agents", icon: Users, state: "idle" },
    { id: "notifications", label: "Syncing Notifications", icon: Bell, state: "idle" },
    { id: "uplink", label: "Checking Relay Uplink", icon: Link2, state: "idle" },
    { id: "startup", label: "Checking Startup", icon: ShieldCheck, state: "idle" },
    { id: "relay", label: "Finalizing", icon: CheckCircle2, state: "idle" }
  ];
}
