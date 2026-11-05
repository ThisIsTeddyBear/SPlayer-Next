<script setup lang="ts">
defineOptions({ name: "Library" });

import type { PlaybackContext, Track } from "@shared/types/player";
import type { CoverItem } from "@/types/artist";
import type { SortField } from "@/types/list";
import type { DropdownMenuItem } from "@/components/ui/SDropdownMenu.vue";
import type { SSelectOption } from "@/components/ui/SSelect.vue";
import { useLibraryStore } from "@/stores/library";
import { useStatusStore } from "@/stores/status";
import { useThemeStore } from "@/stores/theme";
import SongList from "@/components/list/SongList.vue";
import CoverList from "@/components/list/CoverList.vue";
import LibraryCoverCard from "@/components/library/LibraryCoverCard.vue";
import { formatFileSize } from "@/utils/format";
import { navigateToAlbum, navigateToArtist } from "@/utils/navigate";
import IconFolderOpen from "~icons/lucide/folder-open";
import IconRefreshCw from "~icons/lucide/refresh-cw";
import IconLucideListChecks from "~icons/lucide/list-checks";
import * as player from "@/core/player";

type LibraryView = "recent" | "songs" | "albums" | "artists";

interface LibraryCoverItem extends CoverItem {
  kind: "album" | "artist" | "track";
  addedAt: number;
}

const { t } = useI18n();
const route = useRoute();
const libraryStore = useLibraryStore();
const theme = useThemeStore();
const { tracks, scanDirs, scanning, scanProgress, initialized } = storeToRefs(libraryStore);
const { sortField, sortOrder } = storeToRefs(useStatusStore());
const songListRef = shallowRef<InstanceType<typeof SongList> | null>(null);
const searchQuery = ref(typeof route.query.q === "string" ? route.query.q : "");
const view = ref<LibraryView>(searchQuery.value ? "songs" : "recent");
const coverSort = ref("name");
const folderDialogOpen = ref(false);
const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

const playbackContext = computed<PlaybackContext>(() => ({
  provider: "local",
  originId: "library",
  originType: "page",
  originName: t("library.title"),
}));

const tabs = computed<{ key: LibraryView; label: string }[]>(() => [
  { key: "recent", label: t("library.recentlyAdded") },
  { key: "songs", label: t("library.songs") },
  { key: "albums", label: t("library.albums") },
  { key: "artists", label: t("library.artists") },
]);

const currentTitle = computed(() => tabs.value.find((tab) => tab.key === view.value)!.label);

watch(
  () => route.query.q,
  (query) => {
    searchQuery.value = typeof query === "string" ? query : "";
    if (searchQuery.value) view.value = "songs";
  },
);

const totalSize = computed(() => {
  const bytes = tracks.value.reduce((sum, track) => sum + (track.fileSize ?? 0), 0);
  return bytes > 0 ? formatFileSize(bytes) : "";
});

const filteredTracks = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  if (!query) return tracks.value;
  return tracks.value.filter(
    (track) =>
      track.title.toLowerCase().includes(query) ||
      track.album?.name.toLowerCase().includes(query) ||
      track.artists.some((artist) => artist.name.toLowerCase().includes(query)),
  );
});

/**
 * 无专辑标签的单曲独立展示，避免合并为一张无法打开的未知专辑。
 * @param track - 本地曲目
 * @returns 封面视图的聚合键
 */
const getAlbumKey = (track: Track): string =>
  track.album?.name?.trim() ? `album:${track.album.name}` : `track:${track.id}`;

const albumItems = computed<LibraryCoverItem[]>(() => {
  const albums = new Map<string, LibraryCoverItem>();
  for (const track of tracks.value) {
    const key = getAlbumKey(track);
    const addedAt = track.addedAt ?? track.ctime ?? track.mtime ?? 0;
    const album = albums.get(key);
    if (album) {
      album.trackCount++;
      album.addedAt = Math.max(album.addedAt, addedAt);
      album.cover ||= track.cover;
      continue;
    }
    albums.set(key, {
      id: key,
      kind: key.startsWith("album:") ? "album" : "track",
      title: track.album?.name?.trim() ? track.album.name : track.title,
      subtitle:
        track.album?.artist ||
        track.artists.map((artist) => artist.name).join(" / ") ||
        t("song.unknownArtist"),
      cover: track.cover,
      trackCount: 1,
      addedAt,
    });
  }
  return [...albums.values()];
});

const artistItems = computed<LibraryCoverItem[]>(() => {
  const artists = new Map<string, LibraryCoverItem>();
  for (const track of tracks.value) {
    for (const artist of track.artists) {
      if (!artist.name.trim()) continue;
      const existing = artists.get(artist.name);
      if (existing) {
        existing.trackCount++;
        existing.cover ||= track.cover;
        continue;
      }
      artists.set(artist.name, {
        id: `artist:${artist.name}`,
        kind: "artist",
        title: artist.name,
        cover: track.cover,
        trackCount: 1,
        addedAt: 0,
      });
    }
  }
  return [...artists.values()];
});

const visibleCovers = computed<LibraryCoverItem[]>(() => {
  if (view.value === "songs") return [];
  let items: LibraryCoverItem[];
  if (view.value === "artists") {
    const names = new Set(filteredTracks.value.flatMap((track) => track.artists.map((a) => a.name)));
    items = artistItems.value
      .filter((artist) => names.has(artist.title))
      .map((artist) => ({
        ...artist,
        cover: libraryStore.getArtistAvatar(artist.title) ?? artist.cover,
        subtitle: t("common.totalSongs", { count: artist.trackCount }),
      }));
  } else {
    const keys = new Set(filteredTracks.value.map(getAlbumKey));
    items = albumItems.value.filter(
      (album) => keys.has(album.id) && (view.value === "recent" || album.kind === "album"),
    );
  }
  return items.sort((a, b) => {
    if (view.value === "recent") return b.addedAt - a.addedAt || collator.compare(a.title, b.title);
    if (coverSort.value === "count") {
      return b.trackCount - a.trackCount || collator.compare(a.title, b.title);
    }
    return collator.compare(a.title, b.title);
  });
});

const sectionCount = computed(() => {
  if (view.value === "songs") return t("common.totalSongs", { count: filteredTracks.value.length });
  if (view.value === "artists") return t("common.totalArtists", { count: visibleCovers.value.length });
  if (view.value === "albums") return t("common.totalAlbums", { count: visibleCovers.value.length });
  return t("library.totalItems", { count: visibleCovers.value.length });
});

const canPlay = computed(() =>
  view.value === "songs" ? filteredTracks.value.length > 0 : visibleCovers.value.length > 0,
);

const sortOptions = computed<SSelectOption[]>(() => {
  if (view.value !== "songs") {
    return [
      { value: "name", label: t("songList.sort.byName") },
      { value: "count", label: t("songList.sort.byTrackCount") },
    ];
  }
  const fields: [SortField, string][] = [
    ["none", "default"],
    ["title", "byTitle"],
    ["artist", "byArtist"],
    ["album", "byAlbum"],
    ["track", "byTrack"],
    ["duration", "byDuration"],
    ["size", "bySize"],
    ["ctime", "byCtime"],
    ["mtime", "byMtime"],
    ["path", "byPath"],
  ];
  return fields.map(([value, key]) => ({ value, label: t(`songList.sort.${key}`) }));
});

const selectedSort = computed({
  get: () => (view.value === "songs" ? sortField.value : coverSort.value),
  set: (value: string | number | boolean) => {
    if (view.value === "songs") sortField.value = value as SortField;
    else coverSort.value = String(value);
  },
});

const scanPercent = computed(() => {
  if (!scanProgress.value?.total) return 0;
  return Math.round((scanProgress.value.scanned / scanProgress.value.total) * 100);
});

const moreMenuItems = computed<DropdownMenuItem[]>(() => [
  {
    key: "batchManage",
    label: t("songList.batch.manage"),
    icon: IconLucideListChecks,
    disabled: tracks.value.length === 0,
  },
  { key: "folders", label: t("library.folders"), icon: IconFolderOpen, separator: true },
  {
    key: "scan",
    label: scanning.value ? t("library.scanning") : t("library.scanAll"),
    icon: IconRefreshCw,
    disabled: scanning.value || scanDirs.value.length === 0,
  },
]);

/**
 * 按当前列表顺序播放，搜索后仅播放匹配的曲目。
 * @param shuffle - 是否随机播放
 */
const handlePlayAll = (shuffle = false): void => {
  let items: Track[];
  if (view.value === "songs") {
    items = songListRef.value?.getPlaybackItems() ?? filteredTracks.value;
  } else if (view.value === "artists") {
    const names = new Set(visibleCovers.value.map((artist) => artist.title));
    items = filteredTracks.value.filter((track) => track.artists.some((a) => names.has(a.name)));
  } else {
    const order = new Map(visibleCovers.value.map((item, index) => [item.id, index]));
    items = filteredTracks.value.filter((track) => order.has(getAlbumKey(track)));
    items.sort(
      (a, b) =>
        order.get(getAlbumKey(a))! - order.get(getAlbumKey(b))! || (a.track ?? 0) - (b.track ?? 0),
    );
  }
  if (items.length === 0) return;
  player.setShuffleMode(shuffle ? "on" : "off");
  void player.playFrom(
    items,
    shuffle ? Math.floor(Math.random() * items.length) : 0,
    playbackContext.value,
  );
};

const handlePlayItem = (item: LibraryCoverItem): void => {
  const items = tracks.value.filter((track) => {
    if (item.kind === "artist") return track.artists.some((artist) => artist.name === item.title);
    return getAlbumKey(track) === item.id;
  });
  if (items.length === 0) return;
  if (item.kind === "album") items.sort((a, b) => (a.track ?? 0) - (b.track ?? 0));
  player.setShuffleMode("off");
  void player.playFrom(
    items,
    0,
    item.kind === "track"
      ? playbackContext.value
      : {
          provider: "local",
          originId: encodeURIComponent(item.title),
          originType: item.kind,
          originName: item.title,
        },
  );
};

const handleOpenItem = (item: LibraryCoverItem): void => {
  if (item.kind === "artist") navigateToArtist(item.title);
  else if (item.kind === "album") navigateToAlbum(item.title);
  else handlePlayItem(item);
};

const handleQuickAddFolder = async (): Promise<void> => {
  const res = await libraryStore.addScanDir();
  if (res.success) void libraryStore.startScan(false);
};

const handleMoreMenu = async (key: string): Promise<void> => {
  if (key === "batchManage") {
    view.value = "songs";
    await nextTick();
    songListRef.value?.enterBatch();
  } else if (key === "folders") {
    folderDialogOpen.value = true;
  } else if (key === "scan") {
    void libraryStore.startScan(false);
  }
};

/**
 * 方向键切换标签，并将键盘焦点移到对应按钮。
 * @param event - 标签键盘事件
 * @param index - 当前标签位置
 */
const handleTabKeydown = (event: KeyboardEvent, index: number): void => {
  let nextIndex = index;
  if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.value.length;
  else if (event.key === "ArrowLeft") nextIndex = (index + tabs.value.length - 1) % tabs.value.length;
  else if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = tabs.value.length - 1;
  else return;
  event.preventDefault();
  view.value = tabs.value[nextIndex].key;
  const tabList = (event.currentTarget as HTMLElement).parentElement;
  void nextTick(() => tabList?.querySelectorAll<HTMLButtonElement>("[role=tab]")[nextIndex]?.focus());
};

onMounted(async () => {
  libraryStore.subscribeScanProgress();
  if (!initialized.value) await libraryStore.load();
  if (scanDirs.value.length > 0) void libraryStore.startScan(tracks.value.length > 0);
});

onUnmounted(libraryStore.unsubscribeScanProgress);
</script>

<template>
  <div
    class="library-page"
    :style="{ '--s-primary': theme.isDark ? '250 88 106' : '193 34 64' }"
  >
    <header class="library-header">
      <div class="library-heading">
        <div>
          <p class="library-eyebrow">{{ t("library.yourCollection") }}</p>
          <h1>{{ t("library.title") }}</h1>
          <div class="library-stats">
            <span>{{ t("common.totalSongs", { count: tracks.length }) }}</span>
            <template v-if="totalSize">
              <span aria-hidden="true">·</span>
              <span>{{ totalSize }}</span>
            </template>
          </div>
        </div>
        <SButton variant="ghost" class="library-add" @click="handleQuickAddFolder">
          <template #icon><IconLucidePlus /></template>
          {{ t("library.addMusic") }}
        </SButton>
      </div>

      <div class="library-navigation">
        <div role="tablist" :aria-label="t('library.views')" class="library-tabs">
          <button
            v-for="(tab, index) in tabs"
            :id="`library-tab-${tab.key}`"
            :key="tab.key"
            type="button"
            role="tab"
            aria-controls="library-panel"
            :aria-selected="view === tab.key"
            :tabindex="view === tab.key ? 0 : -1"
            :class="{ 'is-active': view === tab.key }"
            @click="view = tab.key"
            @keydown="handleTabKeydown($event, index)"
          >
            {{ tab.label }}
          </button>
        </div>
        <label class="library-search" data-search-input>
          <IconLucideSearch class="size-4 shrink-0" aria-hidden="true" />
          <input
            v-model="searchQuery"
            type="search"
            :aria-label="t('library.search')"
            :placeholder="t('library.search')"
          />
          <button
            v-if="searchQuery"
            type="button"
            :aria-label="t('library.clearSearch')"
            @mousedown.prevent
            @click="searchQuery = ''"
          >
            <IconLucideX class="size-3.5" />
          </button>
        </label>
      </div>

      <div class="library-toolbar">
        <div class="library-section-title">
          <h2>{{ currentTitle }}</h2>
          <span>{{ sectionCount }}</span>
        </div>
        <div class="library-actions">
          <SButton class="library-play" :disabled="!canPlay" @click="handlePlayAll()">
            <template #icon><IconLucidePlay class="fill-current" /></template>
            {{ t("common.playAll") }}
          </SButton>
          <SButton
            variant="tertiary"
            class="library-shuffle"
            :disabled="!canPlay"
            :aria-label="t('common.shufflePlay')"
            @click="handlePlayAll(true)"
          >
            <template #icon><IconLucideShuffle /></template>
            <span>{{ t("library.shuffle") }}</span>
          </SButton>
          <span v-if="view === 'recent'" class="library-newest">
            <IconLucideArrowDownWideNarrow class="size-3.5" aria-hidden="true" />
            {{ t("library.newestFirst") }}
          </span>
          <div v-else class="library-sort">
            <SSelect
              v-model="selectedSort"
              :options="sortOptions"
              :aria-label="t('songList.sort.mode')"
            />
            <SButton
              v-if="view === 'songs'"
              variant="ghost"
              circle
              :disabled="sortField === 'none'"
              :aria-label="t(sortOrder === 'asc' ? 'songList.sort.desc' : 'songList.sort.asc')"
              :title="t(sortOrder === 'asc' ? 'songList.sort.asc' : 'songList.sort.desc')"
              @click="sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'"
            >
              <template #icon>
                <IconLucideArrowUp v-if="sortOrder === 'asc'" />
                <IconLucideArrowDown v-else />
              </template>
            </SButton>
          </div>
          <SDropdownMenu :items="moreMenuItems" align="end" @select="handleMoreMenu">
            <template #trigger>
              <SButton variant="ghost" circle :aria-label="t('library.moreActions')">
                <template #icon><IconLucideEllipsis /></template>
              </SButton>
            </template>
          </SDropdownMenu>
        </div>
      </div>

      <div v-if="scanning && scanProgress" class="library-scan" role="status">
        <div class="library-scan-label">
          <SLoading class="size-3" />
          <span>
            {{
              t("library.scanProgress", {
                scanned: scanProgress.scanned,
                total: scanProgress.total,
              })
            }}
          </span>
          <span class="tabular-nums">{{ scanPercent }}%</span>
        </div>
        <div class="library-scan-track">
          <div :style="{ width: `${scanPercent}%` }" />
        </div>
      </div>
    </header>

    <section
      id="library-panel"
      role="tabpanel"
      :aria-labelledby="`library-tab-${view}`"
      tabindex="0"
      class="library-content"
    >
      <div v-if="tracks.length === 0" class="library-empty">
        <div class="library-empty-icon"><IconLucideMusic2 class="size-9" /></div>
        <h2>{{ t("library.empty") }}</h2>
        <p>{{ t("library.emptyHint") }}</p>
        <SButton class="library-play" @click="handleQuickAddFolder">
          <template #icon><IconLucideFolderPlus /></template>
          {{ t("library.addFolder") }}
        </SButton>
      </div>
      <SongList
        v-else-if="view === 'songs'"
        ref="songListRef"
        :items="tracks"
        :search-query="searchQuery"
        :playback-context="playbackContext"
        compact
        enable-sort
        @track-updated="libraryStore.applyTrackUpdates"
      />
      <CoverList
        v-else-if="visibleCovers.length > 0"
        :key="view"
        :items="visibleCovers"
        :min-size="180"
        :gap="28"
        :padding-top="4"
        :padding-bottom="28"
      >
        <template #item="{ item }: { item: LibraryCoverItem }">
          <LibraryCoverCard
            :item="item"
            :kind="item.kind"
            @open="handleOpenItem(item)"
            @play="handlePlayItem(item)"
          />
        </template>
      </CoverList>
      <div v-else class="library-empty">
        <div class="library-empty-icon"><IconLucideSearchX class="size-9" /></div>
        <h2>
          {{
            t(
              searchQuery.trim()
                ? "library.noResults"
                : view === "artists"
                  ? "library.noArtists"
                  : "library.noAlbums",
            )
          }}
        </h2>
        <p>
          {{
            t(
              searchQuery.trim()
                ? "library.searchHint"
                : view === "artists"
                  ? "library.noArtistsHint"
                  : "library.noAlbumsHint",
            )
          }}
        </p>
        <SButton v-if="searchQuery.trim()" variant="secondary" @click="searchQuery = ''">
          {{ t("library.clearSearch") }}
        </SButton>
      </div>
    </section>

    <SDialog
      v-model:open="folderDialogOpen"
      :title="t('library.folders')"
      :description="t('library.foldersDescription')"
      width="480px"
    >
      <FolderManager @added="libraryStore.startScan(false)" />
    </SDialog>
  </div>
</template>

<style scoped>
.library-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 20px 32px 0;
  color: rgb(var(--s-on-surface));
}

.library-header {
  flex-shrink: 0;
}

.library-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 24px;
}

.library-eyebrow {
  margin-bottom: 4px;
  color: rgb(var(--s-on-surface-variant) / 0.65);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.library-heading h1 {
  font-size: 42px;
  font-weight: 750;
  line-height: 1.15;
  letter-spacing: -1.5px;
}

.library-stats {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 9px;
  color: rgb(var(--s-on-surface-variant) / 0.7);
  font-size: 13px;
}

.library-add {
  color: rgb(var(--s-primary));
}

.library-navigation {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  border-bottom: 1px solid rgb(var(--s-on-surface) / 0.1);
}

.library-tabs {
  display: flex;
  gap: 28px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.library-tabs button {
  position: relative;
  flex-shrink: 0;
  padding: 14px 0 16px;
  border: 0;
  background: transparent;
  color: rgb(var(--s-on-surface-variant) / 0.7);
  font-size: 14px;
  font-weight: 550;
  white-space: nowrap;
  cursor: pointer;
  transition: color 150ms ease;
}

.library-tabs button:hover,
.library-tabs button.is-active {
  color: rgb(var(--s-primary));
}

.library-tabs button.is-active::after {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 3px;
  border-radius: 3px 3px 0 0;
  background: currentColor;
  content: "";
}

.library-tabs button:focus-visible {
  outline-offset: -3px;
}

.library-search {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 224px;
  height: 34px;
  margin-bottom: 8px;
  padding: 0 10px;
  border: 1px solid rgb(var(--s-on-surface) / 0.08);
  border-radius: 7px;
  background: rgb(var(--s-on-surface) / 0.04);
  color: rgb(var(--s-on-surface-variant) / 0.65);
}

.library-search:focus-within {
  border-color: rgb(var(--s-primary) / 0.6);
  outline: 2px solid rgb(var(--s-primary) / 0.12);
}

.library-search input {
  width: 100%;
  min-width: 0;
  border: 0;
  background: transparent;
  color: rgb(var(--s-on-surface));
  font-size: 12px;
}

.library-search input::placeholder {
  color: rgb(var(--s-on-surface-variant) / 0.65);
}

.library-search input::-webkit-search-cancel-button {
  display: none;
}

.library-search button {
  display: flex;
  flex-shrink: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.library-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 24px 0 20px;
}

.library-section-title {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.library-section-title h2 {
  font-size: 22px;
  font-weight: 650;
  letter-spacing: -0.5px;
}

.library-section-title > span {
  color: rgb(var(--s-on-surface-variant) / 0.6);
  font-size: 12px;
}

.library-actions,
.library-sort {
  display: flex;
  align-items: center;
  gap: 8px;
}

.library-play {
  background: #d3294b;
  color: #fff;
  font-weight: 600;
}

.library-play:not(:disabled):hover {
  background: #bc2140;
}

.library-shuffle {
  color: rgb(var(--s-primary));
}

.library-newest {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: 12px;
  color: rgb(var(--s-on-surface-variant) / 0.6);
  font-size: 12px;
}

.library-sort {
  margin-left: 8px;
}

.library-sort :deep([role="combobox"]) {
  width: 170px;
  border-color: transparent;
  background: transparent;
  font-size: 12px;
}

.library-scan {
  margin-bottom: 16px;
}

.library-scan-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  color: rgb(var(--s-primary));
  font-size: 11px;
}

.library-scan-track {
  height: 2px;
  overflow: hidden;
  border-radius: 2px;
  background: rgb(var(--s-primary) / 0.1);
}

.library-scan-track > div {
  height: 100%;
  background: rgb(var(--s-primary));
  transition: width 200ms ease;
}

.library-content {
  flex: 1;
  min-height: 0;
}

.library-content:focus-visible {
  outline-offset: -2px;
}

.library-empty {
  display: flex;
  height: 100%;
  min-height: 240px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px 16px 112px;
  text-align: center;
}

.library-empty-icon {
  display: grid;
  width: 80px;
  height: 80px;
  margin-bottom: 8px;
  place-items: center;
  border-radius: 22px;
  background: rgb(var(--s-primary) / 0.08);
  color: rgb(var(--s-primary));
}

.library-empty h2 {
  font-size: 22px;
  font-weight: 650;
}

.library-empty p {
  margin-bottom: 8px;
  color: rgb(var(--s-on-surface-variant) / 0.65);
  font-size: 13px;
}

@media (max-width: 1100px) {
  .library-page {
    padding-right: 24px;
    padding-left: 24px;
  }

  .library-navigation {
    flex-wrap: wrap;
    gap: 8px;
  }

  .library-search {
    width: 100%;
    order: -1;
  }

  .library-toolbar {
    gap: 12px;
    padding-top: 20px;
  }

  .library-actions {
    flex-wrap: wrap;
  }
}

@media (max-width: 700px) {
  .library-page {
    padding: 12px 16px 0;
  }

  .library-heading {
    margin-bottom: 20px;
  }

  .library-heading h1 {
    font-size: 34px;
  }

  .library-tabs {
    width: 100%;
    gap: 22px;
  }

  .library-section-title {
    width: 100%;
  }

  .library-newest {
    margin-left: 4px;
  }

  .library-sort {
    margin-left: 0;
  }

  .library-sort :deep([role="combobox"]) {
    width: 140px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .library-tabs button,
  .library-scan-track > div {
    transition: none;
  }
}
</style>
