export interface RendererRuntime {
  installType: "nsis" | "portable" | "appx" | "dmg" | "appimage";
  osInfo: { type: string; arch: string; release: string };
}
