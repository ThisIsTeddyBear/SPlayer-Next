export const useDataStore: any = defineStore("data", () => {
  const dailySongs = shallowRef([]);
  const loading = ref(false);
  const refresh = async (): Promise<void> => {};
  return { dailySongs, loading, refresh } as any;
});
