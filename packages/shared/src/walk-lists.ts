// Walk list stop ordering (CC-4 minimal). Real route optimization comes
// with mapping in M2+; for M1, stops are grouped so a canvasser walks
// street-by-street: ZIP → city → street name → house number.

export interface StopCandidate {
  address: string | null;
  city: string | null;
  zip: string | null;
}

function splitAddress(address: string | null): { street: string; num: number } {
  if (!address) return { street: "", num: 0 };
  const match = address.trim().match(/^(\d+)\s+(.*)$/);
  if (!match) return { street: address.toLowerCase(), num: 0 };
  return { street: match[2].toLowerCase(), num: parseInt(match[1], 10) };
}

/** Order voters into a walkable sequence. Stable for equal keys. */
export function orderStops<T extends StopCandidate>(voters: T[]): T[] {
  return voters
    .map((v, i) => ({ v, i, parts: splitAddress(v.address) }))
    .sort((a, b) => {
      const zip = (a.v.zip ?? "").localeCompare(b.v.zip ?? "");
      if (zip !== 0) return zip;
      const city = (a.v.city ?? "").localeCompare(b.v.city ?? "");
      if (city !== 0) return city;
      const street = a.parts.street.localeCompare(b.parts.street);
      if (street !== 0) return street;
      if (a.parts.num !== b.parts.num) return a.parts.num - b.parts.num;
      return a.i - b.i;
    })
    .map(({ v }) => v);
}
