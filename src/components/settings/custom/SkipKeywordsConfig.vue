<script setup lang="ts">
import { useSettingsStore } from "@/stores/settings";
import { toast } from "@/composables/useToast";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();
const settings = useSettingsStore();
const open = ref(false);
const enabled = ref(false);
const keywords = ref<string[]>([]);
const newKeyword = ref("");

watch(open, (value) => {
  if (!value) return;
  enabled.value = settings.preset.skipKeywordsSongs;
  keywords.value = [...settings.preset.skipTrackKeywords];
  newKeyword.value = "";
});

const addKeyword = (): void => {
  const value = newKeyword.value.trim();
  if (!value) return;
  if (keywords.value.some((keyword) => keyword.toLocaleLowerCase() === value.toLocaleLowerCase())) {
    toast.warning(t("settings.skipKeywordsRules.duplicate"));
    return;
  }
  keywords.value.push(value);
  newKeyword.value = "";
};

const removeKeyword = (index: number): void => {
  keywords.value.splice(index, 1);
};

const clearAll = (): void => {
  keywords.value = [];
};

const save = (): void => {
  settings.preset.skipKeywordsSongs = enabled.value;
  settings.preset.skipTrackKeywords = [...keywords.value];
  open.value = false;
};
</script>

<template>
  <SButton type="primary" variant="secondary" size="small" @click="open = true">
    {{ t("settings.skipKeywordsSongs.button") }}
  </SButton>
  <SDialog
    v-model:open="open"
    :title="t('settings.skipKeywordsSongs.label')"
    :description="t('settings.skipKeywordsRules.hint')"
    width="540px"
  >
    <div class="flex flex-col gap-4 pt-1">
      <SCard variant="settings" class="flex items-center justify-between gap-4">
        <div class="min-w-0 flex-1">
          <div class="text-base font-medium">{{ t("settings.skipKeywordsSongs.enable") }}</div>
          <div class="text-sm text-on-surface-variant/70 mt-0.5">
            {{ t("settings.skipKeywordsSongs.enableDesc") }}
          </div>
        </div>
        <SSwitch v-model="enabled" />
      </SCard>
      <div class="flex flex-col gap-3">
        <div class="flex gap-2">
          <SInput
            v-model="newKeyword"
            :placeholder="t('settings.skipKeywordsRules.placeholder')"
            class="flex-1"
            @keydown.enter="addKeyword"
          />
          <SButton type="primary" variant="secondary" :size="34" @click="addKeyword">
            <template #icon><IconLucidePlus /></template>
            {{ t("settings.skipKeywordsRules.add") }}
          </SButton>
        </div>
        <div class="flex flex-wrap gap-1.5 max-h-[35vh] pb-4 overflow-y-auto">
          <p v-if="keywords.length === 0" class="text-sm text-on-surface-variant/60">
            {{ t("settings.skipKeywordsRules.empty") }}
          </p>
          <STag
            v-for="(keyword, index) in keywords"
            :key="`${index}-${keyword}`"
            size="medium"
            closable
            @close="removeKeyword(index)"
          >
            {{ keyword }}
          </STag>
        </div>
      </div>
    </div>
    <template #footer="{ close }">
      <SButton variant="secondary" @click="clearAll">
        <template #icon><IconLucideTrash2 /></template>
        {{ t("settings.skipKeywordsRules.clear") }}
      </SButton>
      <div class="flex-1" />
      <SButton variant="secondary" @click="close">{{ t("common.cancel") }}</SButton>
      <SButton type="primary" @click="save">{{ t("common.save") }}</SButton>
    </template>
  </SDialog>
</template>
