<script setup lang="ts">
defineOptions({ name: "Home" });

import type { Track } from "@shared/types/player";
import type { RecognitionCandidate } from "@shared/types/recognition";
import HomeFeatured from "@/components/home/HomeFeatured.vue";
import HomeRecentTracks from "@/components/home/HomeRecentTracks.vue";
import HomeMusicCard from "@/components/home/HomeMusicCard.vue";
import { useHomeHeader } from "@/composables/home/useHomeHeader";
import { useDailyRecommend } from "@/composables/home/useDailyRecommend";
import { useContinueListening } from "@/composables/home/useContinueListening";
import { useRecentRecognitions } from "@/composables/home/useRecentRecognitions";
import { useQuickActions } from "@/composables/home/useQuickActions";
import { useFloatingPlayerBar } from "@/composables/useFloatingPlayerBar";
import { useHistoryStore } from "@/stores/history";
import { useMediaStore } from "@/stores/media";
import { useStatusStore } from "@/stores/status";
import * as player from "@/core/player";

const { t } = useI18n();
const { isFloatingBar } = useFloatingPlayerBar();
const history = useHistoryStore();
const media = useMediaStore();
const status = useStatusStore();
const { greetingTitle, greetingSub, listeningSummary, load: loadHeader } = useHomeHeader();
const {
  hero,
  loading: heroLoading,
  loadFailed: heroFailed,
  playAll: playHero,
  addToQueue: addHeroToQueue,
  load: loadHero,
} = useDailyRecommend();
const { playLucky } = useQuickActions();
const {
  items: continueItems,
  title: continueTitle,
  subtitle: continueSubtitle,
  loading: continueLoading,
  loadFailed: continueFailed,
  load: loadContinue,
} = useContinueListening();
const { entries: recognitionEntries } = useRecentRecognitions();
const recentTracks = computed(() => history.tracks.slice(0, 6));
const activityReady = ref(false);
let active = false;
let refreshing = false;
let refreshQueued = false;

/** 合并播放变化造成的并发刷新，缓存页面隐藏时停止请求 */
const refreshActivity = async (): Promise<void> => {
  if (!active || document.visibilityState !== "visible") return;
  if (refreshing) {
    refreshQueued = true;
    return;
  }
  refreshing = true;
  try {
    await Promise.all([loadHeader(), loadContinue()]);
    activityReady.value = true;
  } finally {
    refreshing = false;
    if (refreshQueued) {
      refreshQueued = false;
      void refreshActivity();
    }
  }
};

onMounted(() => {
  void loadHero();
});
onActivated(() => {
  active = true;
  void refreshActivity();
  if (!hero.value && !heroLoading.value) void loadHero();
});
onDeactivated(() => {
  active = false;
});
onBeforeUnmount(() => {
  active = false;
});
watch(
  () => history.entries,
  () => {
    if (activityReady.value) void refreshActivity();
  },
);
useEventListener(document, "visibilitychange", () => {
  if (document.visibilityState === "visible") void refreshActivity();
});

/**
 * 用来源与曲目编号标记当前播放项，避免同名歌曲被误标。
 * @param track - 首页中的轻量曲目
 * @returns 是否为当前加载的曲目
 */
const isCurrentTrack = (track: Track): boolean =>
  track.id === media.track?.id && track.source === media.track?.source;

/**
 * 从首页播放曲目，保留队列来源名称
 * @param track - 所选轻量曲目
 */
const playTrack = (track: Track): void => {
  if (isCurrentTrack(track)) {
    player.togglePlay();
    return;
  }
  void player.playNow(track, {
    originId: "home",
    originType: "page",
    originName: t("nav.home"),
  });
};

/**
 * 复用导航栏识别弹窗，避免重复挂载会话监听
 * @param candidate - 选中的识别结果，省略时打开完整历史
 */
const openRecognition = (candidate?: RecognitionCandidate): void => {
  status.recognitionCandidate = candidate ?? null;
  status.recognitionView = candidate ? "recognize" : "history";
  status.recognitionOpen = true;
};
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div
      class="home-shell mx-auto flex max-w-[1320px] flex-col gap-6 px-5 pt-5"
      :class="isFloatingBar ? 'pb-28' : 'pb-10'"
    >
      <header class="home-header">
        <div class="min-w-0">
          <h1 class="home-greeting text-on-surface">
            {{ greetingTitle }}
          </h1>
          <p class="mt-1.5 text-sm leading-6 text-on-surface/65">{{ greetingSub }}</p>
        </div>
        <RouterLink
          to="/stats"
          class="home-activity-link"
          :title="t('home.stats.open')"
          :aria-label="t('home.stats.open')"
        >
          <IconLucideChartNoAxesCombined class="size-4 shrink-0 text-primary" aria-hidden="true" />
          <span v-if="listeningSummary" class="home-activity-summary">{{ listeningSummary }}</span>
          <span>{{ t("home.stats.activity") }}</span>
          <IconLucideChevronRight class="size-3.5 shrink-0" aria-hidden="true" />
        </RouterLink>
      </header>

      <div class="home-feature-grid">
        <HomeFeatured
          :hero="hero"
          :loading="heroLoading"
          :load-failed="heroFailed"
          @play="playHero"
          @queue="addHeroToQueue"
          @refresh="loadHero"
          @lucky="playLucky"
        />
        <HomeRecentTracks
          :tracks="recentTracks"
          :loading="!activityReady"
          :current-track="media.track"
          :playing="status.isPlaying"
          @select="playTrack"
        />
      </div>

      <section
        class="home-section"
        aria-labelledby="home-listening-title"
        :aria-busy="continueLoading"
      >
        <div class="home-section-header">
          <div class="min-w-0">
            <h2
              id="home-listening-title"
              class="text-xl font-semibold tracking-tight text-on-surface"
            >
              {{ continueTitle }}
            </h2>
            <p v-if="continueSubtitle" class="mt-1 text-xs text-on-surface/65">
              {{ continueSubtitle }}
            </p>
          </div>
          <RouterLink
            to="/stats"
            class="home-section-link"
            :title="t('home.stats.open')"
            :aria-label="t('home.stats.open')"
          >
            {{ t("home.stats.view") }}
            <IconLucideChevronRight class="size-3.5" aria-hidden="true" />
          </RouterLink>
        </div>
        <div v-if="continueLoading && !continueItems.length" class="home-music-grid" role="status">
          <span class="sr-only">{{ t("common.loading") }}</span>
          <div v-for="index in 6" :key="index" aria-hidden="true">
            <div class="aspect-square rounded-xl bg-on-surface/6" />
            <div class="mt-3 h-4 w-4/5 rounded bg-on-surface/6" />
            <div class="mt-2 h-3 w-3/5 rounded bg-on-surface/6" />
          </div>
        </div>
        <div v-else-if="continueItems.length" class="home-music-grid">
          <HomeMusicCard
            v-for="item in continueItems"
            :key="item.track.source + ':' + item.track.id"
            :title="item.track.title"
            :subtitle="item.track.artists.map((artist) => artist.name).join(' / ')"
            :cover="item.track.cover"
            :caption="t('home.continue.playCount', { count: item.playCount }, item.playCount)"
            :current="isCurrentTrack(item.track)"
            :playing="status.isPlaying"
            :action-label="
              t(
                isCurrentTrack(item.track) && status.isPlaying ? 'home.pauseTrack' : 'home.playTrack',
                { title: item.track.title },
              )
            "
            @select="playTrack(item.track)"
          />
        </div>
        <div
          v-else
          class="flex min-h-40 flex-col items-center justify-center gap-3 px-4 text-center"
        >
          <IconLucideHeadphones class="size-8 text-on-surface/70" aria-hidden="true" />
          <p class="text-sm leading-6 text-on-surface/75">
            {{ t(continueFailed ? "home.continue.loadFailed" : "home.continue.empty") }}
          </p>
          <SButton v-if="continueFailed" variant="secondary" round @click="refreshActivity">
            {{ t("common.retry") }}
          </SButton>
        </div>
      </section>

      <section
        v-if="recognitionEntries.length"
        class="home-section"
        aria-labelledby="home-recognition-title"
      >
        <div class="home-section-header">
          <div class="min-w-0">
            <h2
              id="home-recognition-title"
              class="text-xl font-semibold tracking-tight text-on-surface"
            >
              {{ t("home.recognition.title") }}
            </h2>
            <p class="mt-1 text-xs text-on-surface/65">{{ t("home.recognition.subtitle") }}</p>
          </div>
          <button type="button" class="home-section-link" @click="openRecognition()">
            {{ t("home.recognition.viewHistory") }}
            <IconLucideChevronRight class="size-3.5" aria-hidden="true" />
          </button>
        </div>
        <div class="home-music-grid">
          <HomeMusicCard
            v-for="entry in recognitionEntries"
            :key="entry.candidate.songId"
            :title="entry.candidate.title"
            :subtitle="entry.candidate.artists.join(' / ')"
            :cover="entry.candidate.cover"
            :action-label="t('home.recognition.openTrack', { title: entry.candidate.title })"
            action="details"
            @select="openRecognition(entry.candidate)"
          />
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.home-shell {
  --home-panel: color-mix(in srgb, #ffffff 86%, rgb(var(--s-surface-panel)));
  --home-tile: color-mix(in srgb, var(--home-panel) 88%, transparent);
  container-type: inline-size;
}

:global(.dark .home-shell) {
  --home-panel: color-mix(in srgb, #18181b 86%, rgb(var(--s-surface-panel)));
}

.home-header {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
}

.home-greeting {
  font-size: clamp(26px, 3cqi, 32px);
  font-weight: 750;
  letter-spacing: -0.04em;
  line-height: 1.2;
  text-wrap: balance;
}

.home-feature-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 24px;
  align-items: center;
}

.home-section {
  min-width: 0;
}

.home-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.home-music-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.home-activity-link,
.home-section-link {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
  padding: 6px 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: rgb(var(--s-on-surface) / 0.65);
  font-size: 12px;
  text-decoration: none;
  cursor: pointer;
}

.home-activity-link {
  flex-wrap: wrap;
}

.home-activity-summary {
  margin-right: 4px;
  padding-right: 10px;
  border-right: 1px solid rgb(var(--s-on-surface) / 0.15);
  color: rgb(var(--s-on-surface) / 0.8);
}

.home-activity-link:hover,
.home-section-link:hover {
  color: rgb(var(--s-primary));
}

.home-activity-link:focus-visible,
.home-section-link:focus-visible {
  outline: 2px solid rgb(var(--s-primary));
  outline-offset: 4px;
}

@container (min-width: 600px) {
  .home-music-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@container (min-width: 840px) {
  .home-header {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
  }

  .home-music-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@container (min-width: 1040px) {
  .home-feature-grid {
    grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
  }
}

@container (min-width: 1120px) {
  .home-music-grid {
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 20px;
  }
}
</style>
