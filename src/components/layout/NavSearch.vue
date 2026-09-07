<script setup lang="ts">
import { useDataStore } from "@/stores/data";
import { useLibraryStore } from "@/stores/library";
import { useStatusStore } from "@/stores/status";
import IconLucideAudioWaveform from "~icons/lucide/audio-waveform";
import IconLucideHistory from "~icons/lucide/history";
import IconLucideSearch from "~icons/lucide/search";
import IconLucideTrash2 from "~icons/lucide/trash-2";

const { t } = useI18n();
const router = useRouter();
const data = useDataStore();
const library = useLibraryStore();
const status = useStatusStore();

const dialogOpen = computed({
  get: () => status.searchOpen,
  set: (value: boolean) => (status.searchOpen = value),
});
const searchQuery = ref("");
const recognitionOpen = ref(false);
const query = computed(() => searchQuery.value.trim().toLocaleLowerCase());

const suggestions = computed(() => {
  if (!query.value) return [];
  return library.tracks
    .filter((track) => {
      const searchable = [
        track.title,
        track.comment,
        track.album?.name,
        track.album?.artist,
        ...track.artists.map((artist) => artist.name),
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();
      return searchable.includes(query.value);
    })
    .slice(0, 12);
});

const submit = (value = searchQuery.value): void => {
  const keyword = value.trim();
  if (!keyword) return;
  data.addSearchHistory(keyword);
  router.push({ name: "search", query: { q: keyword } });
  dialogOpen.value = false;
};

const onSearchKeydown = (event: KeyboardEvent): void => {
  if (event.key !== "Enter" || event.isComposing) return;
  event.preventDefault();
  submit();
};

const openSearch = async (): Promise<void> => {
  dialogOpen.value = true;
  if (!library.initialized) await library.load();
};

watch(dialogOpen, (open) => {
  if (!open) searchQuery.value = "";
});
</script>

<template>
  <div class="flex items-center gap-2 shrink-0">
    <button
      type="button"
      :aria-label="t('nav.searchPlaceholder')"
      class="app-no-drag w-60 h-10 px-4 cursor-pointer flex items-center gap-2 rounded-full border border-solid bg-on-surface/3 border-on-surface/15 hover:bg-on-surface/10 hover:border-on-surface/25 transition-colors duration-250 select-none"
      @click="openSearch"
    >
      <IconLucideSearch class="size-4 text-on-surface-variant/50 shrink-0" />
      <span class="flex-1 min-w-0 truncate text-left text-base text-on-surface-variant/40">
        {{ t("nav.searchPlaceholder") }}
      </span>
    </button>
    <SButton
      class="app-no-drag shrink-0"
      variant="tertiary"
      circle
      :size="40"
      :icon-size="20"
      @click="recognitionOpen = true"
    >
      <template #icon><IconLucideAudioWaveform /></template>
    </SButton>
  </div>

  <RecognitionDialog v-model:open="recognitionOpen" />
  <SDialog
    v-model:open="dialogOpen"
    :closable="false"
    :content-style="{ padding: 0 }"
    width="560px"
    top="12vh"
  >
    <div class="flex flex-col">
      <div class="px-4 pt-4 pb-3">
        <NavSearchInput
          v-model="searchQuery"
          :placeholder="t('nav.searchPlaceholder')"
          @keydown="onSearchKeydown"
          @search="submit"
        />
      </div>
      <div class="max-h-[65vh] overflow-y-auto px-4 pb-4 flex flex-col gap-4">
        <template v-if="query">
          <button
            type="button"
            class="min-w-0 flex items-center gap-2.5 px-2 py-2 rounded-lg border-none bg-transparent text-left hover:bg-on-surface/5 transition-colors"
            @click="submit()"
          >
            <IconLucideSearch class="size-4 shrink-0 text-primary" />
            <span class="flex-1 truncate text-sm text-on-surface">
              {{ t("nav.searchGoto", { keyword: searchQuery.trim() }) }}
            </span>
          </button>
          <button
            v-for="track in suggestions"
            :key="track.id"
            type="button"
            class="min-w-0 flex flex-col gap-0.5 px-2 py-2 rounded-lg border-none bg-transparent text-left hover:bg-on-surface/5 transition-colors"
            @click="submit(track.title)"
          >
            <span class="truncate text-sm text-on-surface">{{ track.title }}</span>
            <span class="truncate text-xs text-on-surface-variant">
              {{
                [...track.artists.map((artist) => artist.name), track.album?.name]
                  .filter(Boolean)
                  .join(" · ")
              }}
            </span>
          </button>
          <div
            v-if="suggestions.length === 0"
            class="py-8 text-center text-sm text-on-surface-variant"
          >
            {{ t("nav.searchEmpty") }}
          </div>
        </template>
        <template v-else>
          <div v-if="data.searchHistory.length" class="flex flex-col gap-2">
            <div class="px-2 flex items-center gap-1.5 text-sm font-medium text-primary">
              <IconLucideHistory class="size-4" />
              <span>{{ t("nav.searchSection.history") }}</span>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <STag
                v-for="keyword in data.searchHistory"
                :key="keyword"
                closable
                round
                class="cursor-pointer"
                @click="submit(keyword)"
                @close="data.removeSearchHistory(keyword)"
              >
                {{ keyword }}
              </STag>
            </div>
            <SButton
              variant="tertiary"
              size="tiny"
              class="self-start"
              @click="data.clearSearchHistory()"
            >
              <template #icon><IconLucideTrash2 /></template>
              {{ t("common.clear") }}
            </SButton>
          </div>
          <div v-else class="py-10 flex flex-col items-center gap-2 text-on-surface-variant/40">
            <IconLucideSearch class="size-8" />
            <span class="text-xs">{{ t("nav.searchEmpty") }}</span>
          </div>
        </template>
      </div>
    </div>
  </SDialog>
</template>
