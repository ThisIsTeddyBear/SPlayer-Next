<script setup lang="ts">
defineOptions({ name: "SearchPage" });

import type { Track } from "@shared/types/player";
import type { CoverItem } from "@/types/artist";
import SongList from "@/components/list/SongList.vue";
import CoverList from "@/components/list/CoverList.vue";
import { useLibraryStore } from "@/stores/library";
import { navigateToAlbum, navigateToArtist } from "@/utils/navigate";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const libraryStore = useLibraryStore();

type TabKey = "songs" | "albums" | "artists";

const TAB_KEYS: readonly TabKey[] = ["songs", "albums", "artists"];

const PAGE_SIZE = 50;

/** 当前生效的 tab */
const activeTab = ref<TabKey>("songs");

/** 当前生效的关键词 */
const keyword = ref("");

const tabs = computed(() => [
  { key: "songs", label: t("search.tabs.songs") },
  { key: "albums", label: t("search.tabs.albums") },
  { key: "artists", label: t("search.tabs.artists") },
]);

interface TabState<T> {
  items: T[];
  total: number;
  hasMore: boolean;
  loaded: boolean;
  loading: boolean;
  loadingMore: boolean;
}

const createState = <T,>(): TabState<T> => ({
  items: [],
  total: 0,
  hasMore: false,
  loaded: false,
  loading: false,
  loadingMore: false,
});

const states = reactive({
  songs: createState<Track>(),
  albums: createState<CoverItem>(),
  artists: createState<CoverItem>(),
});

const error = ref("");

/** 统一搜索文本，忽略大小写、重音和标点。 */
const normalize = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const isSubsequence = (query: string, value: string): boolean => {
  let index = 0;
  for (const char of value) {
    if (char === query[index]) index += 1;
    if (index === query.length) return true;
  }
  return false;
};

/** 返回匹配质量，用于将完整匹配排在模糊匹配之前。 */
const matchScore = (values: Array<string | undefined>, query: string): number => {
  const text = normalize(values.filter((value): value is string => !!value).join(" "));
  if (!text) return 0;
  if (text.includes(query)) return 3;

  const words = text.split(" ");
  const tokens = query.split(" ").filter(Boolean);
  if (tokens.length === 0) return 0;
  if (tokens.every((token) => words.some((word) => word.includes(token)))) return 2;

  const compactText = text.replace(/\s/g, "");
  return tokens.every((token) => isSubsequence(token, compactText)) ? 1 : 0;
};

const matches = (values: Array<string | undefined>, query: string): boolean =>
  matchScore(values, query) > 0;

const localResults = (tab: TabKey): Array<Track | CoverItem> => {
  const query = normalize(keyword.value);
  if (!query) return [];
  const tracks = libraryStore.tracks;
  if (tab === "songs") {
    return tracks
      .map((track) => ({
        track,
        score: matchScore(
          [
            track.title,
            track.comment,
            track.path,
            track.album?.name,
            track.album?.artist,
            ...track.artists.map((artist) => artist.name),
          ],
          query,
        ),
      }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score)
      .map(({ track }) => track);
  }
  if (tab === "albums") {
    const albums = new Map<string, CoverItem>();
    for (const track of tracks) {
      const name = track.album?.name?.trim();
      if (!name || albums.has(name)) continue;
      if (
        !matches([name, track.album?.artist, ...track.artists.map((artist) => artist.name)], query)
      ) {
        continue;
      }
      albums.set(name, {
        id: encodeURIComponent(name),
        title: name,
        cover: track.album?.cover ?? track.cover,
        subtitle: track.album?.artist ?? track.artists.map((artist) => artist.name).join(" / "),
        trackCount: 1,
      });
    }
    return [...albums.values()];
  }
  if (tab === "artists") {
    const artists = new Map<string, CoverItem>();
    for (const track of tracks) {
      for (const artist of track.artists) {
        const name = artist.name.trim();
        if (!name || artists.has(name) || !matches([name], query)) continue;
        artists.set(name, {
          id: encodeURIComponent(name),
          title: name,
          cover: artist.avatar ?? track.cover,
          subtitle: "",
          trackCount: 1,
        });
      }
    }
    return [...artists.values()];
  }
  return [];
};

/**
 * 拉取指定 tab
 * @param tab - 要拉取的 tab
 * @param append - 是否追加下一页
 */
const fetchTab = async (tab: TabKey, append: boolean): Promise<void> => {
  if (!keyword.value) return;
  const state = states[tab];
  if (append) {
    if (!state.loaded || state.loadingMore || !state.hasMore) return;
    state.loadingMore = true;
  } else {
    if (state.loading) return;
    state.loading = true;
  }
  error.value = "";
  try {
    const all = localResults(tab);
    const offset = append ? state.items.length : 0;
    const items = all.slice(offset, offset + PAGE_SIZE).map((item) => markRaw(item));
    if (append) (state.items as Array<Track | CoverItem>).push(...items);
    else state.items = items as Track[];
    state.total = all.length;
    state.hasMore = offset + items.length < all.length;
    state.loaded = true;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    state.loading = false;
    state.loadingMore = false;
  }
};

const resetStates = (): void => {
  (Object.keys(states) as TabKey[]).forEach((tab) => {
    states[tab].items = [];
    states[tab].total = 0;
    states[tab].hasMore = false;
    states[tab].loaded = false;
    states[tab].loading = false;
    states[tab].loadingMore = false;
  });
  error.value = "";
};

let lastLoadedKeyword = "";

/** 仅在当前处于搜索路由时同步路由参数，避免离开到其他页面时因 query 为空而误清空状态 */
const syncFromRoute = (): void => {
  if (route.name !== "search") return;
  const q = typeof route.query.q === "string" ? route.query.q.trim() : "";
  const tab =
    typeof route.query.tab === "string" && (TAB_KEYS as readonly string[]).includes(route.query.tab)
      ? (route.query.tab as TabKey)
      : "songs";

  activeTab.value = tab;
  keyword.value = q;

  const keywordChanged = q !== lastLoadedKeyword;
  if (keywordChanged) {
    lastLoadedKeyword = q;
    resetStates();
    if (q) fetchTab(tab, false);
  } else if (q && !states[tab].loaded) {
    fetchTab(tab, false);
  }
};

watch(() => [route.name, route.query.q, route.query.tab, libraryStore.tracks], syncFromRoute, {
  immediate: true,
});

const onTabSwitch = (key: string): void => {
  router.replace({ query: { ...route.query, tab: key } });
};

onMounted(() => {
  if (!libraryStore.initialized) void libraryStore.load();
});

/** 失败后重试加载当前 tab */
const onRetry = (): void => {
  error.value = "";
  fetchTab(activeTab.value, false);
};

/** 滚动触底加载下一页 */
const onReachBottom = (tab: TabKey): void => {
  fetchTab(tab, true);
};

/** 当前 tab 首屏加载中 */
const isInitialLoading = computed(() => {
  const state = states[activeTab.value];
  return state.loading && !state.loaded;
});

/** 当前 tab 已加载且为空 */
const isEmptyResult = computed(() => {
  const state = states[activeTab.value];
  return state.loaded && state.items.length === 0;
});
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- 顶栏 -->
    <div class="shrink-0 px-5 pb-2">
      <div class="mt-2 mb-4 flex items-end justify-between gap-4">
        <h1 class="min-w-0 flex items-baseline pr-3">
          <span class="min-w-0 truncate text-3xl font-bold text-on-surface">
            {{ keyword || t("search.title") }}
          </span>
          <span
            v-if="keyword"
            class="ml-2 shrink-0 whitespace-nowrap font-medium text-lg text-on-surface-variant/60"
          >
            {{ t("search.titleSuffix") }}
          </span>
        </h1>
      </div>
      <STabs :model-value="activeTab" :tabs="tabs" @update:model-value="onTabSwitch" />
    </div>
    <!-- 空关键词 -->
    <div v-if="!keyword" class="flex-1 flex items-center justify-center">
      <div class="text-center text-on-surface-variant/60">
        <IconLucideSearch class="size-14 mx-auto mb-4 opacity-30" />
        <div class="text-sm">{{ t("search.emptyKeyword") }}</div>
      </div>
    </div>
    <!-- 错误态 -->
    <div v-else-if="error" class="flex-1 flex items-center justify-center px-6">
      <div class="text-center flex flex-col items-center">
        <div class="text-red-500/85 mb-4">
          <IconLucideTriangleAlert class="size-14 mx-auto mb-3 opacity-50" />
          <div class="text-sm font-medium mb-1">{{ t("search.errorTitle") }}</div>
          <div class="text-xs opacity-80 break-all max-w-xs">{{ error }}</div>
        </div>
        <SButton
          variant="secondary"
          size="small"
          :loading="states[activeTab].loading"
          @click="onRetry"
        >
          <template #icon>
            <IconLucideRotateCw class="size-3.5" />
          </template>
          {{ t("common.retry") }}
        </SButton>
      </div>
    </div>
    <!-- 首次加载 -->
    <div v-else-if="isInitialLoading" class="flex-1 flex items-center justify-center">
      <div class="text-center text-on-surface-variant/60">
        <SLoading class="text-4xl text-primary/70 mb-4 mx-auto block" />
        <div class="text-sm">{{ t("common.loading") }}</div>
      </div>
    </div>
    <!-- 无结果 -->
    <div v-else-if="isEmptyResult" class="flex-1 flex items-center justify-center">
      <div class="text-center text-on-surface-variant/60">
        <IconLucideSearchX class="size-14 mx-auto mb-4 opacity-30" />
        <div class="text-sm mb-1">{{ t("search.noResults") }}</div>
        <div class="text-xs opacity-70">{{ t("search.noResultsHint") }}</div>
      </div>
    </div>
    <!-- 各 tab 内容 -->
    <div v-else class="flex-1 min-h-0">
      <SongList
        v-if="activeTab === 'songs'"
        :items="states.songs.items"
        source="local"
        :show-size="false"
        :has-more="states.songs.hasMore"
        :loading-more="states.songs.loadingMore"
        @reach-bottom="onReachBottom('songs')"
      />
      <CoverList
        v-else-if="activeTab === 'albums'"
        :items="states.albums.items"
        :padding-x="20"
        :padding-top="8"
        :padding-bottom="20"
        :has-more="states.albums.hasMore"
        :loading-more="states.albums.loadingMore"
        @click="(item) => navigateToAlbum(item.title)"
        @reach-bottom="onReachBottom('albums')"
      />
      <CoverList
        v-else-if="activeTab === 'artists'"
        :items="states.artists.items"
        type="artist"
        :min-size="120"
        :padding-x="20"
        :padding-top="8"
        :padding-bottom="20"
        :has-more="states.artists.hasMore"
        :loading-more="states.artists.loadingMore"
        @click="(item) => navigateToArtist(item.title)"
        @reach-bottom="onReachBottom('artists')"
      />
    </div>
  </div>
</template>
