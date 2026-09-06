export const exitFmMode = (): void => {};
export const skipFmTrack = async (): Promise<void> => {};
import type { Track } from "@shared/types/player";

export const start = async (_seed?: unknown): Promise<Track | null> => null;
export const dislikeCurrent = async (_playedSec?: number): Promise<Track | null> => null;
export const next = async (): Promise<Track | null> => null;
