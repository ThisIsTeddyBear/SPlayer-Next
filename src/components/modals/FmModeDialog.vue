<script setup lang="ts">
/**
 * 私人 FM 模式与场景选择对话框
 */

import type { PersonalFmMode, PersonalFmSubMode } from "@/types/netease";
import * as player from "@/core/player";
import { useStatusStore } from "@/stores/status";
import { toast } from "@/composables/useToast";

const props = defineProps<{
  /** 是否打开对话框 */
  open: boolean;
}>();

const emit = defineEmits<{
  /** 更新打开状态 */
  "update:open": [value: boolean];
}>();

const { t } = useI18n();
const status = useStatusStore();

/** 主模式定义 */
interface ModeItem {
  key: PersonalFmMode;
  title: string;
  desc: string;
}

const MODES: ModeItem[] = [
  {
    key: "DEFAULT",
    title: "Default",
    desc: "Continue based on your current preferences",
  },
  {
    key: "FAMILIAR",
    title: "Familiar",
    desc: "Songs you liked and similar recommendations",
  },
  {
    key: "EXPLORE",
    title: "Explore",
    desc: "Preferred styles and promising new songs",
  },
  {
    key: "SCENE_RCMD",
    title: "Scene",
    desc: "Recommendations for a specific setting and mood",
  },
];

/** Scene submode categories and labels. */
interface SubModeCategory {
  category: string;
  items: Array<{ key: PersonalFmSubMode; label: string }>;
}

const SUBMODE_CATEGORIES: SubModeCategory[] = [
  {
    category: "Everyday activities",
    items: [
      { key: "EXERCISE", label: "Exercise" },
      { key: "FOCUS", label: "Focus" },
      { key: "SLEEP_HELP", label: "Sleep" },
      { key: "COMMUTE", label: "Commute" },
      { key: "COFFEE_SHOP", label: "Coffee shop" },
      { key: "TAKE_SHOWER", label: "Shower" },
      { key: "GAMES", label: "Gaming" },
    ],
  },
  {
    category: "Mood",
    items: [
      { key: "RELAX", label: "Relax" },
      { key: "CHEERFUL", label: "Cheerful" },
      { key: "NIGHT_EMO", label: "Melancholy" },
      { key: "CURE", label: "Comforting" },
      { key: "LYRICAL", label: "Lyrical" },
      { key: "SWEET", label: "Love songs" },
      { key: "INSPIRATIONAL", label: "Inspirational" },
      { key: "RAINY", label: "Rainy day" },
    ],
  },
  {
    category: "Genres and languages",
    items: [
      { key: "GUOFENG", label: "Chinese traditional" },
      { key: "CHINESE", label: "Chinese" },
      { key: "ENGLISH", label: "Western" },
      { key: "YUEYU", label: "Cantonese" },
      { key: "JAPANESE", label: "Japanese" },
      { key: "K_POP", label: "K-Pop" },
      { key: "FRANCH", label: "French" },
      { key: "GLOBAL", label: "Global" },
      { key: "ELECTRONIC", label: "Electronic" },
      { key: "RAP", label: "Rap" },
      { key: "ROCK", label: "Rock" },
      { key: "FOLK", label: "Folk" },
      { key: "ACG", label: "Anime and games" },
      { key: "LIGHT", label: "Easy listening" },
      { key: "JAZZ", label: "Jazz" },
      { key: "GUDIAN", label: "Classical" },
      { key: "RHYTHM_BLUES", label: "R&B" },
      { key: "BLUE", label: "Blues" },
      { key: "PUNK", label: "Funk" },
      { key: "DANCE", label: "Dance" },
      { key: "LATIN", label: "Latin" },
      { key: "COUNTRY", label: "Country" },
      { key: "MANYAO", label: "Slow dance DJ" },
      { key: "JINGDIAN", label: "Classics" },
      { key: "ORIGINAL_MUSICIAL", label: "Original gems" },
      { key: "MUSICAL", label: "Musical theatre" },
      { key: "YINGSHI", label: "Film and TV" },
    ],
  },
];

/** Selected mode. */
const activeMode = ref<PersonalFmMode>("DEFAULT");
/** Selected scene submode. */
const activeSubMode = ref<PersonalFmSubMode>("EXERCISE");
/** Whether a mode switch is in progress. */
const switching = ref(false);

/** 打开对话框时同步当前正在生效的配置 */
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    const currentOpt = status.fmOptions;
    activeMode.value = currentOpt?.mode ?? "DEFAULT";
    if (currentOpt?.submode) {
      activeSubMode.value = currentOpt.submode;
    }
  },
  { immediate: true },
);

/**
 * 切换模式
 * @param mode - 目标模式
 */
const selectMode = async (mode: PersonalFmMode): Promise<void> => {
  if (switching.value) return;
  activeMode.value = mode;

  if (mode !== "SCENE_RCMD") {
    switching.value = true;
    try {
      const modeLabel = MODES.find((m) => m.key === mode)?.title ?? "私人 FM";
      const ok = await player.playPersonalFm({ mode });
      if (ok) {
        toast.success(`已切换至 「${modeLabel}」`);
        emit("update:open", false);
      } else {
        toast.warning("模式切换失败，请稍后重试");
      }
    } catch {
      toast.warning("模式切换失败，请稍后重试");
    } finally {
      switching.value = false;
    }
  }
};

/**
 * 选中并切换场景
 * @param submode - 目标场景
 * @param label - 场景中文名
 */
const selectSubMode = async (submode: PersonalFmSubMode, label: string): Promise<void> => {
  if (switching.value) return;
  activeMode.value = "SCENE_RCMD";
  activeSubMode.value = submode;

  switching.value = true;
  try {
    const ok = await player.playPersonalFm({
      mode: "SCENE_RCMD",
      submode,
    });
    if (ok) {
      toast.success(`已切换至 「${label}」场景`);
      emit("update:open", false);
    } else {
      toast.warning("场景切换失败，请稍后重试");
    }
  } catch {
    toast.warning("场景切换失败，请稍后重试");
  } finally {
    switching.value = false;
  }
};
</script>

<template>
  <SDialog
    :open="open"
    :title="t('player.fm.modeSettings')"
    width="540px"
    @update:open="emit('update:open', $event)"
  >
    <div class="flex flex-col gap-5 py-1">
      <div class="flex flex-col gap-2">
        <span class="text-xs font-medium text-on-surface-variant">推荐模式</span>
        <div class="grid grid-cols-2 gap-2.5">
          <SCard
            v-for="item in MODES"
            :key="item.key"
            size="small"
            variant="settings"
            hoverable
            :selected="activeMode === item.key"
            class="flex flex-col gap-0.5"
            @click="selectMode(item.key)"
          >
            <div
              class="text-sm font-medium"
              :class="activeMode === item.key ? 'text-primary' : 'text-on-surface'"
            >
              {{ item.title }}
            </div>
            <div class="text-xs text-on-surface-variant">
              {{ item.desc }}
            </div>
          </SCard>
        </div>
      </div>

      <!-- 场景分类与标签 -->
      <div class="flex flex-col gap-3">
        <span class="text-xs font-medium text-on-surface-variant">场景与风格</span>

        <div class="flex flex-col gap-4 max-h-[300px] overflow-y-auto pr-1">
          <div v-for="cat in SUBMODE_CATEGORIES" :key="cat.category" class="flex flex-col gap-2">
            <span class="text-xs text-on-surface-variant/60 font-medium px-0.5">
              {{ cat.category }}
            </span>
            <div class="flex flex-wrap gap-2">
              <STag
                v-for="sub in cat.items"
                :key="sub.key"
                round
                size="medium"
                :type="
                  activeMode === 'SCENE_RCMD' && activeSubMode === sub.key ? 'primary' : 'default'
                "
                :variant="
                  activeMode === 'SCENE_RCMD' && activeSubMode === sub.key ? 'filled' : 'soft'
                "
                class="cursor-pointer"
                :class="switching ? 'opacity-70 pointer-events-none' : ''"
                @click="selectSubMode(sub.key, sub.label)"
              >
                {{ sub.label }}
              </STag>
            </div>
          </div>
        </div>
      </div>
    </div>
  </SDialog>
</template>
