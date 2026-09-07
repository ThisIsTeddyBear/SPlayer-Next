import { defineConfig, type DefaultTheme } from "vitepress";

const socialLinks: DefaultTheme.SocialLink[] = [
  { icon: "github", link: "https://github.com/SPlayer-Dev/SPlayer-Next" },
];

const themeConfig: DefaultTheme.Config = {
  nav: [
    { text: "Home", link: "/en/" },
    { text: "Download", link: "/en/download" },
    { text: "User Guide", link: "/en/guide" },
    {
      text: "Development",
      items: [
        { text: "Native Modules", link: "/en/native" },
        { text: "Plugin Development", link: "/en/plugins/" },
        { text: "External API", link: "/en/api" },
        { text: "MCP", link: "/en/mcp" },
        { text: "Contributing", link: "/en/contributing" },
      ],
    },
    { text: "Type Reference", link: "/en/types" },
    {
      text: "About",
      items: [
        { text: "User Agreement", link: "/en/agreement" },
        { text: "Privacy Policy", link: "/en/privacy" },
      ],
    },
    { text: "GitHub", link: "https://github.com/SPlayer-Dev/SPlayer-Next" },
  ],
  sidebar: [
    {
      text: "Guides",
      items: [
        { text: "Download", link: "/en/download" },
        { text: "User Guide", link: "/en/guide" },
        { text: "Streaming Services", link: "/en/streaming" },
        { text: "Using Plugins", link: "/en/plugins-usage" },
        { text: "User Agreement", link: "/en/agreement" },
        { text: "Privacy Policy", link: "/en/privacy" },
      ],
    },
    {
      text: "Interfaces",
      items: [
        { text: "External API (HTTP)", link: "/en/api" },
        { text: "WebSocket API", link: "/en/socket" },
        { text: "MCP", link: "/en/mcp" },
      ],
    },
    {
      text: "Development",
      items: [
        { text: "Native Modules", link: "/en/native" },
        {
          text: "Plugin Development",
          items: [
            { text: "Overview and Architecture", link: "/en/plugins/" },
            { text: "Source Plugins", link: "/en/plugins/source" },
            { text: "Control Plugins", link: "/en/plugins/control" },
            { text: "Plugin Updates", link: "/en/plugins/update" },
          ],
        },
        { text: "Type Reference", link: "/en/types" },
        { text: "Contributing", link: "/en/contributing" },
      ],
    },
    {
      text: "Troubleshooting",
      items: [
        { text: "Debug Mode and Errors", link: "/en/troubleshooting/debug" },
        { text: "Common macOS Issues", link: "/en/troubleshooting/macos" },
        { text: "macOS Reports a Damaged App", link: "/en/troubleshooting/macos-damaged" },
        { text: "Windows 7 Compatibility", link: "/en/troubleshooting/windows7" },
        { text: "Ubuntu Sandbox Startup Failure", link: "/en/troubleshooting/ubuntu-sandbox" },
        { text: "Linux Wayland Compatibility", link: "/en/troubleshooting/wayland" },
      ],
    },
  ],
  outline: { level: [2, 3], label: "On this page" },
  footer: {
    message:
      'Released under AGPL-3.0 | <a href="/en/agreement">User Agreement</a> | <a href="/en/privacy">Privacy Policy</a>',
    copyright: "Copyright © 2025-present imsyy",
  },
  editLink: {
    pattern: "https://github.com/SPlayer-Dev/SPlayer-Next/blob/dev/docs/:path?plain=1",
    text: "View or edit this page",
  },
  lastUpdated: {
    text: "Last updated",
    formatOptions: { dateStyle: "medium", timeStyle: "short" },
  },
};

export default defineConfig({
  title: "SPlayer-Next",
  srcExclude: ["superpowers/**"],
  head: [
    ["link", { rel: "icon", href: "/favicon.png" }],
    ["meta", { name: "author", content: "imsyy" }],
    [
      "meta",
      {
        name: "keywords",
        content: "SPlayer,SPlayer-Next,music player,desktop lyrics,streaming,Electron,Vue3,Rust",
      },
    ],
  ],
  locales: {
    en: {
      label: "English",
      lang: "en-US",
      link: "/en/",
      description: "A clean and refined cross-platform desktop music player",
      themeConfig,
    },
  },
  themeConfig: {
    logo: "/favicon.png",
    siteTitle: "SPlayer-Next",
    socialLinks,
    search: {
      provider: "local",
    },
  },
});
