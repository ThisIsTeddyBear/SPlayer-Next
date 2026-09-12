/** 封装 Shazam 系统音频识别会话的响应式状态。 */

import type {
  RecognitionCandidate,
  RecognitionError,
  RecognitionEvent,
  RecognitionPhase,
} from "@shared/types/recognition";

const RECOGNITION_DURATION_MS = 12_000;

export const useRecognitionSession = () => {
  const supported = ref<boolean | null>(null);
  const phase = ref<RecognitionPhase>("idle");
  const level = ref(0);
  const candidates = ref<RecognitionCandidate[]>([]);
  const error = ref<RecognitionError | null>(null);

  let unsubscribe: (() => void) | null = null;

  /** 清空结果状态并回到 idle */
  const reset = (): void => {
    phase.value = "idle";
    level.value = 0;
    candidates.value = [];
    error.value = null;
  };

  /** 处理主进程广播的识别事件 */
  const handleEvent = (event: RecognitionEvent): void => {
    phase.value = event.phase;
    if (event.level !== undefined) level.value = event.level;
    if (event.candidates) candidates.value = event.candidates;
    if (event.error) error.value = event.error;
    if (event.phase !== "capturing") level.value = 0;
  };

  /** 开始一次系统音频识别 */
  const start = async (): Promise<void> => {
    if (supported.value !== true) return;
    reset();
    phase.value = "capturing";
    await window.api.recognition.start({ durationMs: RECOGNITION_DURATION_MS });
  };

  /** 取消当前识别 */
  const stop = (resetState = true): void => {
    void window.api.recognition.cancel();
    if (resetState) reset();
  };

  onMounted(() => {
    void window.api.recognition.isSupported().then((value) => {
      supported.value = value;
    });
    unsubscribe = window.api.recognition.onEvent(handleEvent);
  });

  onBeforeUnmount(() => {
    stop();
    unsubscribe?.();
  });

  return { supported, phase, level, candidates, error, start, stop, reset };
};
