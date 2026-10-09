//! WAV 标签合并与流式重写，音频和非编辑块按原始字节保留。

use std::fs::{File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::Path;

use anyhow::{ensure, Context, Result};
use lofty::config::WriteOptions;
use lofty::file::{TaggedFile, TaggedFileExt};
use lofty::prelude::*;
use lofty::tag::{ItemKey, Tag, TagType};

const INFO_FIELDS: [(ItemKey, &[u8; 4]); 6] = [
    (ItemKey::TrackTitle, b"INAM"),
    (ItemKey::TrackArtist, b"IART"),
    (ItemKey::AlbumTitle, b"IPRD"),
    (ItemKey::Genre, b"IGNR"),
    (ItemKey::RecordingDate, b"ICRD"),
    (ItemKey::TrackNumber, b"IPRT"),
];

/// 将逻辑文件末尾限制在 RIFF 边界，避免尾部附加数据参与标签解析。
pub(super) struct RiffReader<R> {
    inner: R,
    header: [u8; 12],
    length: u64,
    limit: u64,
    position: u64,
}

impl<R: Read + Seek> RiffReader<R> {
    /// 校验 RIFF 头并记录容器与实际文件边界。
    pub(super) fn new(mut inner: R) -> Result<Self> {
        let length = inner.seek(SeekFrom::End(0))?;
        inner.rewind()?;
        let mut header = [0; 12];
        inner.read_exact(&mut header)?;
        ensure!(
            &header[..4] == b"RIFF" && &header[8..] == b"WAVE",
            "Only little-endian RIFF WAV files support tag editing"
        );
        let limit = u64::from(u32::from_le_bytes(header[4..8].try_into()?)) + 8;
        ensure!(limit >= 12 && limit <= length, "Invalid WAV RIFF size");
        inner.rewind()?;
        Ok(Self {
            inner,
            header,
            length,
            limit,
            position: 0,
        })
    }
}

impl<R: Read> Read for RiffReader<R> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let count = (self.limit - self.position).min(buffer.len() as u64) as usize;
        let read = self.inner.read(&mut buffer[..count])?;
        self.position += read as u64;
        Ok(read)
    }
}

impl<R: Seek> Seek for RiffReader<R> {
    fn stream_position(&mut self) -> io::Result<u64> {
        Ok(self.position)
    }

    fn seek(&mut self, from: SeekFrom) -> io::Result<u64> {
        let position = match from {
            SeekFrom::Start(position) => Some(position),
            SeekFrom::Current(offset) => self.position.checked_add_signed(offset),
            SeekFrom::End(offset) => self.limit.checked_add_signed(offset),
        }
        .filter(|position| *position <= self.limit)
        .ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidInput, "Seek outside WAV RIFF boundary")
        })?;
        self.inner.seek(SeekFrom::Start(position))?;
        self.position = position;
        Ok(position)
    }
}

/// ID3 优先，逐字段补齐 RIFF INFO，避免部分 ID3 标签遮蔽已有信息。
pub(super) fn merged_tag(tagged: &TaggedFile) -> Tag {
    let mut tag = tagged
        .tag(TagType::Id3v2)
        .cloned()
        .unwrap_or_else(|| Tag::new(TagType::Id3v2));
    if let Some(info) = tagged.tag(TagType::RiffInfo) {
        for item in info.items() {
            // 旧版 ID3 的 Year 与 RIFF 的 RecordingDate 表示同一个可编辑年份。
            if item.key() == ItemKey::RecordingDate && tag.get(ItemKey::Year).is_some() {
                continue;
            }
            if tag.get(item.key()).is_none() {
                tag.push(item.clone());
            }
        }
    }
    tag
}

/// 仅重建 ID3 和共同文本字段，原始 INFO 的其他子块保持字节不变。
pub(super) fn write(source: &Path, destination: &Path, tag: &Tag) -> Result<()> {
    let mut input = RiffReader::new(File::open(source).context("Failed to open WAV")?)?;
    let file_len = input.length;
    let riff_end = input.limit;

    let mut output = OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(destination)
        .context("Failed to open temporary WAV")?;
    output.write_all(&input.header)?;
    input.seek(SeekFrom::Start(12))?;

    let mut has_format = false;
    let mut has_audio = false;
    while input.stream_position()? < riff_end {
        let start = input.stream_position()?;
        ensure!(riff_end - start >= 8, "Truncated WAV chunk header");
        let mut chunk = [0; 8];
        input.read_exact(&mut chunk)?;
        let size = u64::from(u32::from_le_bytes(chunk[4..].try_into()?));
        let end = start + 8 + size + size % 2;
        ensure!(end <= riff_end, "WAV chunk exceeds RIFF boundary");

        match &chunk[..4] {
            b"id3 " | b"ID3 " => {
                input.seek(SeekFrom::Start(end))?;
            }
            b"LIST" => {
                ensure!(size >= 4, "Invalid WAV LIST chunk");
                let mut list_type = [0; 4];
                input.read_exact(&mut list_type)?;
                if &list_type == b"INFO" {
                    input.seek(SeekFrom::Start(end))?;
                } else {
                    input.seek(SeekFrom::Start(start))?;
                    let copied =
                        io::copy(&mut Read::by_ref(&mut input).take(end - start), &mut output)?;
                    ensure!(copied == end - start, "Truncated WAV LIST chunk");
                }
            }
            _ => {
                if &chunk[..4] == b"fmt " {
                    ensure!(size >= 16, "Invalid WAV format chunk");
                    has_format = true;
                }
                has_audio |= &chunk[..4] == b"data";
                input.seek(SeekFrom::Start(start))?;
                let copied = io::copy(&mut Read::by_ref(&mut input).take(end - start), &mut output)?;
                ensure!(copied == end - start, "Truncated WAV chunk");
            }
        }
    }
    ensure!(has_format && has_audio, "WAV is missing format or audio data");

    // INFO 读取器和 ID3 读取器均能看到一致的标题等字段。
    let mut info = Tag::new(TagType::RiffInfo);
    for (key, _) in INFO_FIELDS {
        let value = if key == ItemKey::RecordingDate {
            tag.get_string(ItemKey::Year)
                .or_else(|| tag.get_string(key))
        } else {
            tag.get_string(key)
        };
        if let Some(value) = value {
            info.insert_text(key, value.to_string());
        }
    }
    let mut info_bytes = Vec::new();
    info.dump_to(&mut info_bytes, WriteOptions::default())?;
    let info_start = output.stream_position()?;
    output.write_all(b"LIST\0\0\0\0INFO")?;
    if !info_bytes.is_empty() {
        output.write_all(&info_bytes[12..])?;
    }
    drop(info_bytes);

    // 再次扫描仅定位 INFO，合并成一个 LIST，兼容只读取首个 INFO 的软件。
    // 音频块通过 seek 跳过，未知 INFO 子块直接复制，无需缓存整份文件。
    input.seek(SeekFrom::Start(12))?;
    while input.stream_position()? < riff_end {
        let start = input.stream_position()?;
        ensure!(riff_end - start >= 8, "Truncated WAV chunk header");
        let mut chunk = [0; 8];
        input.read_exact(&mut chunk)?;
        let size = u64::from(u32::from_le_bytes(chunk[4..].try_into()?));
        let end = start + 8 + size + size % 2;
        ensure!(end <= riff_end, "WAV chunk exceeds RIFF boundary");
        if &chunk[..4] == b"LIST" {
            ensure!(size >= 4, "Invalid WAV LIST chunk");
            let mut list_type = [0; 4];
            input.read_exact(&mut list_type)?;
            if &list_type == b"INFO" {
                let list_end = start + 8 + size;
                while input.stream_position()? < list_end {
                    let item_start = input.stream_position()?;
                    ensure!(list_end - item_start >= 8, "Truncated WAV INFO header");
                    let mut item = [0; 8];
                    input.read_exact(&mut item)?;
                    let item_size = u64::from(u32::from_le_bytes(item[4..].try_into()?));
                    let item_end = item_start + 8 + item_size + item_size % 2;
                    ensure!(item_end <= list_end, "WAV INFO item exceeds LIST boundary");
                    let shared_field = INFO_FIELDS
                        .iter()
                        .any(|(_, id)| item[..4].eq_ignore_ascii_case(*id))
                        || item[..4].eq_ignore_ascii_case(b"ITRK");
                    if shared_field {
                        input.seek(SeekFrom::Start(item_end))?;
                    } else {
                        output.write_all(&item)?;
                        let count = item_size + item_size % 2;
                        let copied =
                            io::copy(&mut Read::by_ref(&mut input).take(count), &mut output)?;
                        ensure!(copied == count, "Truncated WAV INFO item");
                    }
                }
            }
        }
        input.seek(SeekFrom::Start(end))?;
    }
    let info_end = output.stream_position()?;
    if info_end == info_start + 12 {
        output.set_len(info_start)?;
        output.seek(SeekFrom::Start(info_start))?;
    } else {
        let list_size = u32::try_from(info_end - info_start - 8)?;
        output.seek(SeekFrom::Start(info_start + 4))?;
        output.write_all(&list_size.to_le_bytes())?;
        output.seek(SeekFrom::Start(info_end))?;
    }

    let mut id3 = Vec::new();
    tag.dump_to(&mut id3, WriteOptions::default())?;
    if !id3.is_empty() {
        let size = u32::try_from(id3.len()).context("WAV ID3 tag exceeds RIFF size limit")?;
        output.write_all(b"id3 ")?;
        output.write_all(&size.to_le_bytes())?;
        output.write_all(&id3)?;
        if size % 2 != 0 {
            output.write_all(&[0])?;
        }
    }
    drop(id3);

    let output_end = output.stream_position()?;
    let riff_size = u32::try_from(output_end - 8).context("Edited WAV exceeds RIFF size limit")?;
    // RIFF 边界以外的数据也保留，不把附加内容算入 RIFF 长度。
    let copied = io::copy(&mut input.inner, &mut output)?;
    ensure!(copied == file_len - riff_end, "WAV changed during tag editing");
    output.seek(SeekFrom::Start(4))?;
    output.write_all(&riff_size.to_le_bytes())?;
    Ok(())
}
