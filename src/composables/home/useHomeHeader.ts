import type { PlayStatsSummary } from "@shared/types/stats";
import { useUserStore } from "@/stores/user";
import { useHistoryStore } from "@/stores/history";

/** 一条副标题 */
interface SubtitlePick {
  key: string;
  days?: number;
  count?: number;
  /** 需按当前语言格式化的时长（毫秒） */
  durationMs?: number;
}

/** 始终可用的纯问候语 */
const PLAIN_KEYS = ["home.subtitle.plain1", "home.subtitle.plain2", "home.subtitle.plain3"];

/** 随机取数组一项 */
const pickRandom = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)];

/**
 * 首页头部数据：按时段问候语、随机副标题、简洁聆听摘要
 *
 * 副标题每次进入随机挑一条（连续天数 / 本周时长 / 环比 / 新增收藏 / 最近播放），
 * 数据不足的条目自动不入池，纯问候恒在
 */
export const useHomeHeader = () => {
  const { t } = useI18n();
  const user = useUserStore();
  const history = useHistoryStore();
  const currentHour = ref(new Date().getHours());

  /** 时长格式化：X 小时 Y 分钟 */
  const formatHm = (ms: number): string => {
    const totalMin = Math.round(ms / 60000);
    const hours = Math.floor(totalMin / 60);
    const minutes = totalMin % 60;
    if (hours > 0 && minutes > 0) return t("home.duration.hm", { hours, minutes });
    if (hours > 0) return t("home.duration.hours", { hours });
    return t("home.duration.minutes", { minutes });
  };

  /** 按时段问候 key */
  const greetingKey = computed(() => {
    const hour = currentHour.value;
    if (hour < 6) return "home.greeting.dawn";
    if (hour < 12) return "home.greeting.morning";
    if (hour < 14) return "home.greeting.noon";
    if (hour < 18) return "home.greeting.afternoon";
    return "home.greeting.evening";
  });

  /** 问候标题：登录时附用户名，未登录仅问候语 */
  const greetingTitle = computed(() => {
    const greeting = t(greetingKey.value);
    const name = user.profile?.nickname;
    return name ? t("home.greetingLine", { greeting, name }) : greeting;
  });

  const stats = ref<PlayStatsSummary | null>(null);

  const listeningSummary = computed(() => {
    const data = stats.value;
    return data && data.weekListenedMs > 0
      ? t("home.stats.weekSummary", { duration: formatHm(data.weekListenedMs) })
      : null;
  });

  /** 副标题候选池 */
  const buildSubtitles = (): SubtitlePick[] => {
    const pool: SubtitlePick[] = PLAIN_KEYS.map((key) => ({ key }));
    const data = stats.value;
    if (data) {
      if (data.streakDays >= 2) {
        pool.push({ key: "home.subtitle.streak", days: data.streakDays });
      }
      if (data.weekListenedMs > 0) {
        pool.push({ key: "home.subtitle.weekListened", durationMs: data.weekListenedMs });
        const diff = data.weekListenedMs - data.lastWeekListenedMs;
        if (data.lastWeekListenedMs > 0 && Math.abs(diff) >= 60000) {
          pool.push({
            key: diff > 0 ? "home.subtitle.weekMore" : "home.subtitle.weekLess",
            durationMs: Math.abs(diff),
          });
        }
      }
      if (data.weekFavoriteAdds > 0) {
        pool.push({ key: "home.subtitle.favorites", count: data.weekFavoriteAdds });
      }
    }
    if (history.tracks.length > 0) pool.push({ key: "home.subtitle.recent" });
    return pool;
  };

  /** 随机挑中的副标题 */
  const subtitlePick = ref<SubtitlePick>({ key: pickRandom(PLAIN_KEYS) });

  /** 副标题文案 */
  const greetingSub = computed(() => {
    const pick = subtitlePick.value;
    const params: Record<string, string | number> = {};
    if (pick.days !== undefined) params.days = pick.days;
    if (pick.count !== undefined) params.count = pick.count;
    if (pick.durationMs !== undefined) params.duration = formatHm(pick.durationMs);
    return t(pick.key, params);
  });

  /** 拉取统计并重挑副标题 */
  const load = async (): Promise<void> => {
    currentHour.value = new Date().getHours();
    await history.load();
    try {
      stats.value = await window.api.stats.getStatsSummary();
    } catch (error) {
      console.warn("[home] getStatsSummary failed:", error);
    }
    subtitlePick.value = pickRandom(buildSubtitles());
  };

  return { greetingTitle, greetingSub, listeningSummary, load };
};
