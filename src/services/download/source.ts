import type { Track } from "@shared/types/player";
import type { QualityLevel } from "@/utils/quality";
import { useStreamingStore } from "@/stores/streaming";

export interface DownloadSource {
  url: string;
  format?: string;
  size?: number;
}

export const resolveDownloadSource = async (
  track: Track,
  _level: QualityLevel,
  _usePlaybackForDownload: boolean,
): Promise<DownloadSource | null> => {
  if (track.source !== "streaming") return null;
  try {
    return {
      url: await useStreamingStore().getStreamUrl(track, { playSessionId: crypto.randomUUID() }),
    };
  } catch {
    return null;
  }
};
