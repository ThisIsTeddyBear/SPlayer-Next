import { createPinia, disposePinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSettingsStore } from "./settings";

const mocks = vi.hoisted(() => ({ set: vi.fn(), error: vi.fn() }));
vi.mock("@/composables/useToast", () => ({ toast: { error: mocks.error } }));
vi.mock("@/i18n", () => ({ default: { global: { t: (key: string) => key } } }));
let pinia: ReturnType<typeof createPinia>;
beforeEach(() => {
  pinia = createPinia();
  setActivePinia(pinia);
  mocks.set.mockReset().mockResolvedValue(undefined);
  mocks.error.mockClear();
  window.api = {
    config: { set: mocks.set },
    desktopLyric: { onConfigChange: () => () => {} },
    dynamicIsland: { onConfigChange: () => () => {} },
    window: {
      onDesktopLyricVisibilityChange: () => () => {},
      onDynamicIslandVisibilityChange: () => () => {},
      onTaskbarLyricVisibilityChange: () => () => {},
      isDesktopLyricOpen: async () => false,
      isDynamicIslandOpen: async () => false,
      isTaskbarLyricOpen: async () => false,
    },
  } as unknown as typeof window.api;
});
afterEach(() => disposePinia(pinia));

it("resets a setup store without replacing mounted reactive objects", () => {
  const store = useSettingsStore();
  const appearance = store.appearance;
  store.appearance.sidebarCollapsed = true;
  store.player.outputDevice = "other-device";
  store.preset.skipKeywordsSongs = true;
  store.$reset();
  expect(store.appearance).toBe(appearance);
  expect(store.appearance.sidebarCollapsed).toBe(false);
  expect(store.preset.skipKeywordsSongs).toBe(false);
  expect(store.player.outputDevice).toBeNull();
});

it("rolls back settings when persistence fails and reports the failure", async () => {
  const store = useSettingsStore();
  const previous = store.system.system.uiZoom;
  mocks.set.mockRejectedValueOnce(new Error("disk full"));
  await expect(store.setSystem("system.uiZoom", 1.5)).rejects.toThrow("disk full");
  expect(store.system.system.uiZoom).toBe(previous);
  expect(mocks.error).toHaveBeenCalledWith("settings.persistenceFailed");
});
