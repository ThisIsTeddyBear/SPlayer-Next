//! FLAC 文本标签流式重写，兼容旧封面块的 24 位长度溢出。

use std::fs::{File, OpenOptions};
use std::io::{self, Cursor, Read, Seek, SeekFrom, Write};
use std::path::Path;

use anyhow::{ensure, Context, Result};
use lofty::config::{ParseOptions, ParsingMode};
use lofty::file::{FileType, TaggedFile, TaggedFileExt};
use lofty::picture::{Picture, PictureInformation, PictureType};
use lofty::probe::Probe;
use lofty::tag::{ItemKey, TagType};

use super::editor::{tags_from_tag, TagWriteRequest, TrackTags};

const MAX_BLOCK_SIZE: u64 = 0x00ff_ffff;
// 与 FFmpeg 的旧封面长度修复上限一致，避免接受任意超大偏移。
const MAX_OVERFLOW_PICTURE_SIZE: u64 = 500 * 1024 * 1024;

struct Block {
    start: u64,
    header: [u8; 4],
    size: u64,
}

impl Block {
    fn kind(&self) -> u8 {
        self.header[0] & 0x7f
    }
}

#[derive(Default, PartialEq, Debug)]
struct Comments {
    vendor: Vec<u8>,
    entries: Vec<Vec<u8>>,
}

impl Comments {
    fn read(bytes: &[u8]) -> Result<Self> {
        let mut remaining = bytes;
        let vendor = read_string(&mut remaining)?;
        ensure!(remaining.len() >= 4, "Truncated FLAC comment count");
        let count = u32::from_le_bytes(remaining[..4].try_into()?);
        remaining = &remaining[4..];
        ensure!(
            u64::from(count) <= remaining.len() as u64 / 4,
            "Invalid FLAC comment count"
        );
        let mut entries = Vec::new();
        for _ in 0..count {
            let entry = read_string(&mut remaining)?;
            let separator = entry
                .iter()
                .position(|byte| *byte == b'=')
                .context("FLAC comment has no separator")?;
            ensure!(
                separator > 0
                    && entry[..separator]
                        .iter()
                        .all(|byte| (0x20..=0x7d).contains(byte)),
                "Invalid FLAC comment key"
            );
            entries.push(entry);
        }
        ensure!(remaining.is_empty(), "Unexpected bytes after FLAC comments");
        Ok(Self { vendor, entries })
    }

    fn encode(&self) -> Result<Vec<u8>> {
        let size = 8u64
            + self.vendor.len() as u64
            + self
                .entries
                .iter()
                .map(|entry| 4 + entry.len() as u64)
                .sum::<u64>();
        ensure!(
            size <= MAX_BLOCK_SIZE,
            "FLAC text metadata exceeds the 24-bit block size limit"
        );
        let mut bytes = Vec::with_capacity(size as usize);
        bytes.extend_from_slice(&u32::try_from(self.vendor.len())?.to_le_bytes());
        bytes.extend_from_slice(&self.vendor);
        bytes.extend_from_slice(&u32::try_from(self.entries.len())?.to_le_bytes());
        for entry in &self.entries {
            bytes.extend_from_slice(&u32::try_from(entry.len())?.to_le_bytes());
            bytes.extend_from_slice(entry);
        }
        Ok(bytes)
    }

    fn key(entry: &[u8]) -> &[u8] {
        let end = entry
            .iter()
            .position(|byte| *byte == b'=')
            .unwrap_or(entry.len());
        &entry[..end]
    }

    fn set(&mut self, keys: &[&str], value: &Option<String>) {
        let Some(value) = value else {
            return;
        };
        self.entries.retain(|entry| {
            !keys
                .iter()
                .any(|key| Self::key(entry).eq_ignore_ascii_case(key.as_bytes()))
        });
        if !value.is_empty() {
            self.entries.push(format!("{}={value}", keys[0]).into_bytes());
        }
    }

    fn set_number(&mut self, key: &str, totals: &[&str], value: Option<u32>) {
        let Some(value) = value else {
            return;
        };
        // 编辑 current/total 中的当前序号时，总数仍是未修改字段。
        if !self.entries.iter().any(|entry| {
            totals
                .iter()
                .any(|total| Self::key(entry).eq_ignore_ascii_case(total.as_bytes()))
        }) {
            let total = self
                .entries
                .iter()
                .find(|entry| Self::key(entry).eq_ignore_ascii_case(key.as_bytes()))
                .and_then(|entry| std::str::from_utf8(entry).ok())
                .and_then(|entry| entry.split_once('/'))
                .and_then(|(_, total)| total.parse::<u32>().ok());
            if let Some(total) = total {
                self.set(totals, &Some(total.to_string()));
            }
        }
        self.set(
            &[key],
            &Some(if value == 0 {
                String::new()
            } else {
                value.to_string()
            }),
        );
    }

    fn apply(&mut self, request: &TagWriteRequest) {
        self.set(&["TITLE"], &request.title);
        self.set(&["ARTIST"], &request.artist);
        self.set(&["ALBUM"], &request.album);
        self.set(&["ALBUMARTIST", "ALBUM ARTIST"], &request.album_artist);
        self.set(&["GENRE"], &request.genre);
        if let Some(year) = request.year {
            self.set(
                &["DATE", "YEAR"],
                &Some(if year == 0 {
                    String::new()
                } else {
                    year.to_string()
                }),
            );
        }
        self.set_number(
            "TRACKNUMBER",
            &["TRACKTOTAL", "TOTALTRACKS"],
            request.track_number,
        );
        self.set_number(
            "DISCNUMBER",
            &["DISCTOTAL", "TOTALDISCS"],
            request.disc_number,
        );
        if let Some(lyrics) = &request.lyrics {
            self.entries.retain(|entry| {
                let key = String::from_utf8_lossy(Self::key(entry));
                if ItemKey::from_key(TagType::VorbisComments, &key)
                    .is_some_and(|key| key != ItemKey::Lyrics && key != ItemKey::UnsyncLyrics)
                {
                    return true;
                }
                let normalized = super::tag_fields::normalize_tag_key(&key);
                normalized.starts_with("lyricist")
                    || !super::tag_fields::is_lyric_field_key(&normalized)
            });
            self.set(&["UNSYNCEDLYRICS"], &Some(lyrics.clone()));
        }
        if request.cover.is_some() {
            self.set(
                &["METADATA_BLOCK_PICTURE", "COVERART", "COVERARTMIME"],
                &Some(String::new()),
            );
        }
    }

    fn has_cover(&self) -> bool {
        self.entries.iter().any(|entry| {
            let key = Self::key(entry);
            (key.eq_ignore_ascii_case(b"METADATA_BLOCK_PICTURE")
                || key.eq_ignore_ascii_case(b"COVERART"))
                && entry.len() > key.len() + 1
        })
    }
}

fn read_string(bytes: &mut &[u8]) -> Result<Vec<u8>> {
    ensure!(bytes.len() >= 4, "Truncated FLAC string length");
    let size = u32::from_le_bytes(bytes[..4].try_into()?) as usize;
    *bytes = &bytes[4..];
    ensure!(size <= bytes.len(), "FLAC string exceeds comment boundary");
    std::str::from_utf8(&bytes[..size]).context("FLAC comments must be UTF-8")?;
    let value = bytes[..size].to_vec();
    *bytes = &bytes[size..];
    Ok(value)
}

struct Layout {
    marker: u64,
    blocks: Vec<Block>,
    comments: Comments,
    audio_start: u64,
    length: u64,
}

impl Layout {
    fn read(file: &mut File) -> Result<Self> {
        let length = file.metadata()?.len();
        file.rewind()?;
        let mut signature = [0; 4];
        file.read_exact(&mut signature)?;
        let mut marker = 0;
        if &signature[..3] == b"ID3" {
            let mut header = [0; 10];
            file.rewind()?;
            file.read_exact(&mut header)?;
            ensure!(
                (2..=4).contains(&header[3])
                    && header[6..].iter().all(|byte| byte & 0x80 == 0),
                "Invalid leading ID3 header"
            );
            marker = 10
                + header[6..]
                    .iter()
                    .fold(0u64, |size, byte| (size << 7) | u64::from(*byte));
            if header[3] == 4 && header[5] & 0x10 != 0 {
                marker += 10;
            }
            ensure!(marker + 4 <= length, "Leading ID3 tag exceeds file boundary");
            file.seek(SeekFrom::Start(marker))?;
            file.read_exact(&mut signature)?;
        }
        ensure!(&signature == b"fLaC", "Missing FLAC stream marker");
        let mut blocks = Vec::new();
        let mut comments = None;
        loop {
            let start = file.stream_position()?;
            ensure!(start + 4 <= length, "Truncated FLAC metadata header");
            let mut header = [0; 4];
            file.read_exact(&mut header)?;
            let kind = header[0] & 0x7f;
            let mut size = u64::from(u32::from_be_bytes([0, header[1], header[2], header[3]]));
            ensure!(kind != 127 && start + 4 + size <= length, "Invalid FLAC metadata block");
            if blocks.is_empty() {
                ensure!(
                    kind == 0 && size == 34,
                    "FLAC requires a 34-byte STREAMINFO first"
                );
            } else {
                ensure!(kind != 0, "Duplicate FLAC STREAMINFO block");
            }
            if kind == 4 {
                ensure!(
                    comments.is_none(),
                    "Duplicate FLAC comment blocks cannot be edited safely"
                );
                let mut bytes = vec![0; size as usize];
                file.read_exact(&mut bytes)?;
                comments = Some(Comments::read(&bytes)?);
            } else if kind == 6 {
                size = picture_size(file, start + 4, size, length)?;
            }
            file.seek(SeekFrom::Start(start + 4 + size))?;
            blocks.push(Block {
                start,
                header,
                size,
            });
            if header[0] & 0x80 != 0 {
                break;
            }
        }
        let audio_start = file.stream_position()?;
        validate_audio_start(file)?;
        Ok(Self {
            marker,
            blocks,
            comments: comments.unwrap_or_default(),
            audio_start,
            length,
        })
    }

    fn has_cover(&self) -> bool {
        self.blocks.iter().any(|block| block.kind() == 6) || self.comments.has_cover()
    }

    fn tagged(&self, file: &mut File) -> Result<TaggedFile> {
        // 只把文本和 STREAMINFO 交给 lofty，避免其丢弃溢出的图片或误读后续块。
        let mut bytes = Vec::new();
        copy_range(file, &mut bytes, 0, self.marker + 4)?;
        let stream = &self.blocks[0];
        let has_comments = self.blocks.iter().any(|block| block.kind() == 4);
        bytes.extend_from_slice(&[if has_comments { 0 } else { 0x80 }, 0, 0, 34]);
        copy_range(file, &mut bytes, stream.start + 4, 34)?;
        if has_comments {
            let comments = self.comments.encode()?;
            write_header(&mut bytes, 0x84, comments.len() as u64)?;
            bytes.extend_from_slice(&comments);
        }
        Probe::new(Cursor::new(bytes))
            .set_file_type(FileType::Flac)
            .options(
                ParseOptions::new()
                    .read_properties(false)
                    .read_cover_art(false)
                    .parsing_mode(ParsingMode::Strict),
            )
            .read()
            .context("Failed to parse FLAC text metadata")
    }
}

fn read_be_u32(file: &mut File) -> Result<u32> {
    let mut bytes = [0; 4];
    file.read_exact(&mut bytes)?;
    Ok(u32::from_be_bytes(bytes))
}

fn picture_size(file: &mut File, start: u64, declared: u64, length: u64) -> Result<u64> {
    let end = start + declared;
    ensure!(declared >= 32, "FLAC picture header is truncated");
    file.seek(SeekFrom::Start(start + 4))?;
    let mime = u64::from(read_be_u32(file)?);
    ensure!(
        mime + 24 <= end - file.stream_position()?,
        "FLAC picture MIME exceeds its block"
    );
    file.seek(SeekFrom::Current(mime as i64))?;
    let description = u64::from(read_be_u32(file)?);
    ensure!(
        description + 20 <= end - file.stream_position()?,
        "FLAC picture description exceeds its block"
    );
    file.seek(SeekFrom::Current(description as i64 + 16))?;
    let image_length = u64::from(read_be_u32(file)?);
    let image_start = file.stream_position()?;
    let remaining = end - image_start;
    if image_length == remaining {
        return Ok(declared);
    }
    ensure!(
        image_length > remaining
            && image_length & MAX_BLOCK_SIZE == remaining
            && image_length <= MAX_OVERFLOW_PICTURE_SIZE
            && image_start + image_length <= length,
        "FLAC picture length mismatch cannot be recovered safely"
    );
    // 仅恢复完整 PNG 的已知溢出，不能把任意残留字节当作封面。
    validate_overflow_png(file, image_start, image_length)?;
    Ok(image_start - start + image_length)
}

fn validate_overflow_png(file: &mut File, start: u64, size: u64) -> Result<()> {
    file.seek(SeekFrom::Start(start))?;
    let end = start + size;
    let mut signature = [0; 8];
    file.read_exact(&mut signature)?;
    ensure!(
        &signature == b"\x89PNG\r\n\x1a\n",
        "Only verified PNG picture overflows can be edited"
    );
    let mut first = true;
    let mut has_data = false;
    loop {
        let position = file.stream_position()?;
        ensure!(position + 12 <= end, "Truncated overflow PNG chunk");
        let chunk_size = u64::from(read_be_u32(file)?);
        let mut kind = [0; 4];
        file.read_exact(&mut kind)?;
        let next = position + 12 + chunk_size;
        ensure!(next <= end, "Overflow PNG chunk exceeds image boundary");
        if first {
            ensure!(
                &kind == b"IHDR" && chunk_size == 13,
                "Invalid overflow PNG header"
            );
            let width = read_be_u32(file)?;
            let height = read_be_u32(file)?;
            ensure!(width > 0 && height > 0, "Invalid overflow PNG dimensions");
            first = false;
        } else {
            ensure!(&kind != b"IHDR", "Duplicate overflow PNG header");
        }
        has_data |= &kind == b"IDAT";
        file.seek(SeekFrom::Start(next))?;
        if &kind == b"IEND" {
            ensure!(
                chunk_size == 0 && next == end && has_data,
                "Invalid overflow PNG ending"
            );
            return Ok(());
        }
    }
}

fn validate_audio_start(file: &mut File) -> Result<()> {
    let mut header = [0; 4];
    file.read_exact(&mut header)
        .context("FLAC has no complete audio frame")?;
    let block_code = header[2] >> 4;
    let rate_code = header[2] & 0xf;
    ensure!(
        header[0] == 0xff
            && header[1] & 0xfe == 0xf8
            && block_code != 0
            && rate_code != 15
            && header[3] >> 4 <= 10
            && (header[3] >> 1) & 7 != 3
            && header[3] & 1 == 0,
        "FLAC audio does not start at a valid frame boundary"
    );
    let mut bytes = header.to_vec();
    let mut byte = [0; 1];
    file.read_exact(&mut byte)?;
    bytes.push(byte[0]);
    let count = byte[0].leading_ones();
    ensure!(count == 0 || (2..=7).contains(&count), "Invalid FLAC frame number");
    for _ in 1..count {
        file.read_exact(&mut byte)?;
        ensure!(byte[0] & 0xc0 == 0x80, "Invalid FLAC frame number continuation");
        bytes.push(byte[0]);
    }
    let extra = match block_code {
        6 => 1,
        7 => 2,
        _ => 0,
    } + match rate_code {
        12 => 1,
        13 | 14 => 2,
        _ => 0,
    };
    for _ in 0..=extra {
        file.read_exact(&mut byte)?;
        bytes.push(byte[0]);
    }
    let mut crc = 0u8;
    for byte in bytes {
        crc ^= byte;
        for _ in 0..8 {
            crc = if crc & 0x80 != 0 {
                (crc << 1) ^ 7
            } else {
                crc << 1
            };
        }
    }
    ensure!(crc == 0, "FLAC frame header checksum failed");
    Ok(())
}

fn write_header(output: &mut impl Write, kind: u8, size: u64) -> Result<()> {
    ensure!(
        size <= MAX_BLOCK_SIZE,
        "FLAC metadata exceeds the 24-bit block size limit"
    );
    output.write_all(&[kind, (size >> 16) as u8, (size >> 8) as u8, size as u8])?;
    Ok(())
}

fn copy_range(input: &mut File, output: &mut impl Write, start: u64, size: u64) -> Result<()> {
    input.seek(SeekFrom::Start(start))?;
    let count = io::copy(&mut Read::by_ref(input).take(size), output)?;
    ensure!(count == size, "FLAC changed or was truncated during tag editing");
    Ok(())
}

fn compare_range(
    left: &mut File,
    left_start: u64,
    right: &mut File,
    right_start: u64,
    size: u64,
) -> Result<()> {
    left.seek(SeekFrom::Start(left_start))?;
    right.seek(SeekFrom::Start(right_start))?;
    let mut a = [0; 16 * 1024];
    let mut b = [0; 16 * 1024];
    let mut remaining = size;
    while remaining > 0 {
        let count = remaining.min(a.len() as u64) as usize;
        left.read_exact(&mut a[..count])?;
        right.read_exact(&mut b[..count])?;
        ensure!(a[..count] == b[..count], "FLAC preserved bytes failed verification");
        remaining -= count as u64;
    }
    Ok(())
}

/// 用仅含文本的元数据视图读取标签，原图片始终保留在源文件中。
pub(super) fn read_tagged(path: &Path) -> Result<TaggedFile> {
    let mut file = File::open(path)?;
    let layout = Layout::read(&mut file)?;
    layout.tagged(&mut file)
}

/// 将文本标签和原始图片块的存在状态合并给编辑器。
pub(super) fn read_tags(path: &Path) -> Result<TrackTags> {
    let mut file = File::open(path)?;
    let layout = Layout::read(&mut file)?;
    let tagged = layout.tagged(&mut file)?;
    let mut tags = tagged
        .primary_tag()
        .or_else(|| tagged.first_tag())
        .map(tags_from_tag)
        .unwrap_or_default();
    tags.has_cover |= layout.has_cover();
    // lofty 的通用 Tag 不包含未知字段，语言后缀歌词需从原始注释中读取。
    if tags.lyrics.is_none() {
        tags.lyrics = layout
            .comments
            .entries
            .iter()
            .filter_map(|entry| {
                let text = std::str::from_utf8(entry).ok()?;
                let (key, value) = text.split_once('=')?;
                if ItemKey::from_key(TagType::VorbisComments, key).is_some() || value.is_empty() {
                    return None;
                }
                let normalized = super::tag_fields::normalize_tag_key(key);
                if normalized.starts_with("lyricist") {
                    return None;
                }
                super::tag_fields::is_lyric_field_key(&normalized).then(|| {
                    (value, super::tag_fields::get_lyric_priority(&normalized))
                })
            })
            .max_by_key(|(_, priority)| *priority)
            .map(|(value, _)| value.to_string());
    }
    Ok(tags)
}

/// 重写临时文件并校验完整图片、音频和解码首帧，失败时由调用方清理临时文件。
pub(super) fn write(source: &Path, destination: &Path, request: &TagWriteRequest) -> Result<()> {
    let mut input = File::open(source)?;
    let mut layout = Layout::read(&mut input)?;
    layout.comments.apply(request);
    let comments = layout.comments.encode()?;
    let picture = if let Some(data) = &request.cover {
        ensure!(
            data.len() as u64 + 32 <= MAX_BLOCK_SIZE,
            "FLAC cover exceeds the 24-bit block size limit"
        );
        let mut picture = Picture::from_reader(&mut data.as_slice())
            .context("Cover image data is invalid")?;
        picture.set_pic_type(PictureType::CoverFront);
        let info = PictureInformation::from_picture(&picture)?;
        let bytes = picture.as_flac_bytes(info, false);
        ensure!(
            bytes.len() as u64 <= MAX_BLOCK_SIZE,
            "FLAC cover exceeds the 24-bit block size limit"
        );
        Some(bytes)
    } else {
        None
    };
    let mut output = OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(destination)?;
    copy_range(&mut input, &mut output, 0, layout.marker + 4)?;
    for block in &layout.blocks {
        if block.kind() == 4 || (block.kind() == 6 && picture.is_some()) {
            continue;
        }
        let mut header = block.header;
        header[0] &= 0x7f;
        output.write_all(&header)?;
        copy_range(&mut input, &mut output, block.start + 4, block.size)?;
    }
    // 把新文本放在末尾，使原图片的完整载荷与新的末尾标记明确分离。
    write_header(
        &mut output,
        if picture.is_some() { 4 } else { 0x84 },
        comments.len() as u64,
    )?;
    output.write_all(&comments)?;
    if let Some(picture) = &picture {
        write_header(&mut output, 0x86, picture.len() as u64)?;
        output.write_all(picture)?;
    }
    copy_range(
        &mut input,
        &mut output,
        layout.audio_start,
        layout.length - layout.audio_start,
    )?;
    output.flush()?;
    drop(output);

    let mut saved_file = File::open(destination)?;
    let saved = Layout::read(&mut saved_file).context("Edited FLAC structure verification failed")?;
    ensure!(
        saved.comments == layout.comments,
        "FLAC text metadata verification failed"
    );
    // 写前解析与写后解析必须使用同一语义，避免保存成功却读不到字段。
    saved.tagged(&mut saved_file)?;
    ensure!(saved.marker == layout.marker, "FLAC leading tag verification failed");
    compare_range(&mut input, 0, &mut saved_file, 0, layout.marker + 4)?;
    let mut retained = saved
        .blocks
        .iter()
        .filter(|block| block.kind() != 4 && !(block.kind() == 6 && picture.is_some()));
    for original in layout
        .blocks
        .iter()
        .filter(|block| block.kind() != 4 && !(block.kind() == 6 && picture.is_some()))
    {
        let block = retained.next().context("FLAC metadata block was lost")?;
        ensure!(
            block.kind() == original.kind()
                && block.header[1..] == original.header[1..]
                && block.size == original.size,
            "FLAC metadata header verification failed"
        );
        compare_range(
            &mut input,
            original.start + 4,
            &mut saved_file,
            block.start + 4,
            block.size,
        )?;
    }
    ensure!(
        retained.next().is_none(),
        "Unexpected FLAC metadata block after editing"
    );
    if let Some(picture) = &picture {
        let mut pictures = saved.blocks.iter().filter(|block| block.kind() == 6);
        let block = pictures.next().context("FLAC replacement cover was lost")?;
        ensure!(
            pictures.next().is_none() && block.size == picture.len() as u64,
            "FLAC replacement cover size verification failed"
        );
        saved_file.seek(SeekFrom::Start(block.start + 4))?;
        let mut buffer = [0; 16 * 1024];
        for expected in picture.chunks(buffer.len()) {
            saved_file.read_exact(&mut buffer[..expected.len()])?;
            ensure!(
                &buffer[..expected.len()] == expected,
                "FLAC replacement cover verification failed"
            );
        }
    }
    ensure!(
        saved.length - saved.audio_start == layout.length - layout.audio_start,
        "FLAC audio size verification failed"
    );
    compare_range(
        &mut input,
        layout.audio_start,
        &mut saved_file,
        saved.audio_start,
        layout.length - layout.audio_start,
    )?;
    // 实际播放解码器也必须能读到首帧，不能只凭文本解析成功替换原文件。
    let mut decoder = ffmpeg_audio::AudioReader::new(File::open(destination)?)
        .context("Edited FLAC cannot be opened by the playback decoder")?;
    ensure!(
        decoder
            .receive_frame()
            .context("Edited FLAC audio decoding failed")?
            .is_some(),
        "Edited FLAC has no decodable audio frame"
    );
    Ok(())
}

#[cfg(test)]
#[path = "flac_tests.rs"]
mod tests;
