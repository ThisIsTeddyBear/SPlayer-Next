<script setup lang="ts">
import type { HeroContent } from "@/composables/home/useDailyRecommend";
import { extractColorFromImageElement, hexToRgb } from "@/utils/color";

const props = defineProps<{
  hero: HeroContent | null;
  loading: boolean;
  loadFailed: boolean;
}>();
const emit = defineEmits<{ play: []; queue: []; refresh: []; lucky: [] }>();
const { t } = useI18n();
const accent = ref<string | null>(null);
const artists = computed(() => props.hero?.track.artists.map((artist) => artist.name).join(" / "));

watch(
  () => props.hero?.track.cover,
  () => {
    accent.value = null;
  },
);

/**
 * 复用已解码的缩略图提取局部衬色，不改变全局主题或额外加载原图
 * @param image - 当前封面元素
 */
const onCoverLoad = (image: HTMLImageElement): void => {
  if (image.getAttribute("src") !== props.hero?.track.cover) return;
  const { primary } = extractColorFromImageElement(image);
  accent.value = primary ? hexToRgb(primary) : null;
};
</script>

<template>
  <section
    class="home-feature relative min-w-0 overflow-hidden rounded-3xl"
    :style="accent ? { '--home-feature-accent': accent } : undefined"
    :aria-label="hero?.title ?? t('home.hero.emptyTitle')"
    :aria-busy="loading"
  >
    <div v-if="loading && !hero" class="feature-content" role="status">
      <div class="feature-art rounded-2xl bg-on-surface/6" />
      <div class="flex min-w-0 flex-col gap-4">
        <span class="text-sm text-on-surface/75">{{ t("common.loading") }}</span>
        <div class="h-7 w-4/5 rounded-lg bg-on-surface/6" aria-hidden="true" />
        <div class="h-4 w-3/5 rounded-lg bg-on-surface/6" aria-hidden="true" />
        <div class="mt-3 h-10 w-32 rounded-full bg-on-surface/6" aria-hidden="true" />
      </div>
    </div>
    <div v-else-if="hero" class="feature-content">
      <SImg
        :src="hero.track.cover"
        :alt="hero.track.title"
        class="feature-art rounded-2xl shadow-lg"
        @load="onCoverLoad"
      />
      <div class="min-w-0">
        <div class="mb-3 flex items-center justify-between gap-3">
          <span class="rounded-full bg-on-surface/6 px-3 py-1 text-xs font-semibold text-on-surface">
            {{ hero.tag }}
          </span>
          <SButton
            class="shrink-0"
            variant="ghost"
            size="small"
            circle
            :loading="loading"
            :title="t('home.hero.refresh')"
            :aria-label="t('home.hero.refresh')"
            @click="emit('refresh')"
          >
            <template #icon><IconLucideRotateCw /></template>
          </SButton>
        </div>
        <h2 class="text-2xl font-bold leading-tight tracking-tight text-on-surface text-balance">
          {{ hero.title }}
        </h2>
        <p class="mt-2 text-xs leading-5 text-on-surface/75">{{ hero.subtitle }}</p>
        <div class="mt-4 min-w-0">
          <p
            class="line-clamp-2 text-base font-semibold leading-6 text-on-surface"
            :title="hero.track.title"
          >
            {{ hero.track.title }}
          </p>
          <p v-if="artists" class="mt-0.5 truncate text-sm text-on-surface/75" :title="artists">
            {{ artists }}
          </p>
        </div>
        <div class="mt-5 flex flex-wrap items-center gap-2">
          <SButton type="primary" size="large" round :disabled="loading" @click="emit('play')">
            <template #icon><IconLucidePlay /></template>
            {{ t("home.hero.play") }}
          </SButton>
          <SButton
            variant="secondary"
            size="large"
            circle
            :disabled="loading"
            :title="t('home.hero.addQueue')"
            :aria-label="t('home.hero.addQueue')"
            @click="emit('queue')"
          >
            <template #icon><IconLucidePlus /></template>
          </SButton>
          <SButton
            variant="text"
            size="small"
            :title="t('home.quickActions.luck.desc')"
            :disabled="loading"
            @click="emit('lucky')"
          >
            <template #icon><IconLucideShuffle /></template>
            {{ t("home.hero.surprise") }}
          </SButton>
        </div>
      </div>
    </div>
    <div v-else class="flex min-h-72 flex-col items-start justify-center gap-4 p-7">
      <span class="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <IconLucideMusic class="size-6" aria-hidden="true" />
      </span>
      <div>
        <h2 class="text-2xl font-bold tracking-tight text-on-surface">
          {{ t(loadFailed ? "home.hero.loadFailed" : "home.hero.emptyTitle") }}
        </h2>
        <p class="mt-2 max-w-96 text-sm leading-6 text-on-surface/75">
          {{ t(loadFailed ? "home.hero.retryDescription" : "home.hero.emptyDescription") }}
        </p>
      </div>
      <SButton v-if="loadFailed" type="primary" round @click="emit('refresh')">
        {{ t("common.retry") }}
      </SButton>
      <RouterLink v-else to="/library" class="feature-library-link">
        {{ t("home.hero.openLibrary") }}
        <IconLucideChevronRight class="size-4" aria-hidden="true" />
      </RouterLink>
    </div>
  </section>
</template>

<style scoped>
.home-feature {
  container-type: inline-size;
  background-color: rgb(var(--s-surface-panel));
  background-image: radial-gradient(
    ellipse at 0% 0%,
    rgb(var(--home-feature-accent, var(--s-primary)) / 0.12),
    transparent 75%
  );
}

.feature-content {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: center;
  gap: 24px;
  padding: 28px;
  min-height: 300px;
}

.feature-art {
  width: 160px;
  height: 160px;
}

.feature-library-link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: 999px;
  background: rgb(var(--s-primary));
  color: rgb(var(--s-on-primary));
  text-decoration: none;
  font-weight: 600;
}

.feature-library-link:focus-visible {
  outline: 2px solid rgb(var(--s-primary));
  outline-offset: 3px;
}

@container (min-width: 540px) {
  .feature-content {
    grid-template-columns: 180px minmax(0, 1fr);
    gap: 28px;
  }

  .feature-art {
    width: 180px;
    height: 180px;
  }
}
</style>
