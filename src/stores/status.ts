import type { PlayerState, AudioDevice, RepeatMode, ShuffleMode } from "@shared/types/player";
import type { Platform } from "@shared/types/platform";
import type { ContentScope } from "@/types/collection";
import type { SortField, SortOrder } from "@/types/list";
import type { PersonalFmOptions } from "@/types/netease";
export type { RepeatMode, ShuffleMode } from "@shared/types/player";
export type { SortField, SortOrder } from "@/types/list";
import * as queue from "./queue";

export const useStatusStore = defineStore(
  "status",
  () => {
    const state = ref<PlayerState>("idle");
    const position = ref(0);
    const duration = ref(0);
    const volume = ref(1);
    const currentSource = ref<string | null>(null);
    const outputDevices = ref<AudioDevice[]>([]);
    const trackLoading = ref(false);
    const isPlayerExpanded = ref(false);
    const outerQueueOpen = ref(false);
    const fullQueueOpen = ref(false);
    const searchOpen = ref(false);
    const showLyric = ref(true);
    const playIndex = ref(-1);
    const repeatMode = ref<RepeatMode>("list");
    const shuffleMode = ref<ShuffleMode>("off");
    const heartMode = ref(false);
    const fmMode = ref(false);
    const fmOptions = ref<PersonalFmOptions>({ mode: "DEFAULT" });
    const speed = ref(1.0);
    const pitch = ref(0);
    const pitchSync = ref(true);
    const autoClose = reactive({
      enable: false,
      duration: 30, // 分钟
      endTime: 0, // Unix ms
      waitSongEnd: false,
      remainTime: 0, // 秒
    });
    const abLoop = reactive({
      enable: false,
      pointA: null as number | null,
      pointB: null as number | null,
    });
    const lyricOffsetMs = ref(0);
    const searchPlatform = ref<Platform>("netease");
    const myPlaylistSource = ref<ContentScope>("local");
    const likedPageTab = ref<ContentScope>("local");
    const settingsCategory = ref("");
    const sortField = ref<SortField>("none");
    const sortOrder = ref<SortOrder>("asc");
    const isPlaying = computed(() => state.value === "playing");
    const isPaused = computed(() => state.value === "paused");
    const isLoading = computed(() => trackLoading.value);
    const progress = computed(() => (duration.value > 0 ? position.value / duration.value : 0));
    /**
     */
    const currentTrack = computed(() => queue.getTrack(playIndex.value));
    const currentPlaybackContext = computed(() => queue.getQueueItem(playIndex.value)?.context);

    return {
      state,
      position,
      duration,
      volume,
      currentSource,
      isPlaying,
      isPaused,
      isLoading,
      progress,
      trackLoading,
      isPlayerExpanded,
      outerQueueOpen,
      fullQueueOpen,
      searchOpen,
      showLyric,
      outputDevices,
      playIndex,
      repeatMode,
      shuffleMode,
      heartMode,
      fmMode,
      fmOptions,
      speed,
      pitch,
      pitchSync,
      autoClose,
      abLoop,
      lyricOffsetMs,
      searchPlatform,
      myPlaylistSource,
      likedPageTab,
      settingsCategory,
      sortField,
      sortOrder,
      currentTrack,
      currentPlaybackContext,
    };
  },
  {
    persist: {
      storage: localStorage,
      pick: [
        "playIndex",
        "repeatMode",
        "shuffleMode",
        "heartMode",
        "fmOptions",
        "volume",
        "position",
        "searchPlatform",
        "myPlaylistSource",
        "likedPageTab",
        "settingsCategory",
        "sortField",
        "sortOrder",
      ],
    },
  },
);
