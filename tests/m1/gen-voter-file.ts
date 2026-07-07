// Synthetic 5k-row voter file for the M1 exit test, shaped like a real
// county export: legal-disclaimer preamble, a split two-row header, street
// address broken across Num/Dir/Street Name, and mailing-address columns
// that must NOT be picked up by the mapper. Deterministic (seeded PRNG) so
// every test run imports identical data.

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST_NAMES = [
  "MARY", "JAMES", "LINDA", "ROBERT", "PATRICIA", "JOHN", "BARBARA", "MICHAEL",
  "ELIZABETH", "WILLIAM", "JENNIFER", "DAVID", "MARIA", "RICHARD", "SUSAN",
  "JOSEPH", "MARGARET", "THOMAS", "DOROTHY", "CARLOS", "ANA", "LUIS", "SOFIA",
];
const LAST_NAMES = [
  "SMITH", "JOHNSON", "WILLIAMS", "BROWN", "JONES", "GARCIA", "MILLER",
  "DAVIS", "RODRIGUEZ", "MARTINEZ", "HERNANDEZ", "LOPEZ", "GONZALEZ",
  "WILSON", "ANDERSON", "THOMAS", "TAYLOR", "MOORE", "JACKSON", "MARTIN",
];
const STREETS = [
  "KENNETH PL", "HILLCREST", "JUANITA AVE", "ORACLE CIR", "HALIFAX ST",
  "MAIN ST", "BROADWAY RD", "UNIVERSITY DR", "SOUTHERN AVE", "BASELINE RD",
  "DOBSON RD", "GILBERT RD", "STAPLEY DR", "LINDSAY RD", "VAL VISTA DR",
];
const DIRS = ["N", "S", "E", "W"];
const CITIES: Array<{ city: string; zips: string[] }> = [
  { city: "MESA", zips: ["85201", "85203", "85210"] },
  { city: "TEMPE", zips: ["85281", "85282"] },
  { city: "CHANDLER", zips: ["85224", "85225"] },
  { city: "GILBERT", zips: ["85233"] },
];
const PARTIES = ["REP", "DEM", "IND", "LBT"];
const GENDERS = ["F", "M", ""];

function pick<T>(rand: () => number, arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

export const M1_EXTERNAL_ID_PREFIX = "M1-";

/** Build the CSV text: `rowCount` data rows plus preamble + 2-row header. */
export function generateVoterFileCsv(rowCount: number, seed = 20260707): string {
  const rand = mulberry32(seed);
  const lines: string[] = [
    // Preamble a real county file would carry (must be skipped by detection).
    '"This synthetic file is test data for the Canvara M1 exit test. It mimics a county voter file export.",,,,,,,,,,,,,,,,',
    '"Do not distribute. Columns intentionally include mailing address decoys.",,,,,,,,,,,,,,,,',
    ",,,,,,,,,,,,,,,,",
    // Split header: this partial row must lose to the real header below.
    "Div/,Owner,,,,,,,,Street,Street,,,,Mail,Mail,",
    "Dist,Code,Voter ID,Last Name,First Name,Birth Year,Gender,Party,Precinct,Num,Dir,Street Name,City,Zip,Mail Street Name,Mail City,Mail Zip",
  ];

  for (let i = 1; i <= rowCount; i++) {
    const cityInfo = pick(rand, CITIES);
    const zip = pick(rand, cityInfo.zips);
    const street = pick(rand, STREETS);
    const dir = pick(rand, DIRS);
    const num = 100 + Math.floor(rand() * 9900);
    const birthYear = 1935 + Math.floor(rand() * 72); // 1935–2006
    const precinct = `PCT-${zip.slice(-2)}${1 + Math.floor(rand() * 4)}`;
    const row = [
      "9",
      "A",
      `${M1_EXTERNAL_ID_PREFIX}${String(i).padStart(5, "0")}`,
      pick(rand, LAST_NAMES),
      pick(rand, FIRST_NAMES),
      String(birthYear),
      pick(rand, GENDERS),
      pick(rand, PARTIES),
      precinct,
      String(num),
      dir,
      street,
      cityInfo.city,
      zip,
      `${num} ${dir} ${street}`, // mailing decoys
      cityInfo.city,
      zip,
    ];
    lines.push(row.join(","));
  }

  return lines.join("\r\n") + "\r\n";
}
