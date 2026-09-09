const numberRanges: Record<string, [number, number]> = {
  "player:seek": [0, Number.MAX_SAFE_INTEGER],
  "player:setVolume": [0, 1],
  "player:setFadeDuration": [0, Number.MAX_SAFE_INTEGER],
  "player:setSpeed": [0.01, 100],
  "player:setPitch": [-100, 100],
  "player:setPreampGain": [-100, 100],
};

const booleanChannels = new Set([
  "player:setPauseOnDeviceSwitch",
  "player:setNormalizationEnabled",
  "player:setEqualizerEnabled",
  "player:setPitchSync",
  "player:setFftEnabled",
]);

/** 在进入原生绑定或配置层前拒绝无效的基础输入。 */
export const validateIpcArgs = (channel: string, args: unknown[]): void => {
  const range = numberRanges[channel];
  const value = args[0];
  if (
    range &&
    (typeof value !== "number" || !Number.isFinite(value) || value < range[0] || value > range[1])
  ) {
    throw new Error("Invalid numeric IPC argument");
  }
  if (booleanChannels.has(channel) && typeof value !== "boolean") {
    throw new Error("Boolean IPC argument required");
  }
  if (
    channel === "player:setEqualizerBands" &&
    (!Array.isArray(value) ||
      value.length !== 10 ||
      value.some((gain) => typeof gain !== "number" || !Number.isFinite(gain)))
  ) {
    throw new Error("Ten finite equalizer gains required");
  }
  if (
    (channel === "config:get" || channel === "config:set") &&
    (typeof value !== "string" ||
      value.length > 256 ||
      value
        .split(".")
        .some((part) => !part || ["__proto__", "prototype", "constructor"].includes(part)))
  ) {
    throw new Error("Invalid configuration path");
  }
  if (channel === "player:load") {
    if (typeof value !== "string" || !value || value.length > 65536 || value.includes("\0")) {
      throw new Error("Invalid playback source");
    }
    const options = args[1];
    if (
      options !== undefined &&
      (!options || typeof options !== "object" || Array.isArray(options))
    ) {
      throw new Error("Playback options must be an object");
    }
  }
  if (channel === "library:searchMetadata") {
    const query = value as { provider?: unknown; title?: unknown; artist?: unknown } | null;
    if (
      !query ||
      typeof query !== "object" ||
      !["netease", "musicbrainz"].includes(String(query.provider)) ||
      typeof query.title !== "string" ||
      typeof query.artist !== "string" ||
      query.title.length > 500 ||
      query.artist.length > 500
    ) throw new Error("Invalid metadata search query");
  }
  if (channel === "library:getMetadataDetail") {
    if (
      !["netease", "musicbrainz"].includes(String(value)) ||
      typeof args[1] !== "string" ||
      !args[1] ||
      args[1].length > 100
    ) throw new Error("Invalid metadata detail request");
  }
};
