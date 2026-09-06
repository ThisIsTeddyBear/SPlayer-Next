import { toast } from "@/composables/useToast";
import * as player from "@/core/player";
import IconDices from "~icons/lucide/dices";

export const useQuickActions = () => {
  const { t } = useI18n();

  const playLucky = useThrottleFn(async (): Promise<void> => {
    const count = await window.api.library.getTrackCount();
    if (!(count.success ? (count.data ?? 0) > 0 : false)) {
      toast.warning(t("home.quickActions.luck.empty"));
      return;
    }
    const result = await window.api.library.getRandomTrack();
    if (result.success && result.data) await player.playNow(result.data);
  }, 800);

  const quickActions = computed(() => [
    {
      icon: IconDices,
      title: t("home.quickActions.luck.title"),
      desc: t("home.quickActions.luck.desc"),
      run: playLucky,
    },
  ]);

  return { quickActions };
};
