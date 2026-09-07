/**
 *
 */

import type { Artist, Track } from "./player";

export interface PlayEventInput {
  track: Track;
  startedAt: number;
  listenedMs: number;
}

export interface FavoriteEventInput {
  track: Track;
  action: "add" | "remove";
}

export interface PlayStatsSummary {
  todayListenedMs: number;
  weekListenedMs: number;
  lastWeekListenedMs: number;
  totalListenedMs: number;
  weekPlayCount: number;
  totalPlayCount: number;
  weekFavoriteAdds: number;
  streakDays: number;
}

export interface TopTrack {
  track: Track;
  playCount: number;
}

export interface LibraryStats {
  trackCount: number;
  albumCount: number;
  artistCount: number;
  totalDurationMs: number;
  totalFileSize: number;
  codecs: { codec: string; count: number }[];
}

export interface DailyPlayStats {
  day: string;
  playCount: number;
}

export interface HourlyPlayStats {
  hour: number;
  playCount: number;
}

export interface TopAlbum {
  track: Track;
  playCount: number;
}

export interface TopArtist {
  artist: Artist;
  track: Track;
  playCount: number;
}

export interface StatsApi {
  recordPlay: (event: PlayEventInput) => void;
  recordFavorite: (event: FavoriteEventInput) => void;
  getStatsSummary: () => Promise<PlayStatsSummary>;
  getTopTracks: (limit: number) => Promise<TopTrack[]>;
  getLibraryStats: () => Promise<LibraryStats>;
  getPlayHistoryDaily: (days: number) => Promise<DailyPlayStats[]>;
  getPlayHistoryHourly: () => Promise<HourlyPlayStats[]>;
  getTopAlbums: (limit: number) => Promise<TopAlbum[]>;
  getTopArtists: (limit: number) => Promise<TopArtist[]>;
}
