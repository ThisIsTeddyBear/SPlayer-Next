// 确定明暗模式与主色
(function () {
  let mode = "system";
  let primary = "#fe7971";
  try {
    const raw = localStorage.getItem("theme");
    if (raw) {
      const theme = JSON.parse(raw);
      mode = theme.mode || "system";
      if (
        theme.source === "custom" &&
        typeof theme.customColor === "string" &&
        theme.customColor.startsWith("#")
      ) {
        primary = theme.customColor;
      }
    }
  } catch (e) {}
  document.documentElement.style.setProperty("--splash-primary", primary);
  const isDark =
    mode === "dark" ||
    (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  if (!isDark) document.documentElement.classList.add("light");
})();
