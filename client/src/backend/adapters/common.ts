import type { AgentHubStatus } from "../../shared/agenthub";

export function slug(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1800);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(init?.headers ?? {})
      }
    });

    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function probeHealth(baseUrl: string, paths: string[]) {
  const trimmed = baseUrl.replace(/\/+$/, "");
  for (const path of paths) {
    const data = await fetchJson<Record<string, unknown>>(`${trimmed}${path}`);
    if (data) return { url: `${trimmed}${path}`, data };
  }

  return null;
}

export function statusFromHealth(data: Record<string, unknown> | null): AgentHubStatus {
  if (!data) return "offline";
  const rawStatus = String(data.status ?? data.state ?? data.health ?? "online").toLowerCase();
  if (rawStatus.includes("busy")) return "busy";
  if (rawStatus.includes("error") || rawStatus.includes("fail")) return "error";
  if (rawStatus.includes("connecting")) return "connecting";
  if (rawStatus.includes("offline") || rawStatus.includes("down")) return "offline";
  return "online";
}
