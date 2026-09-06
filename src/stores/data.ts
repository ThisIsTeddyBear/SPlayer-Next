import type { Track } from "@shared/types/player";

const SEARCH_HISTORY_LIMIT = 12;

export const useDataStore = defineStore(
  "data",
  () => {
    const dailySongs = shallowRef<Track[]>([]);
    const dailyRecommend = shallowRef<Track[]>([]);
    const dailyHistory = shallowRef<Array<{ date: string; tracks: Track[] }>>([]);
    const loading = ref(false);
    const searchHistory = ref<string[]>([]);

    const refresh = async (): Promise<void> => {};
    const ensureDailyRecommend = async (_force = false): Promise<Track[]> => dailyRecommend.value;

    const addSearchHistory = (keyword: string): void => {
      const value = keyword.trim();
      if (!value) return;
      searchHistory.value = [
        value,
        ...searchHistory.value.filter(
          (item) => item.toLocaleLowerCase() !== value.toLocaleLowerCase(),
        ),
      ].slice(0, SEARCH_HISTORY_LIMIT);
    };

    const removeSearchHistory = (keyword: string): void => {
      searchHistory.value = searchHistory.value.filter((item) => item !== keyword);
    };

    const clearSearchHistory = (): void => {
      searchHistory.value = [];
    };

    return {
      dailySongs,
      dailyRecommend,
      dailyHistory,
      loading,
      refresh,
      ensureDailyRecommend,
      searchHistory,
      addSearchHistory,
      removeSearchHistory,
      clearSearchHistory,
    };
  },
  {
    persist: {
      storage: localStorage,
      pick: ["searchHistory"],
    },
  },
);
