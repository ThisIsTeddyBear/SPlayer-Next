//! FLAC 封面溢出、完整音频保留和失败回滚的回归测试。

use super::super::editor::{read_tags as read_editor_tags, write_tags};
use super::*;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

struct Fixture(PathBuf);

impl Fixture {
    fn new(name: &str, bytes: &[u8]) -> Self {
        static SEQUENCE: AtomicU64 = AtomicU64::new(0);
        let directory = std::env::temp_dir().join(format!(
            "splayer-flac-{}-{}-{name}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("track.flac");
        fs::write(&path, bytes).unwrap();
        Self(path)
    }

    fn request(&self) -> TagWriteRequest {
        TagWriteRequest {
            path: self.0.to_string_lossy().into_owned(),
            ..Default::default()
        }
    }

    fn assert_no_temporary_files(&self) {
        assert_eq!(fs::read_dir(self.0.parent().unwrap()).unwrap().count(), 1);
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(self.0.parent().unwrap());
    }
}

/// 生成可解码的双声道常量子帧，避免用任意字节冒充音频。
fn audio() -> Vec<u8> {
    let mut bytes = vec![0xff, 0xf8, 0x69, 0x18, 0, 15];
    let mut crc = 0u8;
    for byte in &bytes {
        crc ^= byte;
        for _ in 0..8 {
            crc = if crc & 0x80 != 0 {
                (crc << 1) ^ 7
            } else {
                crc << 1
            };
        }
    }
    bytes.push(crc);
    bytes.extend_from_slice(&[0, 0x01, 0x23, 0, 0x45, 0x67]);
    let mut crc = 0u16;
    for byte in &bytes {
        crc ^= u16::from(*byte) << 8;
        for _ in 0..8 {
            crc = if crc & 0x8000 != 0 {
                (crc << 1) ^ 0x8005
            } else {
                crc << 1
            };
        }
    }
    bytes.extend_from_slice(&crc.to_be_bytes());
    bytes
}

fn png_chunk(bytes: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    let mut table = [0u32; 256];
    for (index, entry) in table.iter_mut().enumerate() {
        let mut value = index as u32;
        for _ in 0..8 {
            value = if value & 1 != 0 {
                (value >> 1) ^ 0xedb8_8320
            } else {
                value >> 1
            };
        }
        *entry = value;
    }
    let mut crc = u32::MAX;
    for byte in kind.iter().chain(data) {
        crc = table[((crc ^ u32::from(*byte)) & 255) as usize] ^ (crc >> 8);
    }
    bytes.extend_from_slice(&(data.len() as u32).to_be_bytes());
    bytes.extend_from_slice(kind);
    bytes.extend_from_slice(data);
    bytes.extend_from_slice(&(!crc).to_be_bytes());
}

/// 大图片用合法的私有辅助块占位，无需分配巨大的解码位图。
fn png(overflow: bool) -> Vec<u8> {
    let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
    png_chunk(&mut bytes, b"IHDR", &[0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
    if overflow {
        png_chunk(&mut bytes, b"spLa", &vec![0; 1 << 24]);
    }
    png_chunk(
        &mut bytes,
        b"IDAT",
        &[0x78, 1, 1, 5, 0, 0xfa, 0xff, 0, 0, 0, 0, 0, 0, 5, 0, 1],
    );
    png_chunk(&mut bytes, b"IEND", &[]);
    bytes
}

fn picture(overflow: bool) -> Vec<u8> {
    let image = png(overflow);
    let mut bytes = 3u32.to_be_bytes().to_vec();
    bytes.extend_from_slice(&9u32.to_be_bytes());
    bytes.extend_from_slice(b"image/png");
    bytes.extend_from_slice(&0u32.to_be_bytes());
    for field in [1u32, 1, 32, 0, image.len() as u32] {
        bytes.extend_from_slice(&field.to_be_bytes());
    }
    bytes.extend_from_slice(&image);
    bytes
}

/// 独立构造长度前缀，不调用待验证的标签编码器。
fn comments(fields: &[&str]) -> Vec<u8> {
    let mut bytes = 12u32.to_le_bytes().to_vec();
    bytes.extend_from_slice(b"fixture-tool");
    bytes.extend_from_slice(&(fields.len() as u32).to_le_bytes());
    for field in fields {
        bytes.extend_from_slice(&(field.len() as u32).to_le_bytes());
        bytes.extend_from_slice(field.as_bytes());
    }
    bytes
}

fn file_bytes(blocks: &[(u8, Vec<u8>)]) -> Vec<u8> {
    let mut bytes = b"fLaC".to_vec();
    let mut stream_info = vec![0; 34];
    stream_info[..4].copy_from_slice(&[0, 16, 0, 16]);
    let properties = (44100u64 << 44) | (1 << 41) | (15 << 36) | 16;
    stream_info[10..18].copy_from_slice(&properties.to_be_bytes());
    bytes.extend_from_slice(&[
        if blocks.is_empty() { 0x80 } else { 0 },
        0,
        0,
        34,
    ]);
    bytes.extend_from_slice(&stream_info);
    for (index, (kind, payload)) in blocks.iter().enumerate() {
        // 复现旧封装器的长度截断，载荷仍完整写入。
        let size = (payload.len() as u32).to_be_bytes();
        bytes.push(*kind | if index + 1 == blocks.len() { 0x80 } else { 0 });
        bytes.extend_from_slice(&size[1..]);
        bytes.extend_from_slice(payload);
    }
    bytes.extend_from_slice(&audio());
    bytes
}

/// 按文件中的实际图片长度定位，独立于生产块扫描器。
fn raw_blocks(path: &Path) -> (Vec<(u8, Vec<u8>)>, Vec<u8>) {
    let bytes = fs::read(path).unwrap();
    let mut offset = 4;
    let mut blocks = Vec::new();
    loop {
        let kind = bytes[offset] & 0x7f;
        let last = bytes[offset] & 0x80 != 0;
        let start = offset + 4;
        let mut size = u32::from_be_bytes([
            0,
            bytes[offset + 1],
            bytes[offset + 2],
            bytes[offset + 3],
        ]) as usize;
        if kind == 6 {
            let mime =
                u32::from_be_bytes(bytes[start + 4..start + 8].try_into().unwrap()) as usize;
            let description_offset = start + 8 + mime;
            let description = u32::from_be_bytes(
                bytes[description_offset..description_offset + 4]
                    .try_into()
                    .unwrap(),
            ) as usize;
            let image_length_offset = description_offset + 4 + description + 16;
            let image_length = u32::from_be_bytes(
                bytes[image_length_offset..image_length_offset + 4]
                    .try_into()
                    .unwrap(),
            ) as usize;
            size = image_length_offset + 4 - start + image_length;
        }
        blocks.push((kind, bytes[start..start + size].to_vec()));
        offset = start + size;
        if last {
            break;
        }
    }
    (blocks, bytes[offset..].to_vec())
}

fn assert_decodes(path: &Path) {
    let mut reader = ffmpeg_audio::AudioReader::new(File::open(path).unwrap()).unwrap();
    assert_eq!(reader.source_info().channels, 2);
    assert_eq!(reader.source_info().sample_rate, 44100);
    assert!(reader.receive_frame().unwrap().is_some());
}

#[test]
fn text_edits_preserve_pictures_unknown_blocks_and_unedited_comments() {
    let fields = [
        "TITLE=原标题",
        "ARTIST=歌手 A",
        "ARTIST=歌手 B",
        "DATE=2019-05-14",
        "TRACKNUMBER=6/7",
        "X-CUSTOM=值=原样保留",
        "COMMENT=原始注释",
    ];
    let fixture = Fixture::new(
        "normal",
        &file_bytes(&[
            (4, comments(&fields)),
            (2, b"test application data".to_vec()),
            (1, vec![0; 31]),
            (6, picture(false)),
            (6, picture(false)),
        ]),
    );
    let before = raw_blocks(&fixture.0);
    let mut request = fixture.request();
    request.title = Some("新标题 🎵".into());
    write_tags(&request).unwrap();
    let after = raw_blocks(&fixture.0);
    assert_eq!(after.1, before.1);
    assert_eq!(
        after.0.iter().filter(|(kind, _)| *kind != 4).collect::<Vec<_>>(),
        before.0.iter().filter(|(kind, _)| *kind != 4).collect::<Vec<_>>()
    );
    let expected = comments(&[
        "ARTIST=歌手 A",
        "ARTIST=歌手 B",
        "DATE=2019-05-14",
        "TRACKNUMBER=6/7",
        "X-CUSTOM=值=原样保留",
        "COMMENT=原始注释",
        "TITLE=新标题 🎵",
    ]);
    assert!(after.0.iter().any(|(kind, bytes)| *kind == 4 && *bytes == expected));
    let tags = read_editor_tags(&request.path).unwrap();
    assert_eq!(tags.title.as_deref(), Some("新标题 🎵"));
    assert_eq!(tags.track_number, Some(6));
    assert!(tags.has_cover);
    assert_decodes(&fixture.0);
    fixture.assert_no_temporary_files();
}

#[test]
fn oversized_cover_survives_repeated_edits_before_or_after_comments() {
    let cover = picture(true);
    assert!(cover.len() > MAX_BLOCK_SIZE as usize);
    for cover_last in [true, false] {
        let mut blocks = vec![(4, comments(&["TITLE=原名", "ALBUM=原专辑"]))];
        if cover_last {
            blocks.push((6, cover.clone()));
        } else {
            blocks.insert(0, (6, cover.clone()));
        }
        let fixture = Fixture::new("overflow", &file_bytes(&blocks));
        assert_decodes(&fixture.0);
        assert!(read_editor_tags(&fixture.request().path).unwrap().has_cover);
        for title in ["新名字".repeat(30), "短".into(), String::new()] {
            let mut request = fixture.request();
            request.title = Some(title.clone());
            request.lyrics = Some("[00:01.00]歌词".into());
            write_tags(&request).unwrap();
            let tags = read_editor_tags(&request.path).unwrap();
            assert_eq!(
                tags.title,
                if title.is_empty() { None } else { Some(title) }
            );
            assert_eq!(tags.album.as_deref(), Some("原专辑"));
            assert_eq!(tags.lyrics.as_deref(), Some("[00:01.00]歌词"));
            assert!(tags.has_cover);
            let (blocks, saved_audio) = raw_blocks(&fixture.0);
            let pictures: Vec<_> = blocks.iter().filter(|(kind, _)| *kind == 6).collect();
            assert_eq!(pictures.len(), 1);
            assert_eq!(pictures[0].1, cover);
            assert_eq!(saved_audio, audio());
            assert_decodes(&fixture.0);
            fixture.assert_no_temporary_files();
        }
    }
}

#[test]
fn replacing_oversized_cover_removes_every_old_image_byte() {
    let fixture = Fixture::new(
        "replace",
        &file_bytes(&[
            (4, comments(&["TITLE=原名", "COVERART=AAAA", "COVERARTMIME=image/png"])),
            (6, picture(true)),
            (6, picture(false)),
        ]),
    );
    let mut request = fixture.request();
    let replacement = png(false);
    request.cover = Some(replacement.clone());
    write_tags(&request).unwrap();
    let (blocks, saved_audio) = raw_blocks(&fixture.0);
    let pictures: Vec<_> = blocks.iter().filter(|(kind, _)| *kind == 6).collect();
    assert_eq!(pictures.len(), 1);
    assert!(pictures[0].1.ends_with(&replacement));
    assert!(fs::metadata(&fixture.0).unwrap().len() < 1024);
    assert_eq!(saved_audio, audio());
    let tagged = lofty::read_from_path(&fixture.0).unwrap();
    assert_eq!(tagged.primary_tag().unwrap().pictures().len(), 1);
    assert!(read_editor_tags(&request.path).unwrap().has_cover);
    assert_decodes(&fixture.0);
}

#[test]
fn oversized_replacement_is_rejected_without_replacing_original() {
    let bytes = file_bytes(&[(4, comments(&["TITLE=原名"])), (6, picture(false))]);
    let fixture = Fixture::new("reject-new-cover", &bytes);
    let mut request = fixture.request();
    request.cover = Some(png(true));
    assert!(write_tags(&request).unwrap_err().to_string().contains("FLAC"));
    assert_eq!(fs::read(&fixture.0).unwrap(), bytes);
    fixture.assert_no_temporary_files();
}

#[test]
fn partial_number_edits_preserve_totals_and_clear_all_lyric_aliases() {
    let fixture = Fixture::new(
        "numbers",
        &file_bytes(&[(4, comments(&[
            "TRACKNUMBER=6/7",
            "DISCNUMBER=1/2",
            "ALBUM ARTIST=原歌手",
            "DATE=2019-05-14",
            "YEAR=2018",
            "LYRICS=旧歌词",
            "UNSYNCED LYRICS ENG=另一份旧歌词",
            "LYRICIST=作词者",
            "LYRICIST ENG=英文作词者",
            "COMMENT=保留",
        ]))]),
    );
    let mut request = fixture.request();
    request.track_number = Some(4);
    request.disc_number = Some(0);
    request.album_artist = Some("新歌手".into());
    request.year = Some(2026);
    request.lyrics = Some(String::new());
    write_tags(&request).unwrap();
    let tags = read_editor_tags(&request.path).unwrap();
    assert_eq!(tags.track_number, Some(4));
    assert_eq!(tags.disc_number, None);
    assert_eq!(tags.album_artist.as_deref(), Some("新歌手"));
    assert_eq!(tags.year, Some(2026));
    assert_eq!(tags.lyrics, None);
    let saved = lofty::read_from_path(&fixture.0).unwrap();
    let tag = saved.primary_tag().unwrap();
    use lofty::prelude::Accessor;
    assert_eq!(tag.track_total(), Some(7));
    assert_eq!(tag.disk_total(), Some(2));
    assert_eq!(tag.get_string(ItemKey::Lyricist), Some("作词者"));
    let (blocks, _) = raw_blocks(&fixture.0);
    assert!(blocks.iter().any(|(kind, bytes)| {
        *kind == 4 && bytes.windows(b"LYRICIST ENG=".len()).any(|key| key == b"LYRICIST ENG=")
    }));
}

#[test]
fn text_edit_preserves_custom_lyrics_and_lyricist_credit() {
    let fixture = Fixture::new(
        "custom-lyrics",
        &file_bytes(&[(4, comments(&[
            "TITLE=原名",
            "UNSYNCED LYRICS ENG=[00:01.00]歌词",
            "LYRICIST=作词者",
        ]))]),
    );
    let mut request = fixture.request();
    assert_eq!(
        read_editor_tags(&request.path).unwrap().lyrics.as_deref(),
        Some("[00:01.00]歌词")
    );
    request.title = Some("新标题".into());
    write_tags(&request).unwrap();
    assert_eq!(
        read_editor_tags(&request.path).unwrap().lyrics.as_deref(),
        Some("[00:01.00]歌词")
    );
    let (blocks, _) = raw_blocks(&fixture.0);
    let expected = comments(&[
        "UNSYNCED LYRICS ENG=[00:01.00]歌词",
        "LYRICIST=作词者",
        "TITLE=新标题",
    ]);
    assert!(blocks.iter().any(|(kind, bytes)| *kind == 4 && *bytes == expected));
}

#[test]
fn malformed_files_leave_original_and_no_temporary_file() {
    let overflow = picture(true);
    for case in [
        "length-mismatch",
        "truncated-image",
        "bad-png-ending",
        "bad-frame-crc",
        "bad-audio-subframe",
        "unsupported-overflow-picture",
        "duplicate-comments",
        "bad-comment-length",
        "missing-audio",
    ] {
        let mut bytes = file_bytes(&[(4, comments(&["TITLE=原名"])), (6, overflow.clone())]);
        let cover_start = 42 + 4 + comments(&["TITLE=原名"]).len();
        match case {
            "length-mismatch" => bytes[cover_start + 3] ^= 1,
            "truncated-image" => bytes.truncate(bytes.len() - audio().len() - 32),
            "bad-png-ending" => {
                let end = bytes.len() - audio().len();
                bytes[end - 8..end - 4].copy_from_slice(b"FAIL");
            }
            "bad-frame-crc" => {
                let start = bytes.len() - audio().len();
                bytes[start + 6] ^= 1;
            }
            "bad-audio-subframe" => {
                let start = bytes.len() - audio().len();
                bytes[start + 7] = 0xff;
            }
            "unsupported-overflow-picture" => bytes[cover_start + 4 + 41] = 0,
            "duplicate-comments" => {
                bytes = file_bytes(&[(4, comments(&["TITLE=A"])), (4, comments(&["TITLE=B"]))]);
            }
            "bad-comment-length" => bytes[46..50].copy_from_slice(&u32::MAX.to_le_bytes()),
            "missing-audio" => bytes.truncate(bytes.len() - audio().len()),
            _ => unreachable!(),
        }
        let fixture = Fixture::new(case, &bytes);
        let mut request = fixture.request();
        request.title = Some("新标题".into());
        assert!(write_tags(&request).is_err(), "{case}");
        assert_eq!(fs::read(&fixture.0).unwrap(), bytes, "{case}");
        fixture.assert_no_temporary_files();
    }
}

#[test]
fn no_original_comment_block_and_leading_id3_are_preserved() {
    let mut bytes = b"ID3\x04\0\0\0\0\0\0".to_vec();
    bytes.extend_from_slice(&file_bytes(&[(6, picture(false))]));
    let fixture = Fixture::new("leading-id3", &bytes);
    let mut request = fixture.request();
    request.title = Some("新标题".into());
    write_tags(&request).unwrap();
    let saved = fs::read(&fixture.0).unwrap();
    assert_eq!(&saved[..10], &bytes[..10]);
    assert!(saved.ends_with(&audio()));
    let tags = read_editor_tags(&request.path).unwrap();
    assert_eq!(tags.title.as_deref(), Some("新标题"));
    assert!(tags.has_cover);
    assert_decodes(&fixture.0);
}
