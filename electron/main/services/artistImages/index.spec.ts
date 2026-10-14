// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  write: vi.fn(),
  search: vi.fn(),
  fetch: vi.fn(),
  read: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({
  default: {
    readFile: mocks.read,
    access: async () => {
      throw new Error("missing");
    },
    mkdir: vi.fn(),
    writeFile: vi.fn(),
  },
}));
vi.mock("node:timers/promises", () => ({ setTimeout: async () => {} }));
vi.mock("atomically", () => ({ writeFile: mocks.write }));
vi.mock("@main/services/metadataLookup", () => ({ searchSpotifyArtistImage: mocks.search }));
vi.mock("@main/utils/config", () => ({ getArtistCacheDir: () => "cache" }));
vi.mock("@main/utils/logger", () => ({ libraryLog: { info: vi.fn(), warn: vi.fn() } }));
vi.mock("@main/utils/proxy", () => ({ fetchWithProxy: mocks.fetch }));
vi.mock("@main/utils/protocol", () => ({ toCacheUrl: (filename: string) => filename }));

beforeEach(() => {
  vi.resetModules();
  mocks.write.mockReset().mockResolvedValue(undefined);
  mocks.read.mockReset().mockResolvedValue("{}");
  mocks.search.mockReset().mockResolvedValue("https://example.test/image");
  mocks.fetch.mockReset().mockImplementation(
    async () =>
      new Response(new Uint8Array([1]), {
        headers: { "content-type": "image/jpeg" },
      }),
  );
});

it("recovers after a failed index write", async () => {
  mocks.write.mockRejectedValueOnce(new Error("ENOSPC"));
  const images = await import("./index");
  expect(await images.getArtistImage("First")).toBeUndefined();
  expect(await images.getArtistImage("Second")).toBeTruthy();
  expect(mocks.write).toHaveBeenCalledTimes(2);
});

it("does not commit an artist result that arrives after cache invalidation", async () => {
  let resolve!: (value: string) => void;
  mocks.search.mockReturnValueOnce(
    new Promise<string>((done) => {
      resolve = done;
    }),
  );
  const images = await import("./index");
  const pending = images.getArtistImage("Late");
  await vi.waitFor(() => expect(mocks.search).toHaveBeenCalled());
  const clearing = images.invalidateArtistImages();
  expect(await images.getArtistImage("During reset")).toBeUndefined();
  expect(mocks.search).toHaveBeenCalledOnce();
  resolve("https://example.test/image");
  await clearing;
  expect(await pending).toBeUndefined();
  expect(mocks.write).not.toHaveBeenCalled();
});

it("bounds a legacy oversized index on first use", async () => {
  mocks.read.mockResolvedValue(
    JSON.stringify(
      Object.fromEntries(
        Array.from({ length: 6000 }, (_, index) => [`artist${index}`, { checkedAt: index }]),
      ),
    ),
  );
  mocks.search.mockResolvedValue(undefined);
  const images = await import("./index");
  await images.getArtistImage("New");
  const persisted = JSON.parse(mocks.write.mock.calls[0][1]);
  expect(Object.keys(persisted)).toHaveLength(5000);
  expect(persisted.artist0).toBeUndefined();
  expect(persisted.new).toBeDefined();
});
