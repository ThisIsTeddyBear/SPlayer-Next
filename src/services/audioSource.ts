import type { Track } from "@shared/types/player";
import { useStreamingStore } from "@/stores/streaming";

export interface ResolveTrackSourceOptions {
  streamingPlaySessionId?: string;
  skipOfficialOnline?: boolean;
  silent?: boolean;
  skipPluginIds?: readonly string[];
}

export interface ResolvedTrackSource {
  source: string;
  fromCache: boolean;
  provider: "local" | "streaming" | "cache" | "official" | "plugin" | "trial";
  pluginId?: string;
  cacheRequest?: () => Promise<void>;
}

export const resolveTrackSource = async (
  track: Track,
  options: ResolveTrackSourceOptions = {},
): Promise<ResolvedTrackSource | null> => {
  if (track.source === "local") {
    const source = track.cueAudioPath ?? track.path;
    return source ? { source, fromCache: false, provider: "local" } : null;
  }
  if (track.source !== "streaming") return null;
  try {
    const source = await useStreamingStore().getStreamUrl(
      track,
      options.streamingPlaySessionId
        ? { playSessionId: options.streamingPlaySessionId }
        : undefined,
    );
    return { source, fromCache: false, provider: "streaming" };
  } catch {
    return null;
  }
};
