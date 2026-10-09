//! WAV 标签兼容性与文件字节保留的回归测试。

use super::tests::temp_wav;
use super::*;
use std::io::{Read, Seek, SeekFrom, Write};

/// 追加 RIFF 块，非零填充用于检测奇数长度块的字节保留。
fn append_wav_chunk(path: &Path, id: &[u8; 4], payload: &[u8]) {
    let mut bytes = fs::read(path).unwrap();
    let mut chunk = Vec::new();
    chunk.extend_from_slice(id);
    chunk.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    chunk.extend_from_slice(payload);
    if payload.len() % 2 != 0 {
        chunk.push(0xa5);
    }
    let riff_size = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
    let end = riff_size as usize + 8;
    bytes[4..8].copy_from_slice(&(riff_size + chunk.len() as u32).to_le_bytes());
    bytes.splice(end..end, chunk);
    fs::write(path, bytes).unwrap();
}

/// 构造含别名或未知字段的原始 INFO，不依赖待验证的写入逻辑。
fn append_riff_info(path: &Path, fields: &[(&[u8; 4], &str)]) {
    let mut info = b"INFO".to_vec();
    for (key, value) in fields {
        info.extend_from_slice(*key);
        let size = value.len() as u32 + 1;
        info.extend_from_slice(&size.to_le_bytes());
        info.extend_from_slice(value.as_bytes());
        info.push(0);
        if size % 2 != 0 {
            info.push(0);
        }
    }
    append_wav_chunk(path, b"LIST", &info);
}

/// 读取完整原始块，包含块头与填充，不解析或归一化其内容。
fn wav_chunks(path: &Path) -> Vec<Vec<u8>> {
    let bytes = fs::read(path).unwrap();
    let end = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize + 8;
    assert!(end <= bytes.len());
    let mut chunks = Vec::new();
    let mut offset = 12;
    while offset < end {
        let size = u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap()) as usize;
        let next = offset + 8 + size + size % 2;
        assert!(next <= end);
        chunks.push(bytes[offset..next].to_vec());
        offset = next;
    }
    assert_eq!(offset, end);
    chunks
}

#[test]
fn wav_riff_only_partial_edit_preserves_other_fields() {
    let path = temp_wav("riff-only.wav");
    append_riff_info(
        &path,
        &[
            (b"INAM", "原标题"),
            (b"IART", "原歌手"),
            (b"IPRD", "原专辑"),
            (b"IGNR", "Jazz"),
            (b"ICRD", "2020-08-12"),
            (b"ITRK", "7"),
            (b"ICMT", "原始注释"),
            (b"IZZZ", "自定义字段"),
        ],
    );
    let before = wav_chunks(&path);
    let custom_start = before[2].windows(4).position(|v| v == b"IZZZ").unwrap();
    let custom = &before[2][custom_start..];
    assert!(open_tagged(&path).unwrap().tag(TagType::Id3v2).is_none());
    let request = TagWriteRequest {
        path: path.to_string_lossy().into_owned(),
        title: Some("新标题 🎵".into()),
        ..Default::default()
    };
    write_tags(&request).unwrap();
    let tags = read_tags(&request.path).unwrap();
    assert_eq!(tags.title.as_deref(), Some("新标题 🎵"));
    assert_eq!(tags.artist.as_deref(), Some("原歌手"));
    assert_eq!(tags.album.as_deref(), Some("原专辑"));
    assert_eq!(tags.genre.as_deref(), Some("Jazz"));
    assert_eq!(tags.year, Some(2020));
    assert_eq!(tags.track_number, Some(7));
    let saved = open_tagged(&path).unwrap();
    let info = saved.tag(TagType::RiffInfo).unwrap();
    assert_eq!(info.title().as_deref(), Some("新标题 🎵"));
    assert_eq!(info.artist().as_deref(), Some("原歌手"));
    assert_eq!(info.get_string(ItemKey::RecordingDate), Some("2020-08-12"));
    assert_eq!(info.get_string(ItemKey::Comment), Some("原始注释"));
    let after = wav_chunks(&path);
    assert!(after.contains(&before[0]));
    assert!(after.contains(&before[1]));
    assert_eq!(
        after
            .iter()
            .filter(|v| &v[..4] == b"LIST" && &v[8..12] == b"INFO")
            .count(),
        1
    );
    let bytes = fs::read(&path).unwrap();
    assert!(bytes.windows(custom.len()).any(|v| v == custom));
}

#[test]
fn wav_partial_id3_uses_riff_fallback_and_synchronizes_conflicts() {
    let path = temp_wav("mixed-tags.wav");
    append_riff_info(
        &path,
        &[
            (b"INAM", "RIFF 标题"),
            (b"IART", "RIFF 歌手"),
            (b"IPRD", "RIFF 专辑"),
        ],
    );
    let mut id3 = Tag::new(TagType::Id3v2);
    id3.set_title("ID3 标题".into());
    id3.insert_text(ItemKey::UnsyncLyrics, "原歌词".into());
    let mut bytes = Vec::new();
    id3.dump_to(&mut bytes, WriteOptions::default()).unwrap();
    append_wav_chunk(&path, b"ID3 ", &bytes);

    let request = TagWriteRequest {
        path: path.to_string_lossy().into_owned(),
        lyrics: Some("新歌词".into()),
        ..Default::default()
    };
    let initial = read_tags(&request.path).unwrap();
    assert_eq!(initial.title.as_deref(), Some("ID3 标题"));
    assert_eq!(initial.artist.as_deref(), Some("RIFF 歌手"));
    write_tags(&request).unwrap();
    let tags = read_tags(&request.path).unwrap();
    assert_eq!(tags.title, initial.title);
    assert_eq!(tags.artist, initial.artist);
    assert_eq!(tags.album, initial.album);
    assert_eq!(tags.lyrics.as_deref(), Some("新歌词"));
    let saved = open_tagged(&path).unwrap();
    assert_eq!(
        saved.tag(TagType::RiffInfo).unwrap().title().as_deref(),
        Some("ID3 标题")
    );
    assert_eq!(
        saved.tag(TagType::Id3v2).unwrap().artist().as_deref(),
        Some("RIFF 歌手")
    );
}

#[test]
fn wav_combines_info_lists_without_losing_unknown_fields() {
    let path = temp_wav("multiple-info.wav");
    append_riff_info(&path, &[(b"INAM", "原标题"), (b"IZZA", "第一个自定义值")]);
    append_riff_info(&path, &[(b"IART", "歌手"), (b"IZZB", "第二个自定义值")]);
    let before = wav_chunks(&path);
    write_tags(&TagWriteRequest {
        path: path.to_string_lossy().into_owned(),
        title: Some("新标题".into()),
        ..Default::default()
    })
    .unwrap();
    let after = wav_chunks(&path);
    let info: Vec<_> = after
        .iter()
        .filter(|chunk| &chunk[..4] == b"LIST" && &chunk[8..12] == b"INFO")
        .collect();
    assert_eq!(info.len(), 1);
    for (chunk, key) in [(&before[2], b"IZZA"), (&before[3], b"IZZB")] {
        let start = chunk.windows(4).position(|v| v == key).unwrap();
        let raw = &chunk[start..];
        assert!(info[0].windows(raw.len()).any(|v| v == raw));
    }
    let saved = open_tagged(&path).unwrap();
    let info_tag = saved.tag(TagType::RiffInfo).unwrap();
    assert_eq!(info_tag.title().as_deref(), Some("新标题"));
    assert_eq!(info_tag.artist().as_deref(), Some("歌手"));
}

#[test]
fn wav_clear_removes_riff_values_and_track_aliases_permanently() {
    let path = temp_wav("clear-riff.wav");
    for _ in 0..2 {
        append_riff_info(
            &path,
            &[
                (b"INAM", "标题"),
                (b"IART", "歌手"),
                (b"IPRD", "专辑"),
                (b"IGNR", "Rock"),
                (b"ICRD", "1999"),
                (b"IPRT", "4"),
                (b"ITRK", "4"),
            ],
        );
    }
    let clear = TagWriteRequest {
        path: path.to_string_lossy().into_owned(),
        title: Some(String::new()),
        artist: Some(String::new()),
        album: Some(String::new()),
        genre: Some(String::new()),
        year: Some(0),
        track_number: Some(0),
        ..Default::default()
    };
    write_tags(&clear).unwrap();
    assert_eq!(read_tags(&clear.path).unwrap(), TrackTags::default());
    let next = TagWriteRequest {
        path: clear.path.clone(),
        lyrics: Some("歌词".into()),
        ..Default::default()
    };
    write_tags(&next).unwrap();
    assert_eq!(
        read_tags(&clear.path).unwrap(),
        TrackTags {
            lyrics: Some("歌词".into()),
            ..Default::default()
        }
    );
    assert!(wav_chunks(&path).iter().all(|chunk| &chunk[..4] != b"LIST"));
}

#[test]
fn wav_edits_preserve_pcm_float_extensible_and_ancillary_chunks() {
    let trailer = b"trailing data\0\xff outside RIFF";
    for format in [1u16, 3, 0xfffe] {
        let path = temp_wav(&format!("preserve-chunks-{format}.wav"));
        let mut bytes = fs::read(&path).unwrap();
        bytes[20..22].copy_from_slice(&format.to_le_bytes());
        if format != 1 {
            bytes[28..32].copy_from_slice(&(48000u32 * 8).to_le_bytes());
            bytes[32..34].copy_from_slice(&8u16.to_le_bytes());
            bytes[34..36].copy_from_slice(&32u16.to_le_bytes());
        }
        if format == 0xfffe {
            let extension = [
                22, 0, 24, 0, 3, 0, 0, 0, 1, 0, 0, 0, 0, 0, 16, 0, 128, 0, 0, 170, 0, 56, 155,
                113,
            ];
            bytes.splice(36..36, extension);
            bytes[16..20].copy_from_slice(&40u32.to_le_bytes());
            let riff_size = bytes.len() as u32 - 8;
            bytes[4..8].copy_from_slice(&riff_size.to_le_bytes());
        }
        fs::write(&path, bytes).unwrap();
        for (id, payload) in [
            (b"bext", &b"broadcast metadata"[..]),
            (b"JUNK", &b"odd"[..]),
            (b"axml", &b"<metadata/>"[..]),
            (b"LIST", &b"adtl\0\0\0\0"[..]),
            (b"fact", &4800u32.to_le_bytes()[..]),
        ] {
            append_wav_chunk(&path, id, payload);
        }
        let before = wav_chunks(&path);
        fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap()
            .write_all(trailer)
            .unwrap();
        let mut request = TagWriteRequest {
            path: path.to_string_lossy().into_owned(),
            title: Some("较长的新标题".repeat(20)),
            ..Default::default()
        };
        for title in ["较长的新标题".repeat(20), "短".into(), String::new()] {
            request.title = Some(title);
            write_tags(&request).unwrap();
            let after: Vec<_> = wav_chunks(&path)
                .into_iter()
                .filter(|chunk| {
                    &chunk[..4] != b"id3 "
                        && !(&chunk[..4] == b"LIST" && &chunk[8..12] == b"INFO")
                })
                .collect();
            assert_eq!(after, before);
            assert!(fs::read(&path).unwrap().ends_with(trailer));
        }
    }
}

#[test]
fn wav_tags_ignore_tag_shaped_data_outside_riff() {
    let path = temp_wav("outside-riff-tags.wav");
    let initial = TagWriteRequest {
        path: path.to_string_lossy().into_owned(),
        title: Some("容器内标题".into()),
        ..Default::default()
    };
    write_tags(&initial).unwrap();
    let mut external_tag = Tag::new(TagType::Id3v2);
    external_tag.set_title("容器外标题".into());
    let mut id3 = Vec::new();
    external_tag
        .dump_to(&mut id3, WriteOptions::default())
        .unwrap();
    let mut trailer = b"id3 ".to_vec();
    trailer.extend_from_slice(&(id3.len() as u32).to_le_bytes());
    trailer.extend_from_slice(&id3);
    if id3.len() % 2 != 0 {
        trailer.push(0);
    }
    fs::OpenOptions::new()
        .append(true)
        .open(&path)
        .unwrap()
        .write_all(&trailer)
        .unwrap();
    assert_eq!(
        read_tags(&initial.path).unwrap().title.as_deref(),
        Some("容器内标题")
    );
    let update = TagWriteRequest {
        path: initial.path,
        artist: Some("新歌手".into()),
        ..Default::default()
    };
    write_tags(&update).unwrap();
    let tags = read_tags(&update.path).unwrap();
    assert_eq!(tags.title.as_deref(), Some("容器内标题"));
    assert_eq!(tags.artist.as_deref(), Some("新歌手"));
    assert!(fs::read(&path).unwrap().ends_with(&trailer));
}

#[test]
fn wav_reader_limits_reads_and_seeks_to_riff() {
    let path = temp_wav("bounded-reader.wav");
    let original = fs::read(&path).unwrap();
    fs::OpenOptions::new()
        .append(true)
        .open(&path)
        .unwrap()
        .write_all(b"outside RIFF")
        .unwrap();
    let mut reader = super::super::wav::RiffReader::new(fs::File::open(&path).unwrap()).unwrap();
    assert_eq!(reader.seek(SeekFrom::End(0)).unwrap(), original.len() as u64);
    assert!(reader.seek(SeekFrom::End(1)).is_err());
    assert!(reader.seek(SeekFrom::Current(1)).is_err());
    assert!(reader.seek(SeekFrom::Start(original.len() as u64 + 1)).is_err());
    assert_eq!(reader.stream_position().unwrap(), original.len() as u64);
    assert_eq!(reader.read(&mut [0; 8]).unwrap(), 0);
    reader.rewind().unwrap();
    let mut content = Vec::new();
    reader.read_to_end(&mut content).unwrap();
    assert_eq!(content, original);
}

#[test]
fn malformed_wav_edits_leave_original_bytes_intact() {
    for case in [
        "oversized-riff",
        "short-riff",
        "truncated-chunk",
        "truncated-info",
        "RF64",
        "RIFX",
        "BW64",
    ] {
        let path = temp_wav(&format!("malformed-{case}.wav"));
        if case == "truncated-info" {
            append_riff_info(&path, &[(b"INAM", "标题")]);
        }
        let mut bytes = fs::read(&path).unwrap();
        match case {
            "oversized-riff" => bytes[4..8].copy_from_slice(&u32::MAX.to_le_bytes()),
            "short-riff" => bytes[4..8].copy_from_slice(&4u32.to_le_bytes()),
            "truncated-chunk" => bytes[40..44].copy_from_slice(&u32::MAX.to_le_bytes()),
            "truncated-info" => {
                let start = bytes.windows(4).rposition(|v| v == b"LIST").unwrap();
                bytes[start + 16..start + 20].copy_from_slice(&u32::MAX.to_le_bytes());
            }
            other => bytes[..4].copy_from_slice(other.as_bytes()),
        }
        fs::write(&path, &bytes).unwrap();
        let request = TagWriteRequest {
            path: path.to_string_lossy().into_owned(),
            title: Some("新标题".into()),
            ..Default::default()
        };
        assert!(write_tags(&request).is_err());
        assert_eq!(fs::read(&path).unwrap(), bytes);
    }
}

#[test]
fn concurrent_wav_edits_keep_both_changes() {
    let path = temp_wav("concurrent-edits.wav");
    let path_string = path.to_string_lossy().into_owned();
    let requests = [
        TagWriteRequest {
            path: path_string.clone(),
            title: Some("标题".into()),
            ..Default::default()
        },
        TagWriteRequest {
            path: path_string.clone(),
            artist: Some("歌手".into()),
            ..Default::default()
        },
    ];
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let handles = requests.map(|request| {
        let barrier = barrier.clone();
        std::thread::spawn(move || {
            barrier.wait();
            write_tags(&request)
        })
    });
    for handle in handles {
        handle.join().unwrap().unwrap();
    }
    let tags = read_tags(&path_string).unwrap();
    assert_eq!(tags.title.as_deref(), Some("标题"));
    assert_eq!(tags.artist.as_deref(), Some("歌手"));
}

#[test]
fn wav_preserves_unedited_cover_and_private_id3_frame() {
    let path = temp_wav("preserve-private-frame.wav");
    let cover = vec![0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4];
    let initial = TagWriteRequest {
        path: path.to_string_lossy().into_owned(),
        cover: Some(cover.clone()),
        ..Default::default()
    };
    write_tags(&initial).unwrap();
    let frame = b"PRIV\0\0\0\x09\0\0owner\0\x01\x02\x03";
    let mut id3 = b"ID3\x04\0\0\0\0\0\x13".to_vec();
    id3.extend_from_slice(frame);
    append_wav_chunk(&path, b"ID3 ", &id3);
    let update = TagWriteRequest {
        path: initial.path,
        artist: Some("新歌手".into()),
        ..Default::default()
    };
    write_tags(&update).unwrap();
    let saved = open_tagged(&path).unwrap();
    let pictures = saved.tag(TagType::Id3v2).unwrap().pictures();
    assert_eq!(pictures.len(), 1);
    assert_eq!(pictures[0].data(), cover);
    let chunks = wav_chunks(&path);
    let id3_chunks: Vec<_> = chunks
        .iter()
        .filter(|chunk| &chunk[..4] == b"id3 ")
        .collect();
    assert_eq!(id3_chunks.len(), 1);
    assert!(id3_chunks[0].windows(frame.len()).any(|v| v == frame));
}

#[test]
fn read_only_wav_is_not_replaced() {
    let path = temp_wav("read-only.wav");
    let bytes = fs::read(&path).unwrap();
    let permissions = fs::metadata(&path).unwrap().permissions();
    let mut read_only = permissions.clone();
    read_only.set_readonly(true);
    fs::set_permissions(&path, read_only).unwrap();
    let result = write_tags(&TagWriteRequest {
        path: path.to_string_lossy().into_owned(),
        title: Some("新标题".into()),
        ..Default::default()
    });
    fs::set_permissions(&path, permissions).unwrap();
    assert!(result.is_err());
    assert_eq!(fs::read(&path).unwrap(), bytes);
}

#[cfg(windows)]
#[test]
fn locked_wav_failure_keeps_original_and_cleans_temporary_file() {
    use std::os::windows::fs::OpenOptionsExt;

    let path = temp_wav("locked.wav");
    let bytes = fs::read(&path).unwrap();
    // 允许读取但禁止替换，模拟其他软件持有音频文件。
    let lock = fs::OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(&path)
        .unwrap();
    let result = write_tags(&TagWriteRequest {
        path: path.to_string_lossy().into_owned(),
        title: Some("新标题".into()),
        ..Default::default()
    });
    drop(lock);
    assert!(result.is_err());
    assert_eq!(fs::read(&path).unwrap(), bytes);
    assert!(!fs::read_dir(path.parent().unwrap())
        .unwrap()
        .any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with("locked.wav.")
        }));
}
