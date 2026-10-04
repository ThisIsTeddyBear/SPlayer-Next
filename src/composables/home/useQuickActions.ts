import { toast } from "@/composables/useToast";
import * as player from "@/core/player";

export const useQuickActions = () => {
  const { t } = useI18n();

  const playLucky = useThrottleFn(async (): Promise<void> => {
    try {
      const result = await window.api.library.getRandomTrack();
      if (!result.success) {
        toast.error(t("home.hero.loadFailed"));
        return;
      }
      if (!result.data) {
        toast.warning(t("home.quickActions.luck.empty"));
        return;
      }
      await player.playNow(result.data);
    } catch (error) {
      console.warn("[home] random track failed:", error);
      toast.error(t("home.hero.loadFailed"));
    }
  }, 800);
  return { playLucky };
};
