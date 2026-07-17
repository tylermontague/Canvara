// Multi-format voter-file ingestion (M16). The importer's whole downstream
// pipeline — header-row detection, column mapping, and the merge that never
// loses canvassing data — operates on one canonical shape: a grid of
// string rows (string[][]). So supporting a new file format is just a
// matter of turning its bytes into that grid. Everything after is already
// built and tested.
//
// This module owns the format → grid step for the two families that cover
// essentially every real voter file:
//   - delimited text (CSV / TSV / .txt): parseCsv already auto-detects the
//     delimiter, so it needs no new code — just routing.
//   - spreadsheets (.xlsx / .xls / .xlsm): parseWorkbookGrids, below.
//
// The spreadsheet reader lazy-imports SheetJS so bundles that never open a
// workbook (e.g. the field app) don't pull it into their main graph.

export type ImportFormat = "delimited" | "excel" | "unknown";

/** File extensions the importer accepts, for the <input accept> attribute. */
export const IMPORT_ACCEPT = ".csv,.tsv,.txt,.tab,.xlsx,.xls,.xlsm";

const EXCEL_EXTS = new Set(["xlsx", "xls", "xlsm", "xlsb"]);
const DELIMITED_EXTS = new Set(["csv", "tsv", "txt", "tab", "psv"]);

/** Classify a file by its name so the importer knows how to read it. */
export function sniffImportFormat(filename: string): ImportFormat {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (EXCEL_EXTS.has(ext)) return "excel";
  if (DELIMITED_EXTS.has(ext)) return "delimited";
  return "unknown";
}

export interface SheetGrid {
  name: string;
  grid: string[][];
  /** Non-empty data rows (grid.length), for the sheet picker + auto-select. */
  rows: number;
}

/**
 * Read every sheet of a workbook into string grids. Values are taken as
 * their displayed text (dates, numbers formatted as the file shows them),
 * blank cells become "", and every cell is trimmed — so the output matches
 * exactly what parseCsv produces for a delimited file, and flows through
 * the same detectHeaderRow / suggestMapping / mapRows path.
 */
export async function parseWorkbookGrids(bytes: Uint8Array): Promise<SheetGrid[]> {
  const mod = await import("xlsx");
  const XLSX = ((mod as unknown as { default?: unknown }).default ?? mod) as typeof import("xlsx");
  const wb = XLSX.read(bytes, { type: "array" });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      blankrows: false,
      raw: false, // formatted text, so numbers/dates read as they display
      defval: "",
    });
    const grid = raw.map((row) => row.map((cell) => (cell == null ? "" : String(cell)).trim()));
    return { name, grid, rows: grid.length };
  });
}

/**
 * Of a workbook's sheets, the one a voter file most likely lives in: the
 * sheet with the most data rows (real exports put the roster on the biggest
 * tab; summary/notes tabs are small). Ties keep sheet order.
 */
export function pickLikeliestSheet(sheets: SheetGrid[]): SheetGrid | null {
  let best: SheetGrid | null = null;
  for (const s of sheets) {
    if (s.rows >= 2 && (!best || s.rows > best.rows)) best = s;
  }
  return best ?? sheets[0] ?? null;
}
