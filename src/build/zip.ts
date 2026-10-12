/**
 * Minimal store-only ZIP writer (no compression, no dependency): CRC-32, local file headers, central directory,
 * end-of-central-directory record, UTF-8 names (general purpose flag bit 11). Phase 4 "Download all".
 * Limits: classic ZIP (no ZIP64), so at most 65535 entries and 4 GiB; far beyond what the package needs.
 */

export interface ZipEntry {
  /** Path inside the archive, forward slashes, no leading slash. */
  name: string;
  data: string | Uint8Array;
}

export interface ZipOptions {
  /** Modification stamp written to every entry (default 1980-01-01, the DOS epoch, so the output is deterministic). */
  date?: Date;
}

let TABLE: Uint32Array | null = null;

/** CRC-32 (IEEE 802.3, the ZIP polynomial 0xEDB88320). */
export function crc32(bytes: Uint8Array): number {
  if (!TABLE) {
    TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const utf8 = new TextEncoder();
export const toBytes = (d: string | Uint8Array): Uint8Array => (typeof d === 'string' ? utf8.encode(d) : d);

/** DOS time and date words for a Date (local fields; years before 1980 clamp to 1980-01-01). */
function dosStamp(d: Date): { time: number; date: number } {
  const y = d.getFullYear();
  if (!(y >= 1980)) return { time: 0, date: (1 << 5) | 1 };
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((Math.min(y, 2107) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** Build a ZIP archive holding `entries` uncompressed (method 0). Entry order is kept. */
export function zipStore(entries: ZipEntry[], opts: ZipOptions = {}): Uint8Array {
  const stamp = dosStamp(opts.date ?? new Date(1980, 0, 1));
  const prepared = entries.map((e) => {
    const data = toBytes(e.data);
    return { nameBytes: utf8.encode(e.name), data, crc: crc32(data) };
  });
  let size = 22;
  for (const e of prepared) size += 30 + e.nameBytes.length + e.data.length + 46 + e.nameBytes.length;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  let pos = 0;
  const offsets: number[] = [];
  const FLAGS = 0x0800; // bit 11: names are UTF-8
  for (const e of prepared) {
    offsets.push(pos);
    dv.setUint32(pos, 0x04034b50, true);
    dv.setUint16(pos + 4, 20, true); // version needed
    dv.setUint16(pos + 6, FLAGS, true);
    dv.setUint16(pos + 8, 0, true); // method: stored
    dv.setUint16(pos + 10, stamp.time, true);
    dv.setUint16(pos + 12, stamp.date, true);
    dv.setUint32(pos + 14, e.crc, true);
    dv.setUint32(pos + 18, e.data.length, true); // compressed size
    dv.setUint32(pos + 22, e.data.length, true); // uncompressed size
    dv.setUint16(pos + 26, e.nameBytes.length, true);
    dv.setUint16(pos + 28, 0, true); // extra length
    out.set(e.nameBytes, pos + 30);
    out.set(e.data, pos + 30 + e.nameBytes.length);
    pos += 30 + e.nameBytes.length + e.data.length;
  }
  const cdStart = pos;
  prepared.forEach((e, i) => {
    dv.setUint32(pos, 0x02014b50, true);
    dv.setUint16(pos + 4, 20, true); // version made by
    dv.setUint16(pos + 6, 20, true); // version needed
    dv.setUint16(pos + 8, FLAGS, true);
    dv.setUint16(pos + 10, 0, true);
    dv.setUint16(pos + 12, stamp.time, true);
    dv.setUint16(pos + 14, stamp.date, true);
    dv.setUint32(pos + 16, e.crc, true);
    dv.setUint32(pos + 20, e.data.length, true);
    dv.setUint32(pos + 24, e.data.length, true);
    dv.setUint16(pos + 28, e.nameBytes.length, true);
    dv.setUint16(pos + 30, 0, true); // extra
    dv.setUint16(pos + 32, 0, true); // comment
    dv.setUint16(pos + 34, 0, true); // disk number
    dv.setUint16(pos + 36, 0, true); // internal attributes
    dv.setUint32(pos + 38, 0, true); // external attributes
    dv.setUint32(pos + 42, offsets[i], true);
    out.set(e.nameBytes, pos + 46);
    pos += 46 + e.nameBytes.length;
  });
  const cdSize = pos - cdStart;
  dv.setUint32(pos, 0x06054b50, true);
  dv.setUint16(pos + 4, 0, true);
  dv.setUint16(pos + 6, 0, true);
  dv.setUint16(pos + 8, prepared.length, true);
  dv.setUint16(pos + 10, prepared.length, true);
  dv.setUint32(pos + 12, cdSize, true);
  dv.setUint32(pos + 16, cdStart, true);
  dv.setUint16(pos + 20, 0, true); // comment length
  return out;
}
