<script setup lang="ts">
import type { PluginInfo } from "@shared/types/plugin";
import { usePluginsStore } from "@/stores/plugins";
import { toast } from "@/composables/useToast";
import { isExternalUrl, openExternal } from "@/utils/url";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();
const pluginsStore = usePluginsStore();
const { sourcePlugins, controlPlugins, loaded } = storeToRefs(pluginsStore);

const confirmOpen = ref(false);
const pendingUninstallId = ref<string | null>(null);
const settingsDialogOpen = ref(false);
const settingsDialogId = ref<string | null>(null);
const updatingId = ref<string | null>(null);
const checkingId = ref<string | null>(null);
const updateDialogOpen = ref(false);
const updateDialogId = ref<string | null>(null);
const detailDialogOpen = ref(false);
const detailDialogId = ref<string | null>(null);

onMounted(() => {
  if (!loaded.value) void pluginsStore.load();
});

const pluginSettings = (info: PluginInfo) => {
  if (info.status.state !== "ready") return [];
  return info.status.settings ?? [];
};

/**
 */
const handleToggleEnabled = async (id: string, currentlyEnabled: boolean): Promise<void> => {
  await pluginsStore.setEnabled(id, !currentlyEnabled);
};

/**
 */
const handleCheckUpdate = async (id: string): Promise<void> => {
  checkingId.value = id;
  try {
    const res = await pluginsStore.checkUpdate(id);
    if (!res.ok) toast.error(t("settings.plugins.checkUpdateFailed"));
    else if (res.hasUpdate) toast.success(t("settings.plugins.updateFound"));
    else toast.info(t("settings.plugins.updateLatest"));
  } finally {
    checkingId.value = null;
  }
};

/**
 */
const handleUpdate = async (id: string): Promise<void> => {
  updatingId.value = id;
  try {
    const res = await pluginsStore.applyUpdate(id);
    if (res.ok) {
      toast.success(t("settings.plugins.updateSuccess"));
      updateDialogOpen.value = false;
    } else {
      toast.error(t("settings.plugins.updateFailed"));
    }
  } finally {
    updatingId.value = null;
  }
};

const openUpdateDialog = (id: string): void => {
  updateDialogId.value = id;
  updateDialogOpen.value = true;
};

const confirmUpdate = (): void => {
  if (updateDialogId.value) void handleUpdate(updateDialogId.value);
};

const updateDialogInfo = computed(() => {
  if (!updateDialogId.value) return null;
  const allPlugins = [...sourcePlugins.value, ...controlPlugins.value];
  return allPlugins.find((info) => info.manifest.id === updateDialogId.value) ?? null;
});

const updateDialogUrl = computed(() => updateDialogInfo.value?.updateInfo?.updateUrl ?? "");

const openDetailDialog = (id: string): void => {
  detailDialogId.value = id;
  detailDialogOpen.value = true;
};

const detailDialogInfo = computed(() => {
  if (!detailDialogId.value) return null;
  const all = [...sourcePlugins.value, ...controlPlugins.value];
  return all.find((info) => info.manifest.id === detailDialogId.value) ?? null;
});

const openUninstallConfirm = (id: string): void => {
  pendingUninstallId.value = id;
  confirmOpen.value = true;
};

const handleConfirmUninstall = async (): Promise<void> => {
  const id = pendingUninstallId.value;
  confirmOpen.value = false;
  pendingUninstallId.value = null;
  if (!id) return;
  const res = await pluginsStore.uninstall(id);
  if (res.ok) toast.success(t("settings.plugins.uninstallSuccess"));
  else toast.error(res.error ?? t("settings.plugins.uninstallFailed"));
};

const onSettingChange = async (pluginId: string, key: string, value: unknown): Promise<void> => {
  await pluginsStore.setSetting(pluginId, key, value);
};

const settingsDialogInfo = computed(() => {
  if (!settingsDialogId.value) return null;
  const allPlugins = [...sourcePlugins.value, ...controlPlugins.value];
  return allPlugins.find((info) => info.manifest.id === settingsDialogId.value) ?? null;
});
const settingsDialogSchema = computed(() =>
  settingsDialogInfo.value ? pluginSettings(settingsDialogInfo.value) : [],
);
const settingsDialogValues = computed(() => settingsDialogInfo.value?.settingsValues ?? {});

const openSettingsDialog = (id: string): void => {
  settingsDialogId.value = id;
  settingsDialogOpen.value = true;
};

const onDialogSettingChange = (key: string, value: unknown): void => {
  if (settingsDialogId.value) void onSettingChange(settingsDialogId.value, key, value);
};

const pendingName = computed(() => {
  if (!pendingUninstallId.value) return "";
  const allPlugins = [...sourcePlugins.value, ...controlPlugins.value];
  return (
    allPlugins.find((info) => info.manifest.id === pendingUninstallId.value)?.manifest.name ?? ""
  );
});

const isEmpty = computed(
  () => sourcePlugins.value.length === 0 && controlPlugins.value.length === 0,
);

const DOCS_URL = "https://splayer-next.imsyy.top/plugins/";
const SUBMIT_URL = "https://github.com/SPlayer-Dev/plugins/issues/new/choose";

</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-col gap-4">
      <div
        v-if="isEmpty"
        class="flex flex-col items-center gap-3 rounded-xl bg-surface-panel border border-solid border-outline-variant/15 py-10"
      >
        <div
          class="size-12 rounded-xl bg-on-surface/6 flex items-center justify-center text-on-surface-variant"
        >
          <IconLucidePuzzle class="size-6" />
        </div>
        <div class="text-sm text-on-surface-variant">{{ t("settings.plugins.empty") }}</div>
        <div class="text-xs text-on-surface-variant/60">{{ t("settings.plugins.emptyHint") }}</div>
      </div>

      <div v-if="sourcePlugins.length > 0" class="flex flex-col gap-2">
        <div class="text-sm font-medium text-on-surface-variant/70 px-1">
          {{ t("settings.plugins.sectionSource") }}
        </div>
        <div class="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
          <PluginCard
            v-for="info in sourcePlugins"
            :key="info.manifest.id"
            :info="info"
            :checking="checkingId === info.manifest.id"
            @toggle="handleToggleEnabled"
            @uninstall="openUninstallConfirm"
            @configure="openSettingsDialog"
            @check="handleCheckUpdate"
            @view-update="openUpdateDialog"
            @detail="openDetailDialog"
          />
        </div>
      </div>

      <div v-if="controlPlugins.length > 0" class="flex flex-col gap-2">
        <div class="text-sm font-medium text-on-surface-variant/70 px-1">
          {{ t("settings.plugins.sectionControl") }}
        </div>
        <div class="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
          <PluginCard
            v-for="info in controlPlugins"
            :key="info.manifest.id"
            :info="info"
            :checking="checkingId === info.manifest.id"
            @toggle="handleToggleEnabled"
            @uninstall="openUninstallConfirm"
            @configure="openSettingsDialog"
            @check="handleCheckUpdate"
            @view-update="openUpdateDialog"
            @detail="openDetailDialog"
          />
        </div>
      </div>
    </div>


    <div
      class="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 pt-4 text-xs text-on-surface-variant/60"
    >
      <span>{{ t("settings.plugins.publishHint") }}</span>
      <SButton variant="text" type="primary" size="tiny" @click="openExternal(SUBMIT_URL)">
        <template #icon><IconLucideUpload /></template>
        {{ t("settings.plugins.publishAction") }}
      </SButton>
      <span class="opacity-40">·</span>
      <SButton variant="text" type="primary" size="tiny" @click="openExternal(DOCS_URL)">
        <template #icon><IconLucideBookOpen /></template>
        {{ t("settings.plugins.docs") }}
      </SButton>
    </div>

    <SDialog
      v-model:open="confirmOpen"
      :title="t('settings.plugins.uninstallConfirmTitle')"
      width="400px"
    >
      <p class="text-sm text-on-surface-variant">
        {{ t("settings.plugins.uninstallConfirm", { name: pendingName }) }}
      </p>
      <template #footer="{ close }">
        <SButton variant="secondary" @click="close">{{ t("common.cancel") }}</SButton>
        <SButton variant="secondary" type="error" @click="handleConfirmUninstall">
          {{ t("common.confirm") }}
        </SButton>
      </template>
    </SDialog>

    <SDialog
      v-model:open="settingsDialogOpen"
      :title="settingsDialogInfo?.manifest.name ?? ''"
      :description="t('settings.plugins.configSubtitle')"
      width="520px"
    >
      <PluginSettingsForm
        :schema="settingsDialogSchema"
        :values="settingsDialogValues"
        @change="onDialogSettingChange"
      />
      <template #footer="{ close }">
        <SButton variant="secondary" @click="close">{{ t("common.close") }}</SButton>
      </template>
    </SDialog>

    <SDialog
      v-model:open="updateDialogOpen"
      :title="updateDialogInfo?.manifest.name ?? ''"
      width="460px"
    >
      <div v-if="updateDialogInfo?.updateInfo" class="flex flex-col gap-4">
        <div class="flex items-center gap-2 text-sm">
          <STag type="default" size="small">v{{ updateDialogInfo.manifest.version }}</STag>
          <template v-if="updateDialogInfo.updateInfo.version">
            <IconLucideArrowRight class="size-4 text-on-surface-variant/50" />
            <STag type="primary" size="small">v{{ updateDialogInfo.updateInfo.version }}</STag>
          </template>
        </div>
        <div
          class="max-h-80 overflow-y-auto whitespace-pre-wrap break-words text-sm"
          :class="
            updateDialogInfo.updateInfo.log
              ? 'text-on-surface-variant'
              : 'text-on-surface-variant/50'
          "
        >
          {{ updateDialogInfo.updateInfo.log || t("settings.plugins.noChangelog") }}
        </div>
      </div>
      <template #footer="{ close }">
        <SButton variant="secondary" @click="close">{{ t("common.cancel") }}</SButton>
        <SButton
          v-if="isExternalUrl(updateDialogUrl)"
          variant="secondary"
          @click="openExternal(updateDialogUrl)"
        >
          {{ t("settings.plugins.openUpdateUrl") }}
        </SButton>
        <SButton
          variant="secondary"
          type="primary"
          :loading="updatingId === updateDialogId"
          @click="confirmUpdate"
        >
          {{ t("settings.plugins.update") }}
        </SButton>
      </template>
    </SDialog>

    <PluginDetailDialog v-model:open="detailDialogOpen" :info="detailDialogInfo" />
  </div>
</template>
