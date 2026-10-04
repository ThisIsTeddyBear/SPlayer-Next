<script setup lang="ts">
import type { Track } from "@shared/types/player";

defineProps<{ tracks: Track[]; loading: boolean }>();
const emit = defineEmits<{ select: [track: Track] }>();
const { t } = useI18n();
</script>

<template>
  <section class="min-w-0 rounded-3xl bg-surface-panel p-5" aria-labelledby="home-recent-title">
    <div class="mb-3 flex items-center justify-between gap-2">
      <h2 id="home-recent-title" class="text-lg font-semibold tracking-tight text-on-surface">
        {{ t("home.recent.title") }}
      </h2>
      <RouterLink
        to="/history"
        class="recent-history-link shrink-0 rounded-full p-2 text-on-surface/75 hover:bg-on-surface/6"
        :title="t('home.recent.viewHistory')"
        :aria-label="t('home.recent.viewHistory')"
      >
        <IconLucideChevronRight class="size-4" aria-hidden="true" />
      </RouterLink>
    </div>
    <div v-if="loading" class="flex min-h-52 items-center justify-center" role="status">
      <SLoading class="size-5 text-on-surface" :aria-label="t('common.loading')" />
    </div>
    <ul v-else-if="tracks.length" class="m-0 list-none p-0">
      <li v-for="track in tracks" :key="`${track.source}:${track.id}`">
        <button
          type="button"
          class="recent-track-button group flex w-full min-w-0 appearance-none items-center gap-3 rounded-xl border-none bg-transparent p-2 text-left text-on-surface cursor-pointer transition-colors hover:bg-on-surface/5"
          :aria-label="t('home.playTrack', { title: track.title })"
          :title="track.title"
          @click="emit('select', track)"
        >
          <SImg :src="track.cover" alt="" class="size-11 shrink-0 rounded-lg" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-semibold">{{ track.title }}</span>
            <span class="mt-0.5 block truncate text-xs text-on-surface/75">
              {{ track.artists.map((artist) => artist.name).join(" / ") }}
            </span>
          </span>
          <IconLucidePlay
            class="size-4 shrink-0 text-on-surface/75 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
            aria-hidden="true"
          />
        </button>
      </li>
    </ul>
    <div v-else class="flex min-h-52 flex-col items-center justify-center gap-3 px-4 text-center">
      <IconLucideHeadphones class="size-8 text-on-surface/70" aria-hidden="true" />
      <p class="text-sm font-medium text-on-surface">{{ t("home.recent.emptyTitle") }}</p>
      <p class="max-w-64 text-xs leading-5 text-on-surface/75">
        {{ t("home.recent.emptyDescription") }}
      </p>
    </div>
  </section>
</template>

<style scoped>
.recent-track-button:focus-visible,
.recent-history-link:focus-visible {
  outline: 2px solid rgb(var(--s-primary));
  outline-offset: -2px;
}

.recent-history-link {
  display: inline-flex;
  text-decoration: none;
}

@media (prefers-reduced-motion: reduce) {
  .recent-track-button,
  .recent-track-button svg {
    transition: none;
  }
}
</style>
