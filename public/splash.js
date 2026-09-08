window.__splashStart = performance.now();
(() => {
  let mode = "system";
  try {
    const raw = localStorage.getItem("theme");
    if (raw) mode = JSON.parse(raw).mode || "system";
  } catch {}
  const isDark =
    mode === "dark" ||
    (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  if (!isDark) document.documentElement.classList.add("light");
})();
