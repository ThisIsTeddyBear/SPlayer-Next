<script setup lang="ts">
import type { AudioStreamInfo } from "@shared/types/player";
import { useStatusStore } from "@/stores/status";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();

const { t } = useI18n();
const status = useStatusStore();
const info = shallowRef<AudioStreamInfo | null>(null);
const loading = ref(false);
const error = ref("");
let requestId = 0;

const formatRate = (rate: number): string => `${(rate / 1000).toFixed(1)} kHz`;
const formatChannels = (channels: number): string => {
  const label = channels === 1 ? "mono" : channels === 2 ? "stereo" : "multiChannel";
  return `${t(`quality.${label}`)} · ${channels}`;
};
const stateLabel = (active: boolean): string =>
  t(active ? "quality.active" : "quality.inactive");

const refresh = async (): Promise<void> => {
  const currentRequest = ++requestId;
  loading.value = true;
  error.value = "";
  try {
    const result = await window.api.player.getStreamInfo();
    if (currentRequest !== requestId) return;
    if (!result.success) throw new Error(result.error);
    info.value = result.data ?? null;
  } catch {
    if (currentRequest !== requestId) return;
    info.value = null;
    error.value = t("quality.loadFailed");
  } finally {
    if (currentRequest === requestId) loading.value = false;
  }
};

watch(
  () => [props.open, status.state, status.currentSource, status.bitPerfectActive],
  ([open]) => {
    if (open) void refresh();
    else requestId++;
  },
  { immediate: true },
);

const sourceRows = computed(() =>
  info.value
    ? [
        { label: t("quality.sampleRate"), value: formatRate(info.value.sourceSampleRate) },
        {
          label: t("quality.bitDepth"),
          value: info.value.sourceBits > 0 ? `${info.value.sourceBits} bit` : "—",
        },
        { label: t("quality.channels"), value: formatChannels(info.value.sourceChannels) },
      ]
    : [],
);
const outputRows = computed(() =>
  info.value
    ? [
        { label: t("quality.device"), value: info.value.deviceName },
        {
          label: t("quality.mode"),
          value: t(info.value.isExclusive ? "quality.exclusive" : "quality.shared"),
        },
        { label: t("quality.sampleRate"), value: formatRate(info.value.outputSampleRate) },
        { label: t("quality.bitDepth"), value: `${info.value.outputBits} bit` },
        { label: t("quality.channels"), value: formatChannels(info.value.outputChannels) },
        { label: t("quality.format"), value: info.value.outputFormat },
        { label: t("quality.resampling"), value: stateLabel(info.value.isResampling) },
        { label: t("quality.bitPerfect"), value: stateLabel(info.value.bitPerfectActive) },
      ]
    : [],
);
const processingRows = computed(() =>
  info.value
    ? [
        { label: t("quality.equalizer"), value: stateLabel(info.value.isEqualizerActive) },
        {
          label: t("quality.tempo"),
          value: info.value.isTempoActive
            ? `${stateLabel(true)} · ${info.value.speed.toFixed(2)}x`
            : stateLabel(false),
        },
        { label: t("quality.normalization"), value: stateLabel(info.value.isNormalizationActive) },
        { label: t("quality.limiter"), value: stateLabel(info.value.isLimiterActive) },
      ]
    : [],
);
</script>

<template>
  <SDialog
    :open="open"
    :title="t('quality.outputInfo')"
    width="480px"
    @update:open="emit('update:open', $event)"
  >
    <div class="flex justify-end mb-3">
      <SButton size="small" variant="ghost" :disabled="loading" @click="refresh">
        {{ t("quality.refresh") }}
      </SButton>
    </div>
    <p v-if="loading" class="text-sm text-on-surface-variant">{{ t("common.loading") }}</p>
    <p v-else-if="error" class="text-sm text-on-surface-variant">{{ error }}</p>
    <p v-else-if="!info" class="text-sm text-on-surface-variant">
      {{ t("quality.noOutput") }}
    </p>
    <div v-else class="flex flex-col gap-5 text-sm">
      <section
        v-for="section in [
          { title: t('quality.source'), rows: sourceRows },
          { title: t('quality.output'), rows: outputRows },
          { title: t('quality.processing'), rows: processingRows },
        ]"
        :key="section.title"
      >
        <h3 class="font-medium text-on-surface mb-2">{{ section.title }}</h3>
        <dl class="flex flex-col gap-2">
          <div v-for="row in section.rows" :key="row.label" class="flex justify-between gap-4">
            <dt class="text-on-surface-variant shrink-0">{{ row.label }}</dt>
            <dd class="text-on-surface text-right break-all">{{ row.value }}</dd>
          </div>
        </dl>
      </section>
    </div>
  </SDialog>
</template>
