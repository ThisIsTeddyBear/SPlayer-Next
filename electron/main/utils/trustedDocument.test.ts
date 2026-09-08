import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { trustedDocument } from "./trustedDocument.ts";

const root = path.resolve("fixture-renderer");

test("only exact packaged entry documents are trusted", () => {
  const main = pathToFileURL(path.join(root, "index.html")).href;
  assert.equal(trustedDocument(`${main}#/library`, root), "index.html");
  assert.equal(trustedDocument(pathToFileURL(path.join(root, "other.html")).href, root), undefined);
  assert.equal(trustedDocument(pathToFileURL(path.join(root, "..", "index.html")).href, root), undefined);
  assert.equal(trustedDocument("https://example.com/index.html", root), undefined);
  assert.equal(trustedDocument("javascript:alert(1)", root), undefined);
});

test("development trust checks origin, credentials and entry path", () => {
  const dev = "http://localhost:5173";
  assert.equal(trustedDocument(`${dev}/#/settings`, root, dev), "index.html");
  assert.equal(
    trustedDocument(`${dev}/windows/desktop-lyric/index.html`, root, dev),
    "windows/desktop-lyric/index.html",
  );
  for (const value of [
    "http://localhost:51730/",
    "http://localhost:5173.evil.test/",
    "http://user@localhost:5173/",
    `${dev}/evil.html`,
    `${dev}/node_modules/evil/index.html`,
  ]) {
    assert.equal(trustedDocument(value, root, dev), undefined);
  }
});
