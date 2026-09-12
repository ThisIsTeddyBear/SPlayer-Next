<script setup lang="ts">
import type { RecognitionCandidate } from "@shared/types/recognition";
import { toast } from "@/composables/useToast";
import { useRecognitionSession } from "@/composables/useRecognitionSession";
import { openExternal } from "@/utils/url";
import IconLucideArrowLeft from "~icons/lucide/arrow-left";
import IconLucideAudioWaveform from "~icons/lucide/audio-waveform";
import IconLucideSearch from "~icons/lucide/search";
import IconSpAppleMusic from "~icons/sp/apple-music";
import IconSpSoundcloud from "~icons/sp/soundcloud";
import IconSpSpotify from "~icons/sp/spotify";
import IconSpYoutube from "~icons/sp/youtube";

const { t } = useI18n();
const router = useRouter();
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();
const session = useRecognitionSession();
const { phase, level, candidates, error, supported } = session;

const isBusy = computed(() => ["capturing", "fingerprinting", "matching"].includes(phase.value));
const candidate = computed(() => candidates.value[0] ?? null);

watch(phase, (value) => {
  if (value === "error") {
    toast.error(t(`recognition.error.${error.value?.code ?? "unknown"}`));
    session.reset();
    return;
  }
  if (value === "done" && candidates.value.length === 0) {
    toast.info(t("recognition.empty"));
    session.reset();
    return;
  }
});

watch(
  () => props.open,
  (value) => {
    if (value) session.reset();
    else session.stop(false);
  },
);

const bars = computed(() => {
  const count = 14;
  // 保证弱信号也有明显波动
  const boosted = Math.min(1, Math.pow(level.value, 0.35) * 1.6);
  return Array.from({ length: count }, (_, index) => {
    const distance = Math.abs(index - (count - 1) / 2) / (count / 2);
    return Math.max(0.14, Math.min(1, boosted * (1 - distance * 0.55)));
  });
});

/** 关闭弹窗并跳转到歌曲搜索 */
const searchCandidate = (candidate: RecognitionCandidate): void => {
  onOpenUpdate(false);
  void router.push({
    name: "search",
    query: { q: [candidate.title, ...candidate.artists].join(" ") },
  });
};

type StreamingService = "appleMusic" | "spotify" | "youtube" | "soundcloud";

/** 在指定服务中打开搜索结果
 * @param service - 音乐服务
 */
const openInService = (service: StreamingService): void => {
  if (!candidate.value) return;

  const query = encodeURIComponent([candidate.value.title, ...candidate.value.artists].join(" "));
  const urls: Record<StreamingService, string> = {
    appleMusic: candidate.value.appleMusicUrl ?? `https://music.apple.com/us/search?term=${query}`,
    spotify: `https://open.spotify.com/search/${query}`,
    youtube: `https://www.youtube.com/results?search_query=${query}`,
    soundcloud: `https://soundcloud.com/search?q=${query}`,
  };
  openExternal(urls[service]);
};

const onOpenUpdate = (value: boolean): void => {
  emit("update:open", value);
};

const start = (): void => void session.start();
</script>

<template>
  <SDialog
    :open="props.open"
    :destroy-on-close="true"
    :title="t('recognition.title')"
    width="440px"
    height="440px"
    :content-style="{ padding: '0 24px' }"
    @update:open="onOpenUpdate"
  >
    <div class="flex h-full min-h-0 flex-col">
      <div
        v-if="phase === 'idle' || isBusy"
        class="flex min-h-0 flex-1 flex-col text-center"
        aria-live="polite"
      >
        <div class="flex flex-1 flex-col items-center justify-center">
          <div class="relative mb-5 size-22 shrink-0" aria-hidden="true">
            <div
              class="absolute inset-0 flex items-center justify-center rounded-full bg-primary/10 text-primary transition-[opacity,scale,filter] duration-240 ease-[cubic-bezier(0.2,0,0,1)]"
              :class="
                isBusy
                  ? 'pointer-events-none scale-25 opacity-0 blur-1'
                  : 'scale-100 opacity-100 blur-0'
              "
            >
              <IconLucideAudioWaveform class="size-9" />
            </div>
            <div
              class="absolute inset-0 flex items-center justify-center gap-1 transition-[opacity,scale,filter] duration-240 ease-[cubic-bezier(0.2,0,0,1)]"
              :class="
                isBusy
                  ? 'scale-100 opacity-100 blur-0'
                  : 'pointer-events-none scale-25 opacity-0 blur-1'
              "
            >
              <span
                v-for="(height, index) in bars"
                :key="index"
                class="h-10 w-1 origin-center rounded-full bg-primary transition-transform duration-150"
                :style="{ transform: `scaleY(${height})` }"
              />
            </div>
          </div>

          <div class="flex h-14 shrink-0 flex-col items-center">
            <p class="text-base font-semibold text-on-surface">
              {{ isBusy ? t("recognition.listeningTitle") : t("recognition.description") }}
            </p>
            <p class="mt-1 max-w-72 text-xs leading-5 text-on-surface-variant/65 text-pretty">
              {{ isBusy ? t("recognition.listeningDescription") : t("recognition.hint") }}
            </p>
          </div>
        </div>
      </div>

      <div v-else-if="phase === 'done' && candidate" class="flex min-h-0 flex-1 flex-col pt-4">
        <div
          class="relative flex items-center gap-4 overflow-hidden rounded-2xl bg-on-surface/6 p-4"
        >
          <div
            class="pointer-events-none absolute -right-10 -top-10 size-36 rounded-full bg-primary/12 blur-3xl"
            aria-hidden="true"
          />
          <SImg
            :src="candidate.cover"
            :alt="candidate.title"
            class="relative size-24 shrink-0 rounded-xl shadow-lg outline outline-1 outline-black/10 dark:outline-white/10"
            decoding="async"
          />
          <div class="relative min-w-0 flex-1">
            <p class="line-clamp-2 text-lg leading-6 font-bold text-on-surface">
              {{ candidate.title }}
            </p>
            <p
              v-if="candidate.artists.length"
              class="mt-1.5 truncate text-sm font-medium text-on-surface-variant/75"
            >
              {{ candidate.artists.join(" / ") }}
            </p>
            <p
              v-if="candidate.album || candidate.releaseYear"
              class="mt-1 truncate text-xs text-on-surface-variant/55"
            >
              <span v-if="candidate.album">{{ candidate.album }}</span>
              <span v-if="candidate.album && candidate.releaseYear" aria-hidden="true">·</span>
              <span v-if="candidate.releaseYear">{{ candidate.releaseYear }}</span>
            </p>
          </div>
        </div>
        <SButton
          class="mt-5 font-semibold"
          type="primary"
          size="large"
          block
          @click="searchCandidate(candidate)"
        >
          <template #icon><IconLucideSearch /></template>
          {{ t("recognition.searching") }}
        </SButton>
        <div class="mt-5 flex items-center justify-center gap-3">
          <SButton
            variant="tertiary"
            circle
            :size="48"
            :icon-size="21"
            :title="t('recognition.services.appleMusic')"
            :aria-label="t('recognition.services.appleMusic')"
            @click="openInService('appleMusic')"
          >
            <template #icon><IconSpAppleMusic /></template>
          </SButton>
          <SButton
            variant="tertiary"
            circle
            :size="48"
            :icon-size="23"
            :title="t('recognition.services.spotify')"
            :aria-label="t('recognition.services.spotify')"
            @click="openInService('spotify')"
          >
            <template #icon><IconSpSpotify /></template>
          </SButton>
          <SButton
            variant="tertiary"
            circle
            :size="48"
            :icon-size="24"
            :title="t('recognition.services.youtube')"
            :aria-label="t('recognition.services.youtube')"
            @click="openInService('youtube')"
          >
            <template #icon><IconSpYoutube /></template>
          </SButton>
          <SButton
            variant="tertiary"
            circle
            :size="48"
            :icon-size="25"
            :title="t('recognition.services.soundcloud')"
            :aria-label="t('recognition.services.soundcloud')"
            @click="openInService('soundcloud')"
          >
            <template #icon><IconSpSoundcloud /></template>
          </SButton>
        </div>
      </div>
    </div>

    <template #footer>
      <SButton
        v-if="phase === 'idle'"
        type="primary"
        size="large"
        block
        :disabled="supported === null"
        @click="start"
      >
        <template #icon><IconLucideAudioWaveform /></template>
        {{ t("recognition.start") }}
      </SButton>
      <SButton v-else-if="isBusy" variant="secondary" size="large" block @click="session.stop()">
        {{ t("recognition.cancel") }}
      </SButton>
      <SButton
        v-else-if="phase === 'done'"
        variant="secondary"
        size="large"
        block
        @click="session.reset()"
      >
        <template #icon><IconLucideArrowLeft /></template>
        {{ t("common.back") }}
      </SButton>
    </template>
  </SDialog>
</template>
