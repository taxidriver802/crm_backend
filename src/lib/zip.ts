import fs from 'fs';
import zlib from 'zlib';

/**
 * A small zip writer for company exports: entries are deflated one at a
 * time and written straight to disk, then the central directory is
 * appended. No zip64, so an archive (and each entry) must stay under 4 GB;
 * add() refuses anything that would pass it.
 */

const LIMIT = 0xffffffff;

type Entry = { name: Buffer; crc: number; compressed: number; size: number; offset: number; time: number; date: number };

function dosDateTime(d: Date) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

export class ZipWriter {
  private fd: number;
  private offset = 0;
  private entries: Entry[] = [];
  private names = new Set<string>();

  constructor(filePath: string) {
    this.fd = fs.openSync(filePath, 'w');
  }

  private write(buf: Buffer) {
    fs.writeSync(this.fd, buf);
    this.offset += buf.length;
  }

  /** Adds one file. Names use forward slashes and must be unique. */
  add(name: string, data: Buffer | string, modified = new Date()) {
    const clean = name.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!clean || clean.split('/').includes('..')) throw new Error(`Bad zip entry name: ${name}`);
    if (this.entries.length >= 0xffff) throw new Error('Too many entries for a zip without zip64');
    if (this.names.has(clean)) throw new Error(`Duplicate zip entry: ${clean}`);
    this.names.add(clean);

    const raw = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    const deflated = zlib.deflateRawSync(raw);
    if (raw.length >= LIMIT || this.offset + deflated.length + 1024 >= LIMIT) {
      throw new Error('Archive too large for a zip without zip64');
    }
    const nameBuf = Buffer.from(clean, 'utf8');
    const crc = zlib.crc32(raw) >>> 0;
    const { time, date } = dosDateTime(modified);

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt16LE(0x0800, 6); // UTF-8 names
    header.writeUInt16LE(8, 8); // deflate
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(deflated.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(0, 28);

    const offset = this.offset;
    this.write(header);
    this.write(nameBuf);
    this.write(deflated);
    this.entries.push({ name: nameBuf, crc, compressed: deflated.length, size: raw.length, offset, time, date });
  }

  /** Writes the central directory and closes the file. Returns its size in bytes. */
  finish(): number {
    const start = this.offset;
    for (const e of this.entries) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0);
      c.writeUInt16LE(20, 4); // version made by
      c.writeUInt16LE(20, 6); // version needed
      c.writeUInt16LE(0x0800, 8);
      c.writeUInt16LE(8, 10);
      c.writeUInt16LE(e.time, 12);
      c.writeUInt16LE(e.date, 14);
      c.writeUInt32LE(e.crc, 16);
      c.writeUInt32LE(e.compressed, 20);
      c.writeUInt32LE(e.size, 24);
      c.writeUInt16LE(e.name.length, 28);
      c.writeUInt32LE(e.offset, 42);
      this.write(c);
      this.write(e.name);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(this.offset - start, 12);
    end.writeUInt32LE(start, 16);
    this.write(end);
    fs.closeSync(this.fd);
    return this.offset;
  }

  /** Closes the file without finishing it (after a failure). */
  abort() {
    try {
      fs.closeSync(this.fd);
    } catch {
      /* already closed */
    }
  }
}
