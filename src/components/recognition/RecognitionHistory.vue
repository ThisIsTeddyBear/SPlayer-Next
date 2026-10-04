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
    <div v-if="loading" class="flex flex-1 items-center justify-center text-on-surface">
      <SLoading />
    </div>
    <div v-else-if="loadFailed" class="flex flex-1 flex-col items-center justify-center gap-3">
      <p class="text-on-surface/70">{{ t("recognition.history.loadFailed") }}</p>
      <SButton variant="secondary" @click="load">{{ t("recognition.retry") }}</SButton>
    </div>
    <template v-else>
      <div v-if="entries.length" class="mb-2 flex shrink-0 items-center justify-between pt-1">
        <span class="text-xs text-on-surface/70">
          {{ t("recognition.history.count", entries.length) }}
        </span>
        <SButton
          variant="text"
          size="small"
          :disabled="deleting !== null || clearing"
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
          <div
            class="flex h-20 items-center gap-1 rounded-xl px-1.5 py-1.5 transition-colors hover:bg-on-surface/5 focus-within:bg-on-surface/5"
          >
            <button
              type="button"
              :title="item.candidate.title"
              class="recognition-history-select flex h-full min-w-0 flex-1 appearance-none items-center gap-3 rounded-lg border-none bg-transparent px-2 text-left text-on-surface cursor-pointer"
              @click="emit('select', item.candidate)"
            >
              <SImg
                :src="item.candidate.cover"
                :alt="item.candidate.title"
                class="size-12 shrink-0 rounded-lg"
              />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-semibold leading-5 text-on-surface">
                  {{ item.candidate.title }}
                </p>
                <p
                  v-if="item.candidate.artists.length"
                  class="truncate text-xs leading-5 text-on-surface/75"
                >
                  {{ item.candidate.artists.join(" / ") }}
                </p>
                <time
                  :datetime="new Date(item.recognizedAt).toISOString()"
                  class="mt-0.5 block text-xs leading-4 text-on-surface/70"
                >
                  {{ dateFormat.format(item.recognizedAt) }}
                </time>
              </div>
            </button>
            <SButton
              class="recognition-history-remove shrink-0"
              variant="ghost"
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
          <div class="text-center text-on-surface/70">
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

<style scoped>
/* 虚拟列表限制绘制范围，焦点描边放在按钮内部以避免被裁切。 */
.recognition-history-select:focus-visible,
.recognition-history-remove:focus-visible {
  outline: 2px solid rgb(var(--s-primary));
  outline-offset: -2px;
}
</style>
