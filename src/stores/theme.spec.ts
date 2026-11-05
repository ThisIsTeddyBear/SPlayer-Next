import { createPinia, setActivePinia } from "pinia";
import { effectScope, nextTick, type EffectScope } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useThemeStore } from "./theme";
import { generatePalette, SOLID_PALETTE_DARK, SOLID_PALETTE_LIGHT } from "@/utils/color";

vi.mock("@/stores/settings", () => ({
  useSettingsStore: () => ({ player: { followCoverColor: true } }),
}));

let theme: ReturnType<typeof useThemeStore>;
let scope: EffectScope;

beforeEach(() => {
  setActivePinia(createPinia());
  theme = useThemeStore();
  scope = effectScope();
});

afterEach(() => {
  scope.stop();
  theme.$dispose();
  document.documentElement.removeAttribute("style");
  delete document.documentElement.dataset.songTheme;
  delete document.documentElement.dataset.appearanceStyle;
  document.documentElement.classList.remove("dark");
});

it("enables song theming by default and restores saved settings when turned off", async () => {
  expect(theme.songThemeEnabled).toBe(true);
  theme.mode = "dark";
  theme.source = "custom";
  theme.customColor = "#2563eb";
  theme.songLoaded = true;
  theme.songColors = ["#dc2626"];
  scope.run(theme.init);
  expect(document.documentElement.dataset.songTheme).toBe("active");
  expect(document.documentElement.style.getPropertyValue("--s-on-surface")).toBe(
    SOLID_PALETTE_DARK.onSurface,
  );

  theme.songThemeEnabled = false;
  await nextTick();
  expect(document.documentElement.dataset.songTheme).toBe("off");
  expect(document.documentElement.style.getPropertyValue("--s-primary")).toBe(
    generatePalette("#2563eb", true).primary,
  );
  expect(document.documentElement.style.getPropertyValue("--s-surface")).toBe(
    SOLID_PALETTE_DARK.surface,
  );
  expect(theme.source).toBe("custom");
  expect(theme.customColor).toBe("#2563eb");
});

it("restores the base theme when the loaded song is cleared", async () => {
  theme.mode = "dark";
  theme.songLoaded = true;
  theme.songColors = ["#dc2626"];
  scope.run(theme.init);
  theme.songLoaded = false;
  await nextTick();
  expect(theme.songThemeActive).toBe(false);
  expect(document.documentElement.dataset.songTheme).toBe("off");
  expect(document.documentElement.style.getPropertyValue("--s-surface")).toBe(
    SOLID_PALETTE_DARK.surface,
  );
});

it("uses neutral light and dark palettes for a loaded song without useful artwork", async () => {
  theme.mode = "light";
  theme.source = "custom";
  theme.customColor = "#dc2626";
  theme.songLoaded = true;
  scope.run(theme.init);
  expect(document.documentElement.style.getPropertyValue("--s-primary")).toBe(
    SOLID_PALETTE_LIGHT.primary,
  );
  theme.mode = "dark";
  await nextTick();
  expect(document.documentElement.style.getPropertyValue("--s-primary")).toBe(
    SOLID_PALETTE_DARK.primary,
  );
});

it("respects light mode with a saved wallpaper and preserves its settings", () => {
  theme.mode = "light";
  theme.appearanceStyle = "image";
  theme.imageBackground.src = "cache://wallpaper.jpg";
  theme.imageBackground.blur = 20;
  theme.imageBackground.dim = 0.4;
  expect(theme.isDark).toBe(false);
  theme.songThemeEnabled = false;
  expect(theme.isDark).toBe(true);
  expect(theme.imageBackground).toMatchObject({
    src: "cache://wallpaper.jpg",
    blur: 20,
    dim: 0.4,
  });
});
