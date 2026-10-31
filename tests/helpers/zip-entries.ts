import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';

export type ZipEntry = {
  name: string;
  mode: number;
  modifiedAt: Date;
  data: Uint8Array;
};

const END_RECORD_SIGNATURE = 0x06054b50;

/** `unzipSync` returns names and bytes only, so modes and dates come from the central directory. */
export function readZipEntries(params: { path: string }): ZipEntry[] {
  const buffer = readFileSync(params.path);
  const dataByName = unzipSync(buffer);
  const endRecord = buffer.lastIndexOf(Buffer.from(new Uint32Array([END_RECORD_SIGNATURE]).buffer));
  const entryCount = buffer.readUInt16LE(endRecord + 10);

  let offset = buffer.readUInt32LE(endRecord + 16);

  return Array.from({ length: entryCount }, () => {
    const time = buffer.readUInt16LE(offset + 12);
    const date = buffer.readUInt16LE(offset + 14);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    const mode = buffer.readUInt32LE(offset + 38) >>> 16;

    offset += 46 + nameLength + extraLength + commentLength;

    return {
      name,
      mode,
      modifiedAt: new Date(
        (date >> 9) + 1980,
        ((date >> 5) & 0xf) - 1,
        date & 0x1f,
        time >> 11,
        (time >> 5) & 0x3f,
        (time & 0x1f) * 2,
      ),
      data: dataByName[name] ?? new Uint8Array(0),
    };
  });
}

export function requireZipEntry(params: { entries: ZipEntry[]; name: string }): ZipEntry {
  const entry = params.entries.find(({ name }) => name === params.name);

  if (!entry) {
    throw new Error(`no zip entry named ${params.name}`);
  }

  return entry;
}
