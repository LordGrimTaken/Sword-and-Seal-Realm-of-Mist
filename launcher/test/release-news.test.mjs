// make-release must publish player-facing news (news.extra.json) and keep the dev CHANGELOG out of the feed.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeNews } from "../src/news.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEV_JARGON = /\b(hanzi|css|variables?|hooks?|testing hook|TEST_MODE|npm|protocol|woff2?|svg|sqlite|snapshot|ui-test|\.mjs|\.ts)\b|--font|`/i;

test("news.extra.json: at least 3 short, player-facing posts without dev jargon", () => {
  const items = normalizeNews(JSON.parse(fs.readFileSync(path.join(root, "news.extra.json"), "utf8")));
  assert.ok(items.length >= 3, "three or more posts");
  for (const n of items) {
    assert.ok(n.tag && n.summary, `${n.id} has a tag and a summary`);
    assert.ok(["valley", "blades", "scroll", "lantern"].includes(n.banner), `${n.id} has a known banner`);
    assert.ok(n.summary.length <= 160, `${n.id} summary is a short blurb`);
    assert.ok(n.body.length <= 1500, `${n.id} body is short`);
    assert.ok(!DEV_JARGON.test(`${n.title} ${n.summary} ${n.body}`), `${n.id} has no dev jargon`);
    assert.ok(!/[^\x00-\x7f]/.test(`${n.title}${n.summary}${n.body}`), `${n.id} is plain ASCII English`);
  }
});

test("make-release source: changelog news is opt-in only", () => {
  const src = fs.readFileSync(path.join(root, "scripts", "make-release.mjs"), "utf8");
  assert.match(src, /flag\("news-from-changelog"\)/);
});
