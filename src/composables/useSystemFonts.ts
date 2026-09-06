/** Read installed system fonts. */

/** System font families. */
const families = ref<string[]>([]);
/** Whether the font list is loading. */
const loading = ref(false);
/** Current font-loading task. */
let pending: Promise<void> | null = null;

/** Load, deduplicate, and sort system fonts. */
const fetchFamilies = async (): Promise<string[]> => {
  const list = await window.api.system.listFonts();
  const unique = Array.from(new Set(list.filter((f) => f.trim().length > 0)));
  unique.sort((a, b) => a.localeCompare(b, "en-US"));
  return unique;
};

/** Access system fonts. */
export const useSystemFonts = () => {
  /** Load once, then reuse the cached list. */
  const ensureLoaded = (): Promise<void> => {
    if (families.value.length > 0) return Promise.resolve();
    if (pending) return pending;
    loading.value = true;
    pending = fetchFamilies()
      .then((list) => {
        families.value = list;
      })
      .catch((err) => {
        console.error("[fonts] listFonts failed", err);
      })
      .finally(() => {
        loading.value = false;
        pending = null;
      });
    return pending;
  };

  return { families, loading, ensureLoaded };
};
