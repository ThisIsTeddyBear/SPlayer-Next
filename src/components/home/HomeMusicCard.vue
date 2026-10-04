<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string;
    subtitle?: string;
    cover?: string;
    caption?: string;
    actionLabel: string;
    action?: "play" | "details";
  }>(),
  { action: "play" },
);
defineEmits<{ select: [] }>();
</script>

<template>
  <button
    type="button"
    class="home-music-card group flex w-full min-w-0 appearance-none flex-col rounded-2xl border-none bg-transparent p-2 text-left text-on-surface cursor-pointer"
    :aria-label="actionLabel"
    :title="title"
    @click="$emit('select')"
  >
    <span class="music-card-art relative block w-full overflow-hidden rounded-xl">
      <SImg :src="cover" alt="" class="aspect-square w-full" />
      <span
        class="music-card-action absolute bottom-3 right-3 flex size-11 items-center justify-center rounded-full bg-primary text-on-primary shadow-md"
        aria-hidden="true"
      >
        <IconLucidePlay v-if="action === 'play'" class="size-5" />
        <IconLucideChevronRight v-else class="size-5" />
      </span>
    </span>
    <span class="mt-3 line-clamp-2 min-h-10 text-sm font-semibold leading-5">{{ title }}</span>
    <span class="mt-1 block min-h-5 w-full truncate text-xs leading-5 text-on-surface/75">
      {{ subtitle }}
    </span>
    <span v-if="caption" class="mt-1 block text-xs leading-5 text-on-surface/70">
      {{ caption }}
    </span>
  </button>
</template>

<style scoped>
.home-music-card {
  transition: background-color 160ms ease;
}

.home-music-card:hover,
.home-music-card:focus-visible {
  background-color: rgb(var(--s-on-surface) / 0.04);
}

.home-music-card:focus-visible {
  outline: 2px solid rgb(var(--s-primary));
  outline-offset: -2px;
}

.music-card-art {
  box-shadow: 0 4px 14px rgb(var(--s-on-surface) / 0.08);
}

.music-card-action {
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

@media (hover: none) {
  .music-card-action {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .home-music-card,
  .music-card-action {
    transition: none;
  }
}
</style>
