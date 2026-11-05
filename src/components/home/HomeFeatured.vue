<script setup lang="ts">
import type { HeroContent } from "@/composables/home/useDailyRecommend";

defineProps<{
  hero: HeroContent | null;
  loading: boolean;
  loadFailed: boolean;
}>();
const emit = defineEmits<{ play: []; queue: []; refresh: []; lucky: [] }>();
const { t } = useI18n();
</script>

<template>
  <section
    class="home-feature"
    :aria-label="hero?.title ?? t('home.hero.emptyTitle')"
    :aria-busy="loading"
  >
    <div v-if="loading && !hero" class="feature-content" role="status">
      <span class="sr-only">{{ t("common.loading") }}</span>
      <div class="min-w-0" aria-hidden="true">
        <div class="h-3 w-24 rounded bg-on-surface/6" />
        <div class="mt-4 h-8 w-4/5 rounded-lg bg-on-surface/6" />
        <div class="mt-3 h-4 w-full rounded bg-on-surface/6" />
        <div class="mt-6 h-10 w-32 rounded-full bg-on-surface/6" />
      </div>
      <div class="feature-artwork bg-on-surface/6" aria-hidden="true" />
    </div>
    <div v-else-if="hero" class="feature-content">
      <div class="feature-copy">
        <div class="feature-eyebrow">
          <span class="feature-tag">{{ hero.tag }}</span>
          <span class="feature-count">
            {{ t("home.hero.trackCount", { count: hero.trackCount }, hero.trackCount) }}
          </span>
        </div>
        <h2 class="feature-title">{{ hero.title }}</h2>
        <p class="feature-description">{{ hero.subtitle }}</p>
        <div class="feature-actions">
          <SButton type="primary" size="large" round :disabled="loading" @click="emit('play')">
            <template #icon><IconLucidePlay /></template>
            {{ t("home.hero.play") }}
          </SButton>
          <SButton
            variant="ghost"
            size="large"
            circle
            :disabled="loading"
            :title="t('home.hero.addQueue', { count: hero.trackCount }, hero.trackCount)"
            :aria-label="t('home.hero.addQueue', { count: hero.trackCount }, hero.trackCount)"
            @click="emit('queue')"
          >
            <template #icon><IconLucidePlus /></template>
          </SButton>
          <SButton
            variant="ghost"
            size="large"
            circle
            :disabled="loading"
            :title="t('home.hero.surprise')"
            :aria-label="t('home.quickActions.luck.desc')"
            @click="emit('lucky')"
          >
            <template #icon><IconLucideShuffle /></template>
          </SButton>
          <SButton
            variant="ghost"
            size="large"
            circle
            :loading="loading"
            :title="t('home.hero.refresh')"
            :aria-label="t('home.hero.refresh')"
            @click="emit('refresh')"
          >
            <template #icon><IconLucideRotateCw /></template>
          </SButton>
        </div>
      </div>
      <div class="feature-artwork" :data-count="hero.artworks.length || 1" aria-hidden="true">
        <SImg v-for="cover in hero.artworks" :key="cover" :src="cover" class="feature-cover" />
        <SImg v-if="!hero.artworks.length" class="feature-cover" />
      </div>
    </div>
    <div v-else class="feature-empty">
      <IconLucideMusic class="size-7 text-primary" aria-hidden="true" />
      <div>
        <h2 class="text-2xl font-bold tracking-tight text-on-surface">
          {{ t(loadFailed ? "home.hero.loadFailed" : "home.hero.emptyTitle") }}
        </h2>
        <p class="mt-2 max-w-96 text-sm leading-6 text-on-surface/70">
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
  min-width: 0;
  overflow: hidden;
  container-type: inline-size;
  border: 1px solid rgb(var(--s-on-surface) / 0.08);
  border-radius: 22px;
  background-color: var(--home-panel, rgb(var(--s-surface-panel)));
  background-image: radial-gradient(
    ellipse at 100% 0%,
    rgb(var(--s-primary) / 0.1),
    transparent 72%
  );
  box-shadow:
    inset 0 1px 0 rgb(var(--s-on-surface) / 0.03),
    0 8px 24px rgb(0 0 0 / 0.06);
}

.feature-content {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: center;
  gap: 24px;
  min-height: 248px;
  padding: 24px;
}

.feature-copy {
  min-width: 0;
}

.feature-eyebrow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.feature-tag {
  color: rgb(var(--s-primary));
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.feature-count {
  padding: 3px 8px;
  border: 1px solid rgb(var(--s-on-surface) / 0.08);
  border-radius: 999px;
  color: rgb(var(--s-on-surface) / 0.65);
  font-size: 11px;
  white-space: nowrap;
}

.feature-title {
  margin-top: 12px;
  color: rgb(var(--s-on-surface));
  font-size: clamp(24px, 4.4cqi, 30px);
  font-weight: 750;
  line-height: 1.12;
  letter-spacing: -0.035em;
  text-wrap: balance;
}

.feature-description {
  max-width: 34ch;
  margin-top: 10px;
  color: rgb(var(--s-on-surface) / 0.7);
  font-size: 13px;
  line-height: 1.6;
}

.feature-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-top: 20px;
}

.feature-actions > :first-child {
  margin-right: 6px;
}

.feature-artwork {
  display: grid;
  grid-row: 1;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-template-rows: repeat(2, minmax(0, 1fr));
  gap: 3px;
  width: 160px;
  aspect-ratio: 1;
  justify-self: center;
  overflow: hidden;
  border-radius: 16px;
  box-shadow: 0 12px 28px rgb(0 0 0 / 0.18);
}

.feature-cover {
  min-width: 0;
  min-height: 0;
}

.feature-artwork[data-count="1"] .feature-cover {
  grid-area: 1 / 1 / 3 / 3;
}

.feature-artwork[data-count="2"] .feature-cover,
.feature-artwork[data-count="3"] .feature-cover:first-child {
  grid-row: span 2;
}

.feature-empty {
  display: flex;
  min-height: 248px;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 16px;
  padding: 24px;
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

@container (min-width: 480px) {
  .feature-content {
    grid-template-columns: minmax(0, 1fr) 156px;
    gap: 20px;
  }

  .feature-artwork {
    grid-row: auto;
    width: 156px;
  }
}

@container (min-width: 650px) {
  .feature-content {
    grid-template-columns: minmax(0, 1fr) 200px;
    gap: 28px;
  }

  .feature-artwork {
    width: 200px;
  }
}
</style>
