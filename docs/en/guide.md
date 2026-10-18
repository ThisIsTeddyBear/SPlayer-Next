# User Guide

This page covers the basics of SPlayer-Next. See [Download](/en/download) for installation packages.

## Playing music

- **Search and play:** Enter a song, artist, or album in the top search box, then play it or add it to the queue.
- **Queue:** Use sequential, shuffle, and repeat-one modes, and drag tracks to reorder them.
- **Quality and effects:** Select audio quality and enable fades, loudness normalization, the equalizer, playback speed, and pitch controls in Settings.

### Audio quality badges

The player badge describes the loaded source audio. Playback and download quality settings are requests; the delivered audio may differ. Before playback, list badges use the available library or provider metadata, which may describe the highest available version. Hover over a badge to see its source parameters, or open the full player's quality details.

| Badge        | Classification                                                                                                                                        |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hi-Res**   | Lossless or uncompressed linear PCM with at least 44.1 kHz and 16-bit resolution, and either a sample rate above 48 kHz or a bit depth above 16 bits. |
| **Lossless** | A recognized lossless codec or uncompressed linear PCM that does not qualify as Hi-Res. There is no minimum bitrate.                                  |
| **HQ**       | A recognized lossy codec at 320 kbps or above.                                                                                                        |
| **SQ**       | A recognized lossy codec at 192 kbps or above, below 320 kbps.                                                                                        |
| **LQ**       | A recognized lossy codec below 192 kbps.                                                                                                              |
| **Unknown**  | The codec is missing or unrecognized, or a lossy codec's bitrate is unavailable.                                                                      |

The Hi-Res rule follows the [JEITA examples published by the Japan Audio Society](https://www.jas-audio.or.jp/hi-res/definition). For example, 16-bit / 44.1 kHz PCM WAV is Lossless; 24-bit / 44.1 kHz, 24-bit / 48 kHz, and 16-bit / 88.2 kHz lossless audio are Hi-Res. Lossless audio with missing resolution metadata remains Lossless until its resolution can be established.

LQ, SQ, and HQ are SPlayer's bitrate categories, rather than universal quality standards. Bitrate does not indicate equal fidelity across different codecs. File extensions alone do not establish the encoding: WAV and AIFF containers require a recognized audio codec. Badges describe encoding and resolution; they do not verify recording provenance or detect upsampling. Audio output settings and Bit Perfect status are shown separately.

## Local music

1. Open **Settings → Local Music** or the library page and add folders to scan.
2. After scanning, browse the library by track, album, or artist.
3. Local track tags and cover art can be edited in the metadata editor.

## Streaming

Connect self-hosted Subsonic, Navidrome, Jellyfin, or Emby servers. See [Streaming Services](/en/streaming).

## Lyrics

SPlayer-Next supports LRC, QRC, YRC, and TTML, including word-by-word highlighting, translations, and romanization. Online lyrics are matched according to **Settings → Lyrics → Source preference**, source order, and format preference.

### Online TTML lyrics

[AMLL TTML DB](https://github.com/amll-dev/amll-ttml-db) is a community-maintained database of high-quality word-timed lyrics, often including translations and romanization.

- Enable **Settings → Lyrics → Online TTML lyrics** (Beta).
- Configure the AMLL TTML DB URL template. It must contain `%p` for platform and `%s` for song ID.
- When a match is found, its timed words, translation, and romanization are used.

### Local TTML library

If you maintain your own TTML files, select a local directory as a lyrics library:

- Enable **Settings → Lyrics → Local TTML lyrics library** (Beta).
- Choose a folder containing `.ttml` files. Tracks are matched by metadata such as title and artist.
- A local match takes precedence over online lyrics.

### Lyrics windows

- **Desktop lyrics:** A configurable floating window with positioning, typography, colors, alignment, translations, word timing, locking, and click-through.
- **Dynamic Island:** A compact lyric strip centered at the top of the screen.
- **Taskbar lyrics (Windows):** Displays the current line in the Windows taskbar.

Toggle these windows from the player or tray menu and configure their styles independently.

## System integration

- **System media controls:** Windows SMTC, Linux MPRIS, and macOS Now Playing provide lock-screen, notification, and media-key control.
- **Discord status:** Optionally show the current track in Discord.
- **Global shortcuts:** Bind global playback shortcuts in Settings.

## Plugins

The plugin system extends music sources and playback control. See [Using Plugins](/en/plugins-usage) and [Plugin Development](/en/plugins/).

## External control

Optional HTTP and WebSocket APIs and a separate local MCP service let other programs or AI clients inspect and control playback. See the [HTTP API](/en/api), [WebSocket API](/en/socket), and [MCP interface](/en/mcp).
