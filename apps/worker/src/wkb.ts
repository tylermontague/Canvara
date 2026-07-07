// PostGIS returns geography columns over the API as EWKB hex. The worker
// only ever needs POINT lat/lng out of it (GPS correlation, IE-3).

export function parseWkbPoint(hex: unknown): { lat: number; lng: number } | null {
  if (typeof hex !== "string" || hex.length < 42) return null;
  try {
    const bytes = Buffer.from(hex, "hex");
    const littleEndian = bytes.readUInt8(0) === 1;
    const type = littleEndian ? bytes.readUInt32LE(1) : bytes.readUInt32BE(1);
    if ((type & 0xff) !== 1) return null; // not a POINT
    const hasSrid = (type & 0x20000000) !== 0;
    const offset = 5 + (hasSrid ? 4 : 0);
    const lng = littleEndian ? bytes.readDoubleLE(offset) : bytes.readDoubleBE(offset);
    const lat = littleEndian ? bytes.readDoubleLE(offset + 8) : bytes.readDoubleBE(offset + 8);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}
