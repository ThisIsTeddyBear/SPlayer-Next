<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string;
    subtitle?: string;
    cover?: string;
    caption?: string;
    actionLabel: string;
    action?: "play" | "details";
    current?: boolean;
    playing?: boolean;
  }>(),
  { action: "play", current: false, playing: false },
);
defineEmits<{ select: [] }>();
const { t } = useI18n();
</script>

<template>
  <button
    type="button"
    class="home-music-card"
    :data-current="current || undefined"
    :aria-current="current ? 'true' : undefined"
    :aria-label="actionLabel"
    :title="title"
    @click="$emit('select')"
  >
    <span class="music-card-art">
      <SImg :src="cover" alt="" class="aspect-square w-full" />
      <span class="music-card-action" aria-hidden="true">
        <IconLucideChevronRight v-if="action === 'details'" class="size-5" />
        <IconLucidePause v-else-if="current && playing" class="size-5" />
        <IconLucidePlay v-else class="size-5" />
      </span>
    </span>
    <span class="mt-3 flex w-full min-w-0 items-center gap-2">
      <span class="music-card-title block min-w-0 flex-1 truncate text-sm font-semibold">
        {{ title }}
      </span>
      <IconLucideAudioLines
        v-if="current"
        class="size-4 shrink-0 text-primary"
        aria-hidden="true"
      />
    </span>
    <span
      class="mt-1 block min-h-5 w-full truncate text-xs leading-5 text-on-surface/65"
      :title="subtitle"
    >
      {{ subtitle }}
    </span>
    <span v-if="current || caption" class="music-card-caption" :class="current && 'text-primary'">
      {{ current ? t(playing ? "home.nowPlaying" : "home.currentTrack") : caption }}
    </span>
  </button>
</template>

<style scoped>
.home-music-card {
  display: flex;
  width: 100%;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  appearance: none;
  border: none;
  border-radius: 12px;
  background: transparent;
  color: rgb(var(--s-on-surface));
  text-align: left;
  cursor: pointer;
}

.home-music-card:focus-visible {
  outline: 2px solid rgb(var(--s-primary));
  outline-offset: 5px;
}

.music-card-art {
  position: relative;
  display: block;
  width: 100%;
  overflow: hidden;
  border-radius: 12px;
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.12);
  transition: box-shadow 180ms ease;
}

.home-music-card:hover .music-card-art,
.home-music-card:focus-visible .music-card-art {
  box-shadow: 0 8px 22px rgb(0 0 0 / 0.22);
}

.home-music-card[data-current] .music-card-art {
  box-shadow:
    0 0 0 2px rgb(var(--s-primary)),
    0 6px 18px rgb(0 0 0 / 0.12);
}

.home-music-card[data-current] .music-card-title {
  color: rgb(var(--s-primary));
}

.music-card-action {
  position: absolute;
  right: 10px;
  bottom: 10px;
  display: flex;
  width: 38px;
  height: 38px;
  align-items: center;
  justify-content: center;
  border: 1px solid rgb(255 255 255 / 0.14);
  border-radius: 50%;
  background: rgb(var(--s-primary));
  color: rgb(var(--s-on-primary));
  box-shadow: 0 3px 12px rgb(0 0 0 / 0.22);
  opacity: 0;
  transform: translateY(4px);
  transition:
    opacity 160ms ease,
    transform 160ms ease;
}

.home-music-card:hover .music-card-action,
.home-music-card:focus-visible .music-card-action {
  opacity: 1;
  transform: translateY(0);
}

.music-card-caption {
  display: block;
  width: 100%;
  margin-top: 4px;
  overflow: hidden;
  color: rgb(var(--s-on-surface) / 0.55);
  font-size: 11px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.music-card-caption.text-primary {
  color: rgb(var(--s-primary));
}

@media (hover: none) {
  .music-card-action {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .music-card-art,
  .music-card-action {
    transition: none;
  }
}
</style>
