import { describe, expect, it } from 'vitest';
import { crc32, zipStore } from './zip';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('crc32', () => {
  it('matches the published check values', () => {
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
    expect(crc32(bytes('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });
});

/** Parse our own output with the standard ZIP structure: end record -> central directory -> local headers. */
function parse(zip: Uint8Array) {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.length - 22;
  expect(dv.getUint32(eocd, true)).toBe(0x06054b50);
  const count = dv.getUint16(eocd + 10, true);
  expect(dv.getUint16(eocd + 8, true)).toBe(count);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdStart = dv.getUint32(eocd + 16, true);
  expect(cdStart + cdSize).toBe(eocd);
  const out: Array<{ name: string; data: Uint8Array; crc: number; flags: number; method: number }> = [];
  let pos = cdStart;
  for (let i = 0; i < count; i++) {
    expect(dv.getUint32(pos, true)).toBe(0x02014b50);
    const flags = dv.getUint16(pos + 8, true);
    const method = dv.getUint16(pos + 10, true);
    const crc = dv.getUint32(pos + 16, true);
    const csize = dv.getUint32(pos + 20, true);
    const usize = dv.getUint32(pos + 24, true);
    const nlen = dv.getUint16(pos + 28, true);
    const off = dv.getUint32(pos + 42, true);
    const name = new TextDecoder().decode(zip.subarray(pos + 46, pos + 46 + nlen));
    expect(csize).toBe(usize);
    // local header agrees with the central directory
    expect(dv.getUint32(off, true)).toBe(0x04034b50);
    expect(dv.getUint32(off + 14, true)).toBe(crc);
    expect(dv.getUint32(off + 18, true)).toBe(csize);
    expect(dv.getUint32(off + 22, true)).toBe(usize);
    const lnlen = dv.getUint16(off + 26, true);
    const lxlen = dv.getUint16(off + 28, true);
    expect(new TextDecoder().decode(zip.subarray(off + 30, off + 30 + lnlen))).toBe(name);
    const start = off + 30 + lnlen + lxlen;
    out.push({ name, data: zip.subarray(start, start + usize), crc, flags, method });
    pos += 46 + nlen + dv.getUint16(pos + 30, true) + dv.getUint16(pos + 32, true);
  }
  expect(pos).toBe(cdStart + cdSize);
  return out;
}

describe('zipStore', () => {
  it('round-trips text and binary entries with correct sizes and CRCs', () => {
    const bin = new Uint8Array(1000).map((_, i) => (i * 7 + 3) & 0xff);
    const zip = zipStore([
      { name: 'README.txt', data: 'hello\nworld\n' },
      { name: 'stl/clip.stl', data: bin },
      { name: 'empty.txt', data: '' },
    ]);
    const files = parse(zip);
    expect(files.map((f) => f.name)).toEqual(['README.txt', 'stl/clip.stl', 'empty.txt']);
    expect(new TextDecoder().decode(files[0].data)).toBe('hello\nworld\n');
    expect(Array.from(files[1].data)).toEqual(Array.from(bin));
    expect(files[2].data.length).toBe(0);
    for (const f of files) {
      expect(f.method).toBe(0);
      expect(crc32(f.data)).toBe(f.crc);
    }
  });

  it('writes UTF-8 names with flag bit 11 and counts bytes, not characters', () => {
    const zip = zipStore([{ name: 'résumé/日本.txt', data: 'é' }]);
    const [f] = parse(zip);
    expect(f.name).toBe('résumé/日本.txt');
    expect(f.flags & 0x0800).toBe(0x0800);
    expect(f.data.length).toBe(2); // 'é' is two bytes
  });

  it('is deterministic and handles an empty archive', () => {
    const a = zipStore([{ name: 'a.txt', data: 'x' }], { date: new Date(2026, 9, 12, 8, 30, 10) });
    const b = zipStore([{ name: 'a.txt', data: 'x' }], { date: new Date(2026, 9, 12, 8, 30, 10) });
    expect(Array.from(a)).toEqual(Array.from(b));
    const dv = new DataView(a.buffer);
    expect(dv.getUint16(12, true)).toBe(((2026 - 1980) << 9) | (10 << 5) | 12); // DOS date
    expect(dv.getUint16(10, true)).toBe((8 << 11) | (30 << 5) | 5); // DOS time (2 s units)
    const empty = zipStore([]);
    expect(empty.length).toBe(22);
    expect(parse(empty)).toEqual([]);
  });
});
