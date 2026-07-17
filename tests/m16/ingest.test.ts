// M16 exit test: multi-format ingestion. Every accepted format normalizes
// to the same string-grid the M1 pipeline already consumes, so the proof is
// that a grid produced from Excel (and from tab/semicolon-delimited text)
// flows cleanly through detectHeaderRow → suggestMapping → mapRows exactly
// like a CSV does.
//
// No database or network — pure parsing. Run with: npm run test:m16

import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  sniffImportFormat,
  parseWorkbookGrids,
  pickLikeliestSheet,
  parseCsv,
  detectHeaderRow,
  suggestMapping,
  mapRows,
  IMPORT_ACCEPT,
} from "@canvara/shared";

// A messy-but-realistic voter layout: a preamble/disclaimer row, then the
// real header, then data — the same shape the M1 CSV test exercises.
const HEADER = ["Voter ID", "First Name", "Last Name", "Street", "City", "Zip", "Party"];
const DATA = [
  ["A100", "Dawn", "Zigler", "12631 N 36TH ST", "Phoenix", "85032", "Rep"],
  ["A101", "Marcus", "Vela", "88 W Palm Ln", "Mesa", "85201", "Dem"],
  ["A102", "Priya", "Nair", "4 Cactus Way", "Tempe", "85281", "Ind"],
];

function assertMapsCleanly(grid: string[][], label: string) {
  const headerIdx = detectHeaderRow(grid);
  assert.equal(grid[headerIdx][0], "Voter ID", `${label}: found the real header row`);
  const mapping = suggestMapping(grid[headerIdx]);
  for (const field of ["external_id", "first_name", "last_name", "city", "zip", "party"] as const) {
    assert.ok(mapping[field], `${label}: ${field} auto-mapped`);
  }
  const { voters, skipped } = mapRows(grid, headerIdx, mapping);
  assert.equal(voters.length, DATA.length, `${label}: all rows mapped`);
  assert.equal(skipped, 0, `${label}: nothing skipped`);
  assert.equal(voters[0].external_id, "A100");
  assert.equal(voters[0].first_name, "Dawn");
  assert.equal(voters[0].city, "Phoenix");
  assert.equal(voters[2].last_name, "Nair");
}

test("sniffImportFormat classifies by extension", () => {
  assert.equal(sniffImportFormat("roster.xlsx"), "excel");
  assert.equal(sniffImportFormat("AZ Statewide - HE Pri Rep - Aug 2025.xlsx"), "excel");
  assert.equal(sniffImportFormat("export.XLS"), "excel");
  assert.equal(sniffImportFormat("voters.csv"), "delimited");
  assert.equal(sniffImportFormat("voters.tsv"), "delimited");
  assert.equal(sniffImportFormat("dump.txt"), "delimited");
  assert.equal(sniffImportFormat("photo.png"), "unknown");
  assert.match(IMPORT_ACCEPT, /\.xlsx/);
  assert.match(IMPORT_ACCEPT, /\.csv/);
});

test("delimited: comma, tab, and semicolon all parse to the same grid", () => {
  const preamble = "County voter extract — do not distribute";
  const build = (d: string) =>
    [preamble, [HEADER, ...DATA].map((r) => r.join(d)).join("\n")].join("\n");

  for (const [name, delim] of [["CSV", ","], ["TSV", "\t"], ["semicolon", ";"]] as const) {
    const grid = parseCsv(build(delim)); // parseCsv auto-detects the delimiter
    assertMapsCleanly(grid, name);
  }
});

test("excel: a workbook reads into the grid and flows through the pipeline", async () => {
  // Build a real .xlsx in memory: preamble row, header, data — one sheet.
  const aoa = [["County voter extract — do not distribute"], HEADER, ...DATA];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "voters");
  const bytes = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));

  const sheets = await parseWorkbookGrids(bytes);
  assert.equal(sheets.length, 1);
  assert.equal(sheets[0].name, "voters");
  assertMapsCleanly(sheets[0].grid, "Excel");
});

test("excel: values read as displayed strings, not raw numbers", async () => {
  // Zip and an all-digit voter id must survive as strings (downstream is
  // string-typed); dates/numbers come through as their shown text.
  const aoa = [
    ["Voter ID", "First Name", "Last Name", "Zip"],
    [900123, "Sam", "Ito", 85032],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "s");
  const bytes = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));

  const [{ grid }] = await parseWorkbookGrids(bytes);
  assert.equal(grid[1][0], "900123", "numeric id → string");
  assert.equal(grid[1][3], "85032", "numeric zip → string");
  assert.equal(typeof grid[1][3], "string");
});

test("excel: multi-sheet workbook — pick the sheet with the roster", async () => {
  const wb = XLSX.utils.book_new();
  // A small "Notes" tab and the big roster tab, added notes-first.
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Notes"], ["prepared Aug 2025"]]), "Notes");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADER, ...DATA]), "Roster");
  const bytes = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));

  const sheets = await parseWorkbookGrids(bytes);
  assert.equal(sheets.length, 2);
  const picked = pickLikeliestSheet(sheets);
  assert.equal(picked!.name, "Roster", "the roster (most rows) is auto-selected");
  assertMapsCleanly(picked!.grid, "picked sheet");
});
