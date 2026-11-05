<script setup lang="ts">
import type { CoverItem } from "@/types/artist";
import artistFallback from "@/assets/images/artist.jpg";

defineProps<{
  item: CoverItem;
  kind: "album" | "artist" | "track";
}>();

defineEmits<{ open: []; play: [] }>();

const { t } = useI18n();
</script>

<template>
  <article class="library-cover-card" :class="{ 'is-artist': kind === 'artist' }">
    <div class="library-artwork">
      <button
        type="button"
        class="library-artwork-open"
        :aria-label="t(kind === 'track' ? 'library.playItem' : 'library.openItem', { name: item.title })"
        @click="$emit('open')"
      >
        <SImg
          :src="item.cover"
          :fallback="kind === 'artist' ? artistFallback : undefined"
          class="library-artwork-image"
        />
      </button>
      <button
        type="button"
        class="library-artwork-play"
        :aria-label="t('library.playItem', { name: item.title })"
        @click="$emit('play')"
      >
        <IconLucidePlay class="size-4.5 fill-current" aria-hidden="true" />
      </button>
    </div>
    <div class="library-cover-info">
      <button type="button" class="library-cover-title" :title="item.title" @click="$emit('open')">
        {{ item.title }}
      </button>
      <p v-if="item.subtitle" class="library-cover-subtitle" :title="item.subtitle">
        {{ item.subtitle }}
      </p>
    </div>
  </article>
</template>

<style scoped>
.library-cover-card {
  min-width: 0;
}

.library-artwork {
  position: relative;
  aspect-ratio: 1;
  border-radius: 8px;
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.12);
}

.library-artwork-open {
  display: block;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border: 0;
  border-radius: inherit;
  background: rgb(var(--s-on-surface) / 0.04);
  cursor: pointer;
}

.library-artwork-image {
  width: 100%;
  height: 100%;
  transition: opacity 180ms ease;
}

.library-cover-card:hover .library-artwork-image {
  opacity: 0.85;
}

.library-artwork-play {
  position: absolute;
  right: 12px;
  bottom: 12px;
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  padding-left: 2px;
  border: 1px solid rgb(255 255 255 / 0.2);
  border-radius: 50%;
  background: rgb(20 20 22 / 0.85);
  color: #fff;
  opacity: 0;
  cursor: pointer;
  transition:
    opacity 180ms ease,
    background-color 180ms ease;
}

.library-cover-card:hover .library-artwork-play,
.library-cover-card:focus-within .library-artwork-play {
  opacity: 1;
}

.library-artwork-play:hover {
  background: #d3294b;
}

.library-cover-info {
  height: 76px;
  padding-top: 12px;
}

.library-cover-title {
  display: -webkit-box;
  width: 100%;
  overflow: hidden;
  border: 0;
  background: transparent;
  color: rgb(var(--s-on-surface));
  font-size: 14px;
  font-weight: 550;
  line-height: 19px;
  text-align: left;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  cursor: pointer;
}

.library-cover-title:hover {
  color: rgb(var(--s-primary));
}

.library-cover-subtitle {
  overflow: hidden;
  margin-top: 3px;
  color: rgb(var(--s-on-surface-variant) / 0.65);
  font-size: 12px;
  line-height: 17px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.is-artist .library-artwork {
  border-radius: 50%;
}

.is-artist .library-cover-title,
.is-artist .library-cover-subtitle {
  text-align: center;
}

@media (hover: none) {
  .library-artwork-play {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .library-artwork-image,
  .library-artwork-play {
    transition: none;
  }
}
</style>
