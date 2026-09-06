<script setup lang="ts">
import { toast } from "@/composables/useToast";
import { useLibraryStore } from "@/stores/library";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();
const apiKey = ref("");
const hasKey = ref(false);
const saving = ref(false);

const load = async (): Promise<void> => {
  hasKey.value = (await window.api.artistImages.getStatus()).hasPersonalApiKey;
};

const save = async (): Promise<void> => {
  if (!apiKey.value.trim() || saving.value) return;
  saving.value = true;
  try {
    const status = await window.api.artistImages.savePersonalApiKey(apiKey.value);
    hasKey.value = status.hasPersonalApiKey;
    apiKey.value = "";
    void useLibraryStore().loadArtistAvatars();
    toast.success(t("settings.artistImages.saved"));
  } catch {
    toast.error(t("settings.artistImages.saveFailed"));
  } finally {
    saving.value = false;
  }
};

const clear = async (): Promise<void> => {
  if (saving.value) return;
  saving.value = true;
  try {
    const status = await window.api.artistImages.clearPersonalApiKey();
    hasKey.value = status.hasPersonalApiKey;
    toast.success(t("settings.artistImages.cleared"));
  } finally {
    saving.value = false;
  }
};

onMounted(load);
</script>

<template>
  <div class="rounded-xl bg-surface-panel border border-solid border-outline-variant/15 p-4">
    <div class="flex items-start gap-3">
      <IconLucideImage class="size-5 shrink-0 text-primary mt-0.5" />
      <div class="min-w-0 flex-1">
        <div class="text-base text-on-surface">{{ t("settings.artistImages.label") }}</div>
        <p class="text-sm text-on-surface-variant/70 mt-0.5">
          {{ t("settings.artistImages.description") }}
        </p>
      </div>
      <STag :type="hasKey ? 'success' : 'default'">
        {{ t(hasKey ? "settings.artistImages.connected" : "settings.artistImages.notConfigured") }}
      </STag>
    </div>
    <div class="flex gap-2 mt-4">
      <SInput
        v-model="apiKey"
        class="flex-1"
        type="password"
        autocomplete="new-password"
        :placeholder="t('settings.artistImages.placeholder')"
        @keyup.enter="save"
      />
      <SButton type="primary" :loading="saving" :disabled="!apiKey.trim()" @click="save">
        {{ t("common.save") }}
      </SButton>
      <SButton v-if="hasKey" variant="secondary" :loading="saving" @click="clear">
        {{ t("common.delete") }}
      </SButton>
    </div>
    <a
      class="inline-flex items-center gap-1 text-sm text-primary mt-3 hover:underline"
      href="https://fanart.tv/get-an-api-key/"
      target="_blank"
      rel="noreferrer"
    >
      {{ t("settings.artistImages.getKey") }}
      <IconLucideExternalLink class="size-3.5" />
    </a>
  </div>
</template>
