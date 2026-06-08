import { useQuery } from "@tanstack/react-query";
import { api } from "../api/index.ts";

export interface InstanceSettings {
  staffbaseUrl: string | null;
  hasApiToken: boolean;
}

const DEFAULTS: InstanceSettings = {
  staffbaseUrl: null,
  hasApiToken: false,
};

/**
 * Returns the current instance's settings from /api/settings.
 * Falls back to safe defaults while loading or on error so consumers can
 * render without blocking on settings fetch.
 */
export function useInstanceSettings(): InstanceSettings {
  const { data } = useQuery<InstanceSettings>({
    queryKey: ["settings"],
    queryFn: () => api.get<InstanceSettings>("/api/settings").then((r) => r.data),
    // Settings rarely change — keep cache fresh for 5 minutes.
    staleTime: 5 * 60 * 1000,
  });

  return data ?? DEFAULTS;
}
