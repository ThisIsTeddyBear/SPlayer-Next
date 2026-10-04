<script setup lang="ts">
import type { RecognitionCandidate, RecognitionHistoryEntry } from "@shared/types/recognition";
import { toast } from "@/composables/useToast";

const emit = defineEmits<{ select: [candidate: RecognitionCandidate] }>();
const { t, locale } = useI18n();
const entries = shallowRef<RecognitionHistoryEntry[]>([]);
const loading = ref(true);
const loadFailed = ref(false);
const deleting = ref<string | null>(null);
const clearing = ref(false);
const clearConfirmOpen = ref(false);
const dateFormat = computed(
  () => new Intl.DateTimeFormat(locale.value, { dateStyle: "short", timeStyle: "short" }),
);

const load = async (): Promise<void> => {
  loading.value = true;
  loadFailed.value = false;
  try {
    entries.value = await window.api.recognition.getHistory();
  } catch {
    loadFailed.value = true;
  } finally {
    loading.value = false;
  }
};

const remove = async (songId: string): Promise<void> => {
  deleting.value = songId;
  try {
    await window.api.recognition.removeHistory(songId);
    entries.value = entries.value.filter((entry) => entry.candidate.songId !== songId);
  } catch {
    toast.error(t("recognition.history.updateFailed"));
  } finally {
    deleting.value = null;
  }
};

const clear = async (): Promise<void> => {
  clearing.value = true;
  try {
    await window.api.recognition.clearHistory();
    entries.value = [];
    clearConfirmOpen.value = false;
  } catch {
    toast.error(t("recognition.history.updateFailed"));
  } finally {
    clearing.value = false;
  }
};

onMounted(() => void load());
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div v-if="loading" class="flex flex-1 items-center justify-center">
      <SLoading />
    </div>
    <div v-else-if="loadFailed" class="flex flex-1 flex-col items-center justify-center gap-3">
      <p class="text-on-surface-variant/65">{{ t("recognition.history.loadFailed") }}</p>
      <SButton variant="secondary" @click="load">{{ t("recognition.retry") }}</SButton>
    </div>
    <template v-else>
      <div v-if="entries.length" class="mb-2 flex shrink-0 items-center justify-between">
        <span class="text-xs text-on-surface-variant/65">
          {{ t("common.totalSongs", { count: entries.length }) }}
        </span>
        <SButton
          type="error"
          variant="text"
          size="small"
          :disabled="deleting !== null"
          @click="clearConfirmOpen = true"
        >
          {{ t("recognition.history.clear") }}
        </SButton>
      </div>
      <SVirtualList
        :items="entries"
        :item-height="80"
        item-fixed
        :get-item-key="(entry) => entry.candidate.songId"
        class="min-h-0 flex-1"
      >
        <template #default="{ item }">
          <div class="flex h-20 items-center gap-2">
            <button
              type="button"
              class="flex h-full min-w-0 flex-1 items-center gap-3 rounded-lg px-2 text-left hover:bg-on-surface/6 focus-visible:outline-primary"
              @click="emit('select', item.candidate)"
            >
              <SImg
                :src="item.candidate.cover"
                :alt="item.candidate.title"
                class="size-12 shrink-0 rounded-lg"
              />
              <div class="min-w-0 flex-1">
                <p class="truncate font-semibold text-on-surface">
                  {{ item.candidate.title }}
                </p>
                <p class="truncate text-xs text-on-surface-variant/75">
                  {{ item.candidate.artists.join(" / ") }}
                </p>
                <time
                  :datetime="new Date(item.recognizedAt).toISOString()"
                  class="text-xs text-on-surface-variant/50"
                >
                  {{ dateFormat.format(item.recognizedAt) }}
                </time>
              </div>
            </button>
            <SButton
              variant="text"
              size="small"
              circle
              :title="t('recognition.history.remove')"
              :aria-label="t('recognition.history.remove')"
              :disabled="deleting !== null || clearing"
              :loading="deleting === item.candidate.songId"
              @click="remove(item.candidate.songId)"
            >
              <template #icon><IconLucideTrash2 /></template>
            </SButton>
          </div>
        </template>
        <template #empty>
          <div class="text-center text-on-surface-variant/50">
            <IconLucideHistory class="mx-auto mb-3 size-10 opacity-30" />
            <p>{{ t("recognition.history.empty") }}</p>
          </div>
        </template>
      </SVirtualList>
    </template>
    <SDialog v-model:open="clearConfirmOpen" :title="t('recognition.history.clearConfirmTitle')">
      {{ t("recognition.history.clearConfirmContent") }}
      <template #footer="{ close }">
        <SButton variant="secondary" :disabled="clearing" @click="close">
          {{ t("common.cancel") }}
        </SButton>
        <SButton type="error" variant="secondary" :loading="clearing" @click="clear">
          {{ t("common.confirm") }}
        </SButton>
      </template>
    </SDialog>
  </div>
</template>
