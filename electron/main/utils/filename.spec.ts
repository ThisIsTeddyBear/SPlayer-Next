import { expect, it } from "vitest";
import { renderDownloadPath, sanitizeSegment } from "./filename";

it.each(["CON", "aux", "NUL.txt", "COM1", "LPT9", "COM¹"])(
  "normalizes reserved Windows name %s",
  (name) => {
    expect(sanitizeSegment(name)).toBe(`_${name}`);
  },
);

it("normalizes folder names and control characters as well as filenames", () => {
  expect(
    renderDownloadPath("artist", "{title}", { title: "CON", artist: "AUX", album: "" }),
  ).toEqual({
    relDir: "_AUX",
    baseName: "_CON",
  });
  expect(sanitizeSegment("song\0\u0001name")).toBe("song name");
});
