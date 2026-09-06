import type { Track } from "@shared/types/player";
import type { LyricFormat, LyricInput } from "@shared/types/lyrics";
import { buildDownloadLyric } from "@/utils/lyric/serialize";
import {
  resolveLocalRepoLyric,
  resolveStreamingLyric,
  type ResolvedLyric,
} from "@/services/lyric/resolve";

export interface DownloadLyric extends LyricInput {
  format: LyricFormat;
}

const toDownloadLyric = (lyric: ResolvedLyric): DownloadLyric => ({
  format: lyric.source.format,
  ...lyric.input,
});

const toUsableDownloadLyric = (lyric: ResolvedLyric | null): DownloadLyric | null => {
  if (!lyric) return null;
  const downloadLyric = toDownloadLyric(lyric);
  const hasContent =
    buildDownloadLyric(downloadLyric, downloadLyric.format, "lrc") ||
    buildDownloadLyric(downloadLyric, downloadLyric.format, "ttml");
  return hasContent ? downloadLyric : null;
};

/** Resolves lyrics only from the local repository or the connected streaming server. */
export const resolveDownloadLyric = async (track: Track): Promise<DownloadLyric | null> => {
  const local = toUsableDownloadLyric(await resolveLocalRepoLyric(track));
  if (local) return local;
  if (track.source !== "streaming") return null;
  return toUsableDownloadLyric(await resolveStreamingLyric(track));
};
