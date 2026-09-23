<div align="center">

<img alt="SPlayer-Next logo" width="120" height="120" src="public/icons/favicon.png" />

# SPlayer-Next

**Your music, beautifully played.**

A desktop music player with a carefully crafted layout, expressive lyrics, local and streaming libraries, and a Rust-powered audio engine. Successor to [SPlayer](https://github.com/SPlayer-Dev/SPlayer).

[Download](https://github.com/SPlayer-Dev/SPlayer-Next/releases) · [Documentation](https://splayer-next.imsyy.top) · [Report an issue](https://github.com/SPlayer-Dev/SPlayer-Next/issues)

[![Stars](https://img.shields.io/github/stars/SPlayer-Dev/SPlayer-Next?style=flat)](https://github.com/SPlayer-Dev/SPlayer-Next/stargazers)
[![Release](https://img.shields.io/github/v/release/SPlayer-Dev/SPlayer-Next)](https://github.com/SPlayer-Dev/SPlayer-Next/releases)
[![License](https://img.shields.io/github/license/SPlayer-Dev/SPlayer-Next)](LICENSE)
[![CI](https://github.com/SPlayer-Dev/SPlayer-Next/actions/workflows/ci.yml/badge.svg)](https://github.com/SPlayer-Dev/SPlayer-Next/actions/workflows/ci.yml)

</div>

## Why SPlayer-Next?

- **A layout made for music.** A polished library, queue, and full-player view pair cover-driven colors with light, dark, and automatic themes. The full player adds a dynamic background and live audio spectrum.
- **Recognize what is playing.** Shazam-powered recognition listens to system audio and returns matching songs, with links to Apple Music, Spotify, and YouTube Music when available.
- **Hear the source.** On Windows, WASAPI exclusive playback can deliver bit-perfect output when the source, output device, and settings allow it. An audio information dialog shows the actual source and output formats, resampling, processing, and bit-perfect status.
- **Follow every word.** Smooth, word-by-word karaoke lyrics support translations, romanization, background vocals, and duets. Open them in the full player, a floating desktop window, a compact Dynamic Island, or the Windows taskbar.

## Features

### Lyrics with room for detail

- Parse **TTML, QRC, JSON, LRC, YRC, KRC, LyS, SRT, and ASS** lyrics, including timed words where the format provides them.
- Use online, embedded, or local lyrics, set source and format preferences, and match tracks against an optional local TTML library or AMLL TTML DB.
- Customize desktop lyrics and keep a compact lyric view visible while using other apps.

### Playback and sound

- Play MP3, FLAC, WAV, AAC, OGG, APE, and more through a native Rust and FFmpeg audio engine.
- Choose an output device and use playback speed, pitch control, an equalizer, fades, and loudness normalization.
- Use Windows exclusive mode for supported devices and tracks. Bit-perfect status is reported for the **current output**, rather than assumed from the file format.
- See a real-time FFT spectrum and detailed audio stream information.

### Your music, wherever it lives

- Scan local folders and browse tracks, albums, and artists. Edit local metadata and cover art, create playlists, and organize the playback queue.
- Connect multiple **Subsonic-compatible servers** (including Navidrome, OpenSubsonic, Airsonic, Gonic, and LMS), **Jellyfin**, or **Emby**. Browse their tracks, albums, artists, and playlists from the app.
- Search online music sources, choose available quality, and manage downloads in the app.
- Scrobble to Last.fm and optionally show the current song through Discord Rich Presence.

### At home on the desktop

- Runs on **Windows, macOS, and Linux**, with Windows SMTC, macOS Now Playing, and Linux MPRIS media controls.
- Supports media keys, global shortcuts, tray controls, and a native Windows taskbar lyric view.
- Extend music sources and playback control with plugins. Optional HTTP, WebSocket, and MCP interfaces support external integrations.
- Offers English and Simplified Chinese interfaces.

Some features depend on the operating system, a connected server, or a third-party service. See the [user guide](https://splayer-next.imsyy.top/en/guide) and [streaming guide](https://splayer-next.imsyy.top/en/streaming) for setup details.

## Get SPlayer-Next

Download an installer or portable package from [GitHub Releases](https://github.com/SPlayer-Dev/SPlayer-Next/releases). Windows, macOS, and Linux packages are available; the [download guide](https://splayer-next.imsyy.top/en/download) explains package choices and release channels.

## Development

### Requirements

- Node.js 22.19 or newer
- pnpm 10 or newer
- Rust toolchain for native modules

### Run locally

```bash
pnpm install
pnpm dev
```

`pnpm dev` builds native modules in debug mode and starts Electron. Set `SKIP_NATIVE_BUILD=true` when working only on the UI with native modules already built.

### Build and check

```bash
pnpm build          # Native modules, typecheck, and Electron/Vite build
pnpm build:win      # Windows package
pnpm build:mac      # macOS package
pnpm build:linux    # Linux packages
pnpm typecheck
pnpm lint
pnpm test
pnpm prettier --check .
```

Builds target the current architecture; cross-compilation is not supported. The audio engine bundles FFmpeg through its Rust dependency, so no system FFmpeg installation is required. Linux native builds need PulseAudio development files for audio capture. See [contributing](https://splayer-next.imsyy.top/en/contributing) for more details.

## Acknowledgements

SPlayer-Next builds on open-source work including [applemusic-like-lyrics](https://github.com/Steve-xmh/applemusic-like-lyrics) and [NeteaseCloudMusicApiEnhanced](https://github.com/neteasecloudmusicapienhanced/api-enhanced).

## License and third-party services

SPlayer-Next is licensed under [AGPL-3.0](LICENSE). See the license for the full terms. Features that connect to third-party services require a network connection and are subject to those services' availability and terms. The software is provided without warranty.
