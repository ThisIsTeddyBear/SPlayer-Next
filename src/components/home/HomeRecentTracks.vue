<script setup lang="ts">
import type { Track } from "@shared/types/player";

const props = defineProps<{
  tracks: Track[];
  loading: boolean;
  currentTrack: Track | null;
  playing: boolean;
}>();
const emit = defineEmits<{ select: [track: Track] }>();
const { t } = useI18n();
const items = computed(() =>
  props.tracks.map((track) => ({
    track,
    current: track.id === props.currentTrack?.id && track.source === props.currentTrack?.source,
  })),
);
</script>

<template>
  <section class="home-recent" aria-labelledby="home-recent-title" :aria-busy="loading">
    <div class="recent-header">
      <h2 id="home-recent-title" class="text-lg font-semibold tracking-tight text-on-surface">
        {{ t("home.recent.title") }}
      </h2>
      <RouterLink to="/history" class="recent-history-link">
        {{ t("home.recent.viewHistory") }}
        <IconLucideChevronRight class="size-3.5" aria-hidden="true" />
      </RouterLink>
    </div>
    <div v-if="loading && !tracks.length" class="recent-grid" role="status">
      <span class="sr-only">{{ t("common.loading") }}</span>
      <div v-for="index in 6" :key="index" class="recent-track-button" aria-hidden="true">
        <div class="size-11 shrink-0 rounded-lg bg-on-surface/6" />
        <div class="min-w-0 flex-1">
          <div class="h-3 w-4/5 rounded bg-on-surface/6" />
          <div class="mt-2 h-2.5 w-3/5 rounded bg-on-surface/6" />
        </div>
      </div>
    </div>
    <ul v-else-if="items.length" class="recent-grid m-0 list-none p-0">
      <li v-for="item in items" :key="`${item.track.source}:${item.track.id}`" class="min-w-0">
        <button
          type="button"
          class="recent-track-button"
          :data-current="item.current || undefined"
          :aria-current="item.current ? 'true' : undefined"
          :aria-label="
            t(item.current && playing ? 'home.pauseTrack' : 'home.playTrack', {
              title: item.track.title,
            })
          "
          :title="item.track.title"
          @click="emit('select', item.track)"
        >
          <span class="recent-artwork">
            <SImg :src="item.track.cover" alt="" class="size-full" />
            <span class="recent-track-overlay" aria-hidden="true">
              <IconLucidePause v-if="item.current && playing" class="size-4" />
              <IconLucidePlay v-else class="size-4" />
            </span>
          </span>
          <span class="min-w-0 flex-1">
            <span class="recent-track-title block truncate text-sm font-semibold">
              {{ item.track.title }}
            </span>
            <span class="mt-1 block truncate text-xs text-on-surface/65">
              {{ item.track.artists.map((artist) => artist.name).join(" / ") }}
            </span>
          </span>
          <IconLucideAudioLines
            v-if="item.current"
            class="size-3.5 shrink-0 text-primary"
            aria-hidden="true"
          />
        </button>
      </li>
    </ul>
    <div v-else class="recent-empty">
      <IconLucideHeadphones class="size-7 text-primary" aria-hidden="true" />
      <p class="text-sm font-medium text-on-surface">{{ t("home.recent.emptyTitle") }}</p>
      <p class="max-w-64 text-xs leading-5 text-on-surface/65">
        {{ t("home.recent.emptyDescription") }}
      </p>
    </div>
  </section>
</template>

<style scoped>
.home-recent {
  min-width: 0;
  container-type: inline-size;
}

.recent-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  min-height: 30px;
  margin-bottom: 14px;
}

.recent-history-link {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 5px 0;
  border-radius: 4px;
  color: rgb(var(--s-on-surface) / 0.65);
  font-size: 12px;
  text-decoration: none;
}

.recent-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
}

.recent-track-button {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: 10px;
  padding: 10px;
  appearance: none;
  border: 1px solid rgb(var(--s-on-surface) / 0.06);
  border-radius: 12px;
  background: var(--home-tile, rgb(var(--s-surface-panel)));
  color: rgb(var(--s-on-surface));
  text-align: left;
  cursor: pointer;
  transition:
    background-color 160ms ease,
    border-color 160ms ease;
}

.recent-track-button:hover,
.recent-track-button:focus-visible {
  background: var(--home-panel, rgb(var(--s-surface-panel)));
  border-color: rgb(var(--s-primary) / 0.3);
}

.recent-track-button[data-current] {
  border-color: rgb(var(--s-primary) / 0.4);
}

.recent-track-button[data-current] .recent-track-title {
  color: rgb(var(--s-primary));
}

.recent-track-button:focus-visible,
.recent-history-link:focus-visible {
  outline: 2px solid rgb(var(--s-primary));
  outline-offset: 3px;
}

.recent-artwork {
  position: relative;
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  overflow: hidden;
  border-radius: 7px;
}

.recent-track-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(0 0 0 / 0.45);
  color: white;
  opacity: 0;
  transition: opacity 160ms ease;
}

.recent-track-button:hover .recent-track-overlay,
.recent-track-button:focus-visible .recent-track-overlay {
  opacity: 1;
}

.recent-empty {
  display: flex;
  min-height: 214px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 20px;
  border: 1px dashed rgb(var(--s-on-surface) / 0.12);
  border-radius: 16px;
  text-align: center;
}

@container (min-width: 360px) {
  .recent-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (hover: none) {
  .recent-track-overlay {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .recent-track-button,
  .recent-track-overlay {
    transition: none;
  }
}
</style>
