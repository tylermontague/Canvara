// Generate the M3 ASR fixture: synthesizes the scripted doorstep
// conversation (tests/m3/fixtures.ts) with two Kokoro voices and writes
//   tests/m3/fixtures/audio.wav      (two-speaker conversation)
//   tests/m3/fixtures/reference.txt  (ground-truth transcript for WER)
// The wav is gitignored (~MBs, fully reproducible): npm run gen:m3-audio
// First run downloads the Kokoro model (~340 MB, cached).

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const fixturesDir = path.join(root, "tests", "m3", "fixtures");
const tmpDir = path.join(fixturesDir, ".tmp");
mkdirSync(tmpDir, { recursive: true });

// Load the scripted transcript without a TS loader: tsx runs this file.
const { SCRIPTED_TRANSCRIPT } = await import(
  new URL("../tests/m3/fixtures.ts", import.meta.url).href
);

const VOICES = { S0: "am_adam", S1: "af_heart" }; // canvasser / voter

const lineFiles = [];
for (let i = 0; i < SCRIPTED_TRANSCRIPT.length; i++) {
  const line = SCRIPTED_TRANSCRIPT[i];
  const textFile = path.join(tmpDir, `line_${String(i).padStart(2, "0")}.txt`);
  const wavFile = path.join(tmpDir, `line_${String(i).padStart(2, "0")}.wav`);
  writeFileSync(textFile, line.text);
  console.log(`[tts] ${i + 1}/${SCRIPTED_TRANSCRIPT.length} (${VOICES[line.speaker]})`);
  execFileSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["--yes", "hyperframes", "tts", textFile, "--voice", VOICES[line.speaker], "--output", wavFile],
    { stdio: ["ignore", "ignore", "inherit"], shell: process.platform === "win32", cwd: root },
  );
  lineFiles.push(wavFile);
}

// Concatenate with 0.6s gaps (python soundfile — same runtime Kokoro used).
const concatScript = path.join(tmpDir, "concat.py");
writeFileSync(
  concatScript,
  `
import sys, glob, os
import numpy as np
import soundfile as sf

tmp = sys.argv[1]
out = sys.argv[2]
files = sorted(glob.glob(os.path.join(tmp, "line_*.wav")))
pieces = []
sr = None
for f in files:
    data, rate = sf.read(f)
    if sr is None:
        sr = rate
    assert rate == sr, "sample-rate mismatch"
    if data.ndim > 1:
        data = data.mean(axis=1)
    pieces.append(data)
    pieces.append(np.zeros(int(sr * 0.6)))
audio = np.concatenate(pieces)
sf.write(out, audio, sr)
print(f"wrote {out}: {len(audio)/sr:.1f}s at {sr}Hz")
`,
);
execFileSync("python", [concatScript, tmpDir, path.join(fixturesDir, "audio.wav")], {
  stdio: "inherit",
});

const reference = SCRIPTED_TRANSCRIPT.map((u) => u.text).join(" ");
writeFileSync(path.join(fixturesDir, "reference.txt"), reference);
rmSync(tmpDir, { recursive: true, force: true });
console.log("fixture ready: tests/m3/fixtures/audio.wav + reference.txt");
