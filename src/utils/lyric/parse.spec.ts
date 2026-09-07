import { describe, expect, it } from "vitest";
import { bestExternalIndex, detectFormat, parseLyric } from "./parse";

describe("lyric parse", () => {
  it("preserves TTML singer roles, agent names, lanes, and multiple backing vocals", () => {
    const lines = parseLyric(
      {
        content: `
          <tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">
            <head><metadata>
              <ttm:agent xml:id="lead" type="person"><ttm:name>Lead</ttm:name></ttm:agent>
              <ttm:agent xml:id="reply" type="person"><ttm:name>Reply</ttm:name></ttm:agent>
              <ttm:agent xml:id="choir" type="group"><ttm:name>Choir</ttm:name></ttm:agent>
            </metadata></head>
            <body><div>
              <p begin="0s" end="4s" ttm:agent="lead">Lead<span ttm:role="x-bg">Backing one</span><span ttm:role="x-bg">Backing two</span></p>
              <p begin="1s" end="3s" ttm:agent="reply">Response</p>
              <p begin="2s" end="4s" ttm:agent="choir">Together</p>
            </div></body>
          </tt>`,
      },
      "ttml",
    );

    expect(lines.map((line) => line.singerRole)).toEqual([
      "lead",
      "background",
      "background",
      "response",
      "group",
    ]);
    expect(lines.map((line) => line.alignment)).toEqual([
      "start",
      "center",
      "center",
      "end",
      "center",
    ]);
    expect(lines[1].singerId).toBe("lead");
    expect(lines[1].singerName).toBe("Lead");
    expect(lines[3].isDuet).toBe(true);
    expect(lines[4].isDuet).toBe(false);
  });

  it("根据内容识别常见歌词格式", () => {
    expect(detectFormat("[00:01.00]歌词")).toBe("lrc");
    expect(detectFormat("1\n00:00:01,000 --> 00:00:02,000\n歌词")).toBe("srt");
    expect(detectFormat('<tt xmlns="http://www.w3.org/ns/ttml"></tt>')).toBe("ttml");
    expect(detectFormat('{"type":"Word","lyrics":[]}')).toBe("json");
    expect(detectFormat("[1000,500](1000,500,0)歌词")).toBe("yrc");
    expect(detectFormat("[1000,500]歌词(1000,500)")).toBe("qrc");
  });

  it("解析 JSON 逐词时间、合成标记和演唱者", () => {
    const [line] = parseLyric(
      {
        content: JSON.stringify({
          type: "Word",
          metadata: { agents: { v1: { type: "person", name: "Lead" } } },
          lyrics: [
            {
              time: 1000,
              duration: 500,
              syllabus: [
                { text: "Hel", time: 1000, duration: 200, synthetic: true },
                { text: "lo", time: 1200, duration: 300 },
              ],
              element: { key: "L1", singer: "v1", songPartIndex: 2 },
            },
          ],
        }),
      },
      "json",
    );

    expect(line).toMatchObject({
      startTime: 1000,
      endTime: 1500,
      singerName: "Lead",
      singerRole: "lead",
      sourceKey: "L1",
      songPartIndex: 2,
    });
    expect(line.words).toEqual([
      { word: "Hel", startTime: 1000, endTime: 1200, synthetic: true },
      { word: "lo", startTime: 1200, endTime: 1500, synthetic: undefined },
    ]);
  });

  it("按照指定优先级选择外部歌词", () => {
    const lyrics = [{ format: "lrc" as const }, { format: "ttml" as const }];

    expect(bestExternalIndex(lyrics, ["ttml", "lrc"])).toBe(1);
    expect(bestExternalIndex([], ["ttml", "lrc"])).toBe(-1);
  });

  it("LRC 会忽略元数据、按时间排序并展开多时间戳", () => {
    const lines = parseLyric(
      { content: "[ar:歌手]\n[00:02.00]第二行\n[00:01.00][00:03.00]重复行" },
      "lrc",
    );

    expect(lines.map(({ startTime }) => startTime)).toEqual([1_000, 2_000, 3_000]);
    expect(lines.map(({ words }) => words.map(({ word }) => word).join(""))).toEqual([
      "重复行",
      "第二行",
      "重复行",
    ]);
  });

  it("在容差内配对翻译和音译，超过容差时不误配", () => {
    const lines = parseLyric(
      {
        content: "[00:01.00]Hello\n[00:02.00]World",
        translation: "[00:01.20]你好\n[00:02.40]世界",
        translationFormat: "lrc",
        romaji: "[00:01.10]Harō\n[00:02.10]Wārudo",
        romajiFormat: "lrc",
      },
      "lrc",
    );

    expect(lines[0].translatedLyric).toBe("你好");
    expect(lines[1].translatedLyric).toBe("");
    expect(lines[0].romanLyric).toBe("Harō");
    expect(lines[1].romanLyric).toBe("Wārudo");
  });

  it("过滤无意义的翻译占位内容", () => {
    const lines = parseLyric(
      {
        content: "[00:01.00]Hello\n[00:02.00]World",
        translation: "[00:01.00]//\n[00:02.00]作品的著作权由原作者所有",
        translationFormat: "lrc",
      },
      "lrc",
    );

    expect(lines.every(({ translatedLyric }) => translatedLyric === "")).toBe(true);
  });

  it("将空时间标签保留为结束上一行的空白时间节点", () => {
    const lines = parseLyric({ content: "[00:00.00]A\n[00:01.00]\n[00:02.00]B" }, "lrc");

    expect(lines).toHaveLength(2);
    expect(lines[0].endTime).toBe(1_000);
    expect(lines[1].startTime).toBe(2_000);
  });

  it("使用 ESLRC 末尾时间标签结束最后一个字", () => {
    const [line] = parseLyric({ content: "[00:00.00]<00:00.00>A<00:01.00>B<00:02.00>" }, "lrc");

    expect(line.words).toEqual([
      { startTime: 0, endTime: 1_000, word: "A" },
      { startTime: 1_000, endTime: 2_000, word: "B" },
    ]);
    expect(line.endTime).toBe(2_000);
  });
});
