import { extname } from "node:path";
import { app, ipcMain, powerMonitor } from "electron";
import { sendToMain } from "@main/utils/broadcast";
import { readFileAutoEncoding } from "@main/utils/encoding";
import { wsBroadcast } from "@main/server/broadcast";
import { toCacheUrl } from "@main/utils/protocol";
import { toMs } from "@main/utils/time";
import * as mediaService from "@main/services/media";
import * as nowPlaying from "@main/services/nowPlaying";
import { fetchBytes } from "@main/utils/fetchBytes";
import { getPlayer, resetPlayer, onPlayerCreated } from "@main/services/engine";
import {
  cancelPendingReinit,
  setPauseOnDeviceSwitch,
  startDeviceMonitoring,
  stopDeviceMonitoring,
  requestReinit,
} from "@main/services/device";
import { getThumbar } from "@main/services/thumbar";
import {
  setTraySongName,
  setTrayPlayState,
  setTrayPlayMode,
  setTrayLikeState,
} from "@main/services/tray";
import { setTaskbarThumbnailCover } from "@main/services/thumbnail";
import { getMainWindow, setTaskbarProgress } from "@main/window";
import { store } from "@main/store";
import { appName, getSongCacheDir } from "@main/utils/config";
import * as songCache from "@main/services/songCache";
import { parseArtists, parseAlbum, formatArtists } from "@main/utils/metadata";
import { playerLog } from "@main/utils/logger";
import { ErrorCode } from "@shared/types/errors";
import type { LoadOptions, RepeatMode, ShuffleMode, PlayerState } from "@shared/types/player";
import type { MediaEvent } from "@main/services/media";
import { JsPlayerEvent } from "@splayer/audio-engine";

type AudioEngineModule = typeof import("@splayer/audio-engine");

interface CueRange {
  startMs: number;
  durationMs: number;
}

let activeCueRange: CueRange | null = null;

const cueRangeFromTrack = (track: LoadOptions["meta"] | null | undefined): CueRange | null => {
  const start = track?.cueStartMs;
  const end = track?.cueEndMs;
  if (start == null || end == null || end <= start) return null;
  return { startMs: start, durationMs: end - start };
};

const toDisplayPositionMs = (positionMs: number): number => {
  if (!activeCueRange) return positionMs;
  return Math.max(0, Math.min(activeCueRange.durationMs, positionMs - activeCueRange.startMs));
};

const toDisplayDurationMs = (durationMs: number): number =>
  activeCueRange?.durationMs ?? durationMs;

const toEnginePositionMs = (positionMs: number): number =>
  activeCueRange ? activeCueRange.startMs + positionMs : positionMs;

const fail = (code: ErrorCode, error?: unknown) => {
  if (error) playerLog.error(`${code}:`, error);
  return { success: false as const, error: code };
};

const isNativeDeviceError = (error: unknown): boolean => String(error).includes("[Device]");
const isNativeSourceNotFoundError = (error: unknown): boolean =>
  String(error).includes("[SourceNotFound]");
const isNativeNetworkError = (error: unknown): boolean =>
  String(error).includes("[NetworkUnreachable]");
const isNativeCancelledError = (error: unknown): boolean => String(error).includes("[Cancelled]");

const classifyLoadError = (error: unknown, source: string): ErrorCode => {
  const msg = error instanceof Error ? error.message : String(error);
  if (isNativeCancelledError(error)) {
    return ErrorCode.LOAD_SUPERSEDED;
  }
  if (isNativeDeviceError(error) || /output device|NoDevice|DeviceNotAvailable/i.test(msg)) {
    return ErrorCode.DEVICE_NOT_FOUND;
  }
  if (isNativeSourceNotFoundError(error)) {
    return ErrorCode.FILE_NOT_FOUND;
  }
  if (isNativeNetworkError(error) || /^https?:\/\//i.test(source)) {
    return ErrorCode.NETWORK_ERROR;
  }
  return ErrorCode.FILE_DECODE_ERROR;
};

/**
 */
const registerNativeEvents = (inst: InstanceType<AudioEngineModule["AudioPlayer"]>): void => {
  inst.onEvent((event: JsPlayerEvent) => {
    switch (event.type) {
      case "stateChanged": {
        const state = (event.state ?? "idle") as PlayerState;
        getThumbar()?.updateThumbar(state === "playing");
        setTrayPlayState(state === "playing" ? "playing" : "paused");
        if (state === "playing") {
          mediaService.setPlayState({ status: "Playing" });
        } else if (state === "paused") {
          mediaService.setPlayState({ status: "Paused" });
          if (store.get("system.taskbarProgress")) {
            const dur = toDisplayDurationMs(toMs(inst.getDuration()));
            const pos = toDisplayPositionMs(toMs(inst.getPosition()));
            if (dur > 0) setTaskbarProgress(pos / dur, true);
          }
        } else if (state === "stopped") {
          mediaService.setPlayState({ status: "Paused" });
          setTaskbarProgress(-1);
        }
        nowPlaying.onPlayStateChange(state);
        const statusEvent = {
          type: "status",
          data: {
            state,
            position: toDisplayPositionMs(toMs(inst.getPosition())),
            duration: toDisplayDurationMs(toMs(inst.getDuration())),
            volume: inst.getVolume(),
            speed: inst.getSpeed(),
            isFinished: false,
            bitPerfectActive: inst.getStatus().bitPerfectActive,
          },
        };
        sendToMain("player:event", statusEvent);
        wsBroadcast(statusEvent);
        break;
      }
      case "ended": {
        sendToMain("player:event", { type: "ended" });
        wsBroadcast({ type: "ended" });
        mediaService.setPlayState({ status: "Paused" });
        setTaskbarProgress(-1);
        break;
      }
      case "sourceError": {
        sendToMain("player:event", { type: "sourceError" });
        mediaService.setPlayState({ status: "Paused" });
        setTaskbarProgress(-1);
        break;
      }
      case "position": {
        const posMs = toDisplayPositionMs(toMs(event.position ?? 0));
        const durMs = toDisplayDurationMs(toMs(event.duration ?? 0));
        const positionEvent = {
          type: "position",
          data: { position: posMs, duration: durMs },
        };
        if (getMainWindow()?.isVisible()) sendToMain("player:event", positionEvent);
        wsBroadcast(positionEvent);
        mediaService.setTimeline({ currentMs: posMs, totalMs: durMs });
        nowPlaying.onPosition(posMs, true);
        if (store.get("system.taskbarProgress") && durMs > 0) setTaskbarProgress(posMs / durMs);
        break;
      }
      case "fftData": {
        const fftEvent = { type: "fftData", data: event.fftData ?? { ldata: [], rdata: [] } };
        if (getMainWindow()?.isVisible()) sendToMain("player:event", fftEvent);
        wsBroadcast(fftEvent);
        break;
      }
      case "outputFailed": {
        playerLog.warn("Detected audio output stream error; starting recovery");
        requestReinit(inst);
        break;
      }
      case "outputStalled": {
        playerLog.warn("Detected stalled audio output; starting recovery");
        requestReinit(inst);
        break;
      }
    }
  });
};

let loadSeq = 0;

export const registerPlayerIpc = (): void => {
  onPlayerCreated(registerNativeEvents);
  onPlayerCreated(startDeviceMonitoring);
  ipcMain.handle("player:load", async (_event, source: string, options: LoadOptions = {}) => {
    cancelPendingReinit();
    const autoPlay = options.autoPlay ?? true;
    const authoritative = options.meta ?? null;
    const cueRange = cueRangeFromTrack(authoritative);
    activeCueRange = cueRange;
    const isRemote = authoritative != null && authoritative.source !== "local";
    const seq = ++loadSeq;
    try {
      const inst = getPlayer();
      const loadingEvent = {
        type: "status",
        data: {
          state: "loading",
          position: 0,
          duration: 0,
          volume: inst.getVolume(),
          speed: inst.getSpeed(),
          isFinished: false,
          bitPerfectActive: inst.getStatus().bitPerfectActive,
        },
      };
      sendToMain("player:event", loadingEvent);
      wsBroadcast(loadingEvent);
      const remoteCover =
        authoritative && authoritative.source !== "local"
          ? (authoritative.coverOriginal ?? authoritative.cover)
          : undefined;
      const coverFetchUrl =
        remoteCover && /^(https?|streaming-cover):\/\//i.test(remoteCover)
          ? remoteCover
          : undefined;
      const coverUrl =
        coverFetchUrl && /^https?:\/\//i.test(coverFetchUrl) ? coverFetchUrl : undefined;
      const applyDisplay = (
        title: string,
        artist: string,
        album: string,
        coverData: Buffer | undefined,
        durationMs: number,
      ): void => {
        const header = artist ? `${title} - ${artist}` : title || appName;
        mediaService.setMetadata({ title, artist, album, coverData, coverUrl, durationMs });
        mediaService.setPlayState({ status: autoPlay ? "Playing" : "Paused" });
        getMainWindow()?.setTitle(header);
        setTraySongName(header);
        setTrayPlayState(autoPlay ? "playing" : "paused");
      };
      if (authoritative) {
        applyDisplay(
          authoritative.title || source.split(/[/\\]/).pop() || source,
          formatArtists(authoritative.artists ?? []),
          authoritative.album?.name ?? "",
          undefined,
          authoritative.duration ?? 0,
        );
      } else {
        applyDisplay(source.split(/[/\\]/).pop() || source, "", "", undefined, 0);
      }
      const meta = await inst.load(source, cueRange ? false : autoPlay);
      if (cueRange) {
        await inst.seek(cueRange.startMs / 1000);
        if (autoPlay) await inst.play();
      }
      const nativeDurationMs = toMs(meta.duration);
      const durationMs = toDisplayDurationMs(nativeDurationMs);
      const fallbackTitle = meta.title || source.split(/[/\\]/).pop() || source;
      const displayTitle = authoritative?.title ?? fallbackTitle;
      const displayArtist = authoritative
        ? formatArtists(authoritative.artists ?? [])
        : formatArtists(parseArtists(meta.artist ?? ""));
      const displayAlbum = authoritative?.album?.name ?? parseAlbum(meta.album ?? "")?.name ?? "";
      const localCover = isRemote ? null : (inst.getCoverRaw() ?? null);
      applyDisplay(displayTitle, displayArtist, displayAlbum, localCover ?? undefined, durationMs);
      if (!isRemote) setTaskbarThumbnailCover(meta.cover);
      // Last.fm
      if (coverFetchUrl) {
        void fetchBytes(coverFetchUrl).then((buf) => {
          if (!buf) return;
          if (seq !== loadSeq) return;
          mediaService.setMetadata({
            title: displayTitle,
            artist: displayArtist,
            album: displayAlbum,
            coverData: buf,
            coverUrl,
            durationMs,
          });
          setTaskbarThumbnailCover(buf);
        });
      }
      const quality = {
        sampleRate: meta.originalSampleRate,
        channels: meta.channels,
        bitsPerSample: meta.bitsPerSample,
        bitRate: meta.bitRate,
        codec: meta.codec,
      };
      const data = {
        detail: {
          quality,
          embeddedLyric: meta.embeddedLyric,
          externalLyrics: meta.externalLyrics,
        },
        mediaInfo: {
          title: meta.title || displayTitle,
          artists: authoritative?.artists?.length
            ? authoritative.artists
            : parseArtists(meta.artist ?? ""),
          album: authoritative?.album ?? parseAlbum(meta.album ?? ""),
          duration: durationMs,
          cover: isRemote ? undefined : toCacheUrl(meta.cover),
          quality,
        },
      };
      playerLog.debug(`Loaded successfully: ${displayTitle}`);
      return { success: true, data };
    } catch (error) {
      if (seq === loadSeq) activeCueRange = null;
      const code = classifyLoadError(error, source);
      if (code === ErrorCode.FILE_DECODE_ERROR && source.startsWith(getSongCacheDir())) {
        void songCache.invalidate(source);
      }
      return fail(code, error);
    }
  });

  ipcMain.handle("player:play", async () => {
    try {
      await getPlayer().play();
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.DEVICE_NOT_FOUND, error);
    }
  });

  ipcMain.handle("player:pause", () => {
    try {
      getPlayer().pause();
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  ipcMain.handle("player:stop", () => {
    try {
      cancelPendingReinit();
      activeCueRange = null;
      getPlayer().stop();
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  ipcMain.handle("player:seek", async (_event, positionMs: number) => {
    try {
      const enginePositionMs = toEnginePositionMs(positionMs);
      const positionSecs = enginePositionMs / 1000;
      await getPlayer().seek(positionSecs);
      mediaService.setTimeline({
        currentMs: positionMs,
        totalMs: toDisplayDurationMs(toMs(getPlayer().getDuration())),
        seeked: true,
      });
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  ipcMain.handle("player:setVolume", (_event, volume: number) => {
    try {
      const actualVolume = getPlayer().setVolume(volume);
      mediaService.setVolume(actualVolume);
      return { success: true, data: actualVolume };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  ipcMain.handle("player:setPauseOnDeviceSwitch", (_event, enabled: boolean) => {
    setPauseOnDeviceSwitch(enabled);
    return { success: true };
  });

  ipcMain.handle("player:getVolume", () => {
    return { success: true, data: getPlayer().getVolume() };
  });

  ipcMain.handle("player:setFadeDuration", (_event, durationMs: number) => {
    try {
      getPlayer().setFadeDuration(durationMs);
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  ipcMain.handle("player:getFadeDuration", () => {
    return { success: true, data: getPlayer().getFadeDuration() };
  });

  ipcMain.handle("player:getStatus", () => {
    const raw = getPlayer().getStatus();
    return {
      success: true,
      data: {
        state: raw.state,
        position: toDisplayPositionMs(toMs(raw.position)),
        duration: toDisplayDurationMs(toMs(raw.duration)),
        volume: raw.volume,
        speed: getPlayer().getSpeed(),
        isFinished: raw.isFinished,
        bitPerfectActive: raw.bitPerfectActive,
      },
    };
  });

  ipcMain.handle("player:reinit", async () => {
    try {
      await getPlayer().reinitOutput();
      return { success: true };
    } catch (error) {
      return fail(
        isNativeDeviceError(error) ? ErrorCode.DEVICE_INIT_FAILED : ErrorCode.UNKNOWN,
        error,
      );
    }
  });

  ipcMain.handle("player:setNormalizationEnabled", (_event, enabled: boolean) => {
    try {
      getPlayer().setNormalizationEnabled(enabled);
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  ipcMain.handle("player:setEqualizerEnabled", (_event, enabled: boolean) => {
    try {
      getPlayer().setEqualizerEnabled(enabled);
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  ipcMain.handle("player:setEqualizerBands", (_event, gainsDb: number[]) => {
    try {
      getPlayer().setEqualizerBands(gainsDb);
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  ipcMain.handle("player:setPreampGain", (_event, preampDb: number) => {
    try {
      getPlayer().setPreampGain(preampDb);
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  ipcMain.handle("player:setSpeed", (_event, speed: number) => {
    try {
      getPlayer().setSpeed(speed);
      mediaService.setRate(speed);
      nowPlaying.onSpeedChange(speed);
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  ipcMain.handle("player:setPitch", (_event, semitones: number) => {
    try {
      getPlayer().setPitch(semitones);
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  ipcMain.handle("player:setPitchSync", (_event, sync: boolean) => {
    try {
      getPlayer().setPitchSync(sync);
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  ipcMain.handle("player:setFftEnabled", (_event, enabled: boolean) => {
    try {
      getPlayer().setFftEnabled(enabled);
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  ipcMain.handle("player:getFftData", () => {
    return { success: true, data: getPlayer().getFftData() };
  });

  const LYRIC_FILE_EXTS = new Set([
    ".ttml",
    ".json",
    ".lys",
    ".qrc",
    ".krc",
    ".yrc",
    ".lrc",
    ".ass",
    ".srt",
  ]);
  ipcMain.handle("player:readLyricFile", async (_event, filePath: string) => {
    try {
      const ext = extname(filePath).toLowerCase();
      if (!LYRIC_FILE_EXTS.has(ext)) {
        return fail(ErrorCode.UNKNOWN, new Error(`Unsupported lyric file type: ${ext}`));
      }
      const content = await readFileAutoEncoding(filePath);
      return { success: true, data: content };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  ipcMain.handle("player:getCoverRaw", () => {
    try {
      const inst = getPlayer();
      const raw = inst.getCoverRaw();
      if (!raw) return { success: true, data: null };
      const base64 = Buffer.from(raw).toString("base64");
      const mime = raw
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
        ? "image/png"
        : "image/jpeg";
      return { success: true, data: `data:${mime};base64,${base64}` };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  ipcMain.handle("player:getOutputDevices", () => {
    try {
      return { success: true, data: getPlayer().getOutputDevices() };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  ipcMain.handle("player:getDefaultDeviceName", () => {
    try {
      return { success: true, data: getPlayer().getDefaultDeviceName() ?? null };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  ipcMain.handle(
    "player:setOutputDevice",
    async (_event, deviceId: string | null, pauseBeforeSwitch = false) => {
      try {
        cancelPendingReinit();
        if (pauseBeforeSwitch) getPlayer().pauseImmediately();
        await getPlayer().setOutputDevice(deviceId ?? undefined);
        return { success: true };
      } catch (error) {
        return fail(
          isNativeDeviceError(error) ? ErrorCode.DEVICE_INIT_FAILED : ErrorCode.UNKNOWN,
          error,
        );
      }
    },
  );

  ipcMain.handle("player:setExclusiveAudio", async (_event, enabled: boolean) => {
    try {
      cancelPendingReinit();
      await getPlayer().setExclusiveAudio(enabled);
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.EXCLUSIVE_AUDIO_UNAVAILABLE, error);
    }
  });

  ipcMain.handle("player:getSelectedDeviceName", () => {
    try {
      return { success: true, data: getPlayer().getSelectedDeviceName() ?? null };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  ipcMain.on("player:syncPlayMode", (_event, repeat: RepeatMode, shuffle: ShuffleMode) => {
    setTrayPlayMode(repeat, shuffle);
  });

  ipcMain.on("player:syncLikeState", (_event, liked: boolean) => {
    setTrayLikeState(liked);
    getThumbar()?.updateLike(liked);
  });

  ipcMain.on("player:dispatch", (_event, type: string) => {
    sendToMain("player:event", { type });
  });

  mediaService.onEvent((event: MediaEvent) => {
    try {
      const inst = getPlayer();
      switch (event.type) {
        case "Play":
          void inst.play().catch(() => {});
          break;
        case "Pause":
          inst.pause();
          break;
        case "Stop":
          inst.stop();
          break;
        case "Seek":
          if (event.positionMs != null) {
            const targetMs = event.positionMs;
            sendToMain("player:event", { type: "seek", data: { position: targetMs } });
            void inst.seek(targetMs / 1000).then(() => {
              mediaService.setTimeline({
                currentMs: targetMs,
                totalMs: toMs(inst.getDuration()),
                seeked: true,
              });
            });
          }
          break;
        case "SetVolume":
          if (event.volume != null) {
            if (0 <= event.volume && event.volume <= 1) {
              const actualVolume = inst.setVolume(event.volume);
              mediaService.setVolume(actualVolume);
              sendToMain("player:event", {
                type: "status",
                data: {
                  state: inst.getStatus().state as PlayerState,
                  position: toDisplayPositionMs(toMs(inst.getPosition())),
                  duration: toDisplayDurationMs(toMs(inst.getDuration())),
                  volume: actualVolume,
                  speed: inst.getSpeed(),
                  isFinished: false,
                  bitPerfectActive: inst.getStatus().bitPerfectActive,
                },
              });
            } else {
              playerLog.warn(`Invalid volume value: ${event.volume}`);
            }
          }
          break;
        case "SetRate":
          if (event.rate != null) {
            if (0.5 <= event.rate && event.rate <= 2.0) {
              inst.setSpeed(event.rate);
              mediaService.setRate(event.rate);
              nowPlaying.onSpeedChange(event.rate);
              sendToMain("player:event", {
                type: "status",
                data: {
                  state: inst.getStatus().state as PlayerState,
                  position: toDisplayPositionMs(toMs(inst.getPosition())),
                  duration: toDisplayDurationMs(toMs(inst.getDuration())),
                  volume: inst.getVolume(),
                  speed: event.rate,
                  isFinished: false,
                  bitPerfectActive: inst.getStatus().bitPerfectActive,
                },
              });
            } else {
              playerLog.warn(`Invalid playback rate value: ${event.rate}`);
            }
          }
          break;
        case "NextTrack":
          sendToMain("player:event", { type: "next" });
          break;
        case "PrevTrack":
          sendToMain("player:event", { type: "prev" });
          break;
      }
    } catch {}
  });

  const resumeHandler = async (): Promise<void> => {
    const inst = getPlayer();
    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [500, 1500, 3000];
    for (let i = 0; i < MAX_RETRIES; i++) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS[i]));
      try {
        await inst.reinitOutput();
        playerLog.info(`Rebuilt audio output after wake (attempt ${i + 1})`);
        return;
      } catch (error) {
        playerLog.warn(`Failed to rebuild audio output on attempt ${i + 1}:`, error);
      }
    }
    playerLog.error("All audio-output rebuild attempts failed; destroying player instance");
    resetPlayer();
    stopDeviceMonitoring();
    const stoppedEvent = {
      type: "status",
      data: {
        state: "stopped",
        position: 0,
        duration: 0,
        volume: 1,
        speed: 1,
        isFinished: false,
        bitPerfectActive: false,
      },
    };
    sendToMain("player:event", stoppedEvent);
    wsBroadcast(stoppedEvent);
  };
  powerMonitor.on("resume", resumeHandler);
  app.on("before-quit", stopDeviceMonitoring);
};
