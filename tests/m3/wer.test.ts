// WER harness unit tests (IE-2 spot-check tooling). No network, no env.

import { test } from "node:test";
import assert from "node:assert/strict";
import { wordErrorRate, normalizeWords } from "@canvara/shared";

test("identical strings have zero WER", () => {
  const r = wordErrorRate("I plan to vote in November.", "I plan to vote in November.");
  assert.equal(r.wer, 0);
  assert.equal(r.referenceWords, 6);
});

test("normalization ignores case and punctuation", () => {
  const r = wordErrorRate("Property taxes are too high!", "property taxes are too high");
  assert.equal(r.wer, 0);
});

test("one substitution in five words is WER 0.2", () => {
  const r = wordErrorRate("the schools here are great", "the schools there are great");
  assert.equal(r.substitutions, 1);
  assert.equal(r.wer, 0.2);
});

test("deletions and insertions are counted", () => {
  const del = wordErrorRate("I will definitely vote", "I will vote");
  assert.equal(del.deletions, 1);
  assert.equal(del.wer, 0.25);

  const ins = wordErrorRate("I will vote", "I will definitely vote");
  assert.equal(ins.insertions, 1);
  assert.ok(Math.abs(ins.wer - 1 / 3) < 1e-9);
});

test("empty reference with hypothesis text is WER 1", () => {
  assert.equal(wordErrorRate("", "hello there").wer, 1);
  assert.equal(wordErrorRate("", "").wer, 0);
});

test("normalizeWords keeps apostrophes inside words", () => {
  assert.deepEqual(normalizeWords("I don't know."), ["i", "don't", "know"]);
});
