import type { RecognitionHistoryEntry } from "@shared/types/recognition";

const RECENT_LIMIT = 6;

/** 首页只保留少量识别元数据，复用独立历史事件以免覆盖识别会话监听。 */
export const useRecentRecognitions = () => {
  const entries = shallowRef<RecognitionHistoryEntry[]>([]);
  let active = false;
  let requestId = 0;
  let unsubscribe: (() => void) | null = null;

  const load = async (): Promise<void> => {
    const token = ++requestId;
    try {
      const recent = await window.api.recognition.getHistory(RECENT_LIMIT);
      if (token === requestId) entries.value = recent;
    } catch (error) {
      console.warn("[home] recognition history failed:", error);
    }
  };

  onMounted(() => {
    unsubscribe = window.api.recognition.onHistoryChanged(() => {
      if (active && document.visibilityState === "visible") void load();
    });
  });

  onActivated(() => {
    active = true;
    if (document.visibilityState === "visible") void load();
  });

  onDeactivated(() => {
    active = false;
    requestId++;
  });

  useEventListener(document, "visibilitychange", () => {
    if (active && document.visibilityState === "visible") void load();
  });

  onBeforeUnmount(() => {
    active = false;
    requestId++;
    unsubscribe?.();
  });

  return { entries };
};
