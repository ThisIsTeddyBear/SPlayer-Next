<script setup lang="ts">
import type { FetchedLyricCandidate } from "@shared/types/lyrics";
import { toast } from "@/composables/useToast";
import { formatTime } from "@/utils/time";
import { useMediaStore } from "@/stores/media";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();

const { t } = useI18n();
const media = useMediaStore();
const loading = ref(false);
const saving = ref(false);
const candidates = shallowRef<FetchedLyricCandidate[]>([]);
const selected = ref<FetchedLyricCandidate | null>(null);

const isLocalTrack = computed(() => media.track?.source === "local" && !!media.track.path);

const search = async (): Promise<void> => {
  const track = media.track;
  if (!track || !isLocalTrack.value || loading.value) return;
  loading.value = true;
  selected.value = null;
  try {
    const result = await window.api.lyrics.searchLocalCandidates(track);
    if (!result.success || !result.data) {
      toast.error(t("player.fetchLyrics.searchFailed"));
      return;
    }
    candidates.value = result.data ?? [];
    if (candidates.value.length === 0) toast.info(t("player.fetchLyrics.noMatches"));
  } finally {
    loading.value = false;
  }
};

const save = async (): Promise<void> => {
  const track = media.track;
  const candidate = selected.value;
  if (!track || !candidate || saving.value) return;
  saving.value = true;
  try {
    const result = await window.api.lyrics.saveLocalCandidate(
      track,
      candidate.content,
      candidate.format,
    );
    if (!result.success || !result.data) {
      toast.error(t("player.fetchLyrics.saveFailed"));
      return;
    }
    if (media.detail) {
      media.detail = {
        ...media.detail,
        externalLyrics: [{ format: candidate.format, path: result.data.path }],
      };
    }
    media.setLyric(
      { source: "external", format: candidate.format },
      { content: candidate.content },
    );
    toast.success(t("player.fetchLyrics.saved"));
    emit("update:open", false);
  } finally {
    saving.value = false;
  }
};

watch(
  () => props.open,
  (open) => {
    candidates.value = [];
    selected.value = null;
    if (open) void search();
  },
);
</script>

<template>
  <SDialog
    :open="open"
    :title="t('player.fetchLyrics.title')"
    width="620px"
    @update:open="emit('update:open', $event)"
  >
    <div class="flex flex-col gap-3">
      <p class="m-0 text-sm text-on-surface-variant">
        {{ t('player.fetchLyrics.description') }}
      </p>
      <div v-if="!isLocalTrack" class="text-sm text-error">
        {{ t('player.fetchLyrics.localOnly') }}
      </div>
      <div v-else-if="loading" class="py-12 flex justify-center"><SLoading /></div>
      <div
        v-else-if="candidates.length === 0"
        class="py-8 text-center text-sm text-on-surface-variant"
      >
        {{ t('player.fetchLyrics.noMatches') }}
      </div>
      <div v-else class="flex flex-col gap-1 max-h-88 overflow-y-auto">
        <button
          v-for="candidate in candidates"
          :key="candidate.id"
          type="button"
          class="text-left p-3 rounded-lg border border-solid transition-colors"
          :class="
            selected?.id === candidate.id
              ? 'border-primary bg-primary/10'
              : 'border-outline/30 hover:bg-on-surface/6'
          "
          @click="selected = candidate"
        >
          <div class="flex items-center gap-3">
            <span class="flex-1 min-w-0 text-sm font-medium truncate">
              {{ candidate.title }}
            </span>
            <span v-if="candidate.duration" class="text-xs text-on-surface-variant tabular-nums">
              {{ formatTime(candidate.duration * 1000) }}
            </span>
          </div>
          <div class="mt-0.5 text-xs text-on-surface-variant truncate">
            {{ candidate.artist }}<template v-if="candidate.album"> · {{ candidate.album }}</template>
          </div>
        </button>
      </div>
      <p
        v-if="selected"
        class="m-0 text-xs text-on-surface-variant line-clamp-2 whitespace-pre-line"
      >
        {{ selected.content }}
      </p>
    </div>
    <template #footer>
      <SButton variant="secondary" :disabled="saving" @click="emit('update:open', false)">
        {{ t('common.cancel') }}
      </SButton>
      <SButton
        variant="secondary"
        :loading="loading"
        :disabled="!isLocalTrack || saving"
        @click="search"
      >
        {{ t('common.retry') }}
      </SButton>
      <SButton :loading="saving" :disabled="!selected" @click="save">
        {{ t('player.fetchLyrics.replace') }}
      </SButton>
    </template>
  </SDialog>
</template>
