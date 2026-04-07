/**
 * PRG-05: resource-extract — List resources from PE files (icons, strings, version info).
 * Cross-platform: parses PE RSRC section from raw bytes.
 */
import { readFileSync } from 'node:fs';
import { buildSuccess, buildError, getPlatformName, parseArg } from './shared.js';
import type { SysIntResult } from '../../outputFormatter.js';

export interface ResourceRow {
  type: string;
  name: string | number;
  language: number;
  size: number;
  offset: number;
}

// PE resource type IDs
const RESOURCE_TYPES: Record<number, string> = {
  1: 'RT_CURSOR',
  2: 'RT_BITMAP',
  3: 'RT_ICON',
  4: 'RT_MENU',
  5: 'RT_DIALOG',
  6: 'RT_STRING',
  7: 'RT_FONTDIR',
  8: 'RT_FONT',
  9: 'RT_ACCELERATOR',
  10: 'RT_RCDATA',
  11: 'RT_MESSAGETABLE',
  12: 'RT_GROUP_CURSOR',
  14: 'RT_GROUP_ICON',
  16: 'RT_VERSION',
  17: 'RT_DLGINCLUDE',
  19: 'RT_PLUGPLAY',
  20: 'RT_VXD',
  21: 'RT_ANICURSOR',
  22: 'RT_ANIICON',
  23: 'RT_HTML',
  24: 'RT_MANIFEST',
};

/**
 * Parse PE resource directory from a buffer.
 * Finds the .rsrc section and enumerates type/name/language entries.
 * Returns empty array if no valid PE or RSRC section found.
 */
export function parsePEResources(buf: Buffer): ResourceRow[] {
  if (buf.length < 64) return [];

  // Check MZ signature
  if (buf[0] !== 0x4d || buf[1] !== 0x5a) return [];

  const peOffset = buf.readUInt32LE(0x3c);
  if (buf.length < peOffset + 4) return [];
  if (buf[peOffset] !== 0x50 || buf[peOffset + 1] !== 0x45) return [];

  const coffOffset = peOffset + 4;
  if (buf.length < coffOffset + 20) return [];

  const sectionCount = buf.readUInt16LE(coffOffset + 2);
  const optHeaderSize = buf.readUInt16LE(coffOffset + 16);
  const magic = buf.readUInt16LE(coffOffset + 20);
  const is64 = magic === 0x20b;

  // Data directory index 2 = resource table
  // Data directories start at optHeaderOffset + 96 (PE32) or + 112 (PE32+)
  const ddOffset = coffOffset + 20 + (is64 ? 112 : 96);
  if (buf.length < ddOffset + 8) return [];

  const rsrcRVA = buf.readUInt32LE(ddOffset + 8); // data dir[2].VirtualAddress
  const rsrcSize = buf.readUInt32LE(ddOffset + 12); // data dir[2].Size
  if (!rsrcRVA || !rsrcSize) return [];

  // Find the section that contains the resource RVA
  const sectionsStart = coffOffset + 20 + optHeaderSize;
  let rsrcFileOffset = 0;

  for (let i = 0; i < sectionCount; i++) {
    const sectOffset = sectionsStart + i * 40;
    if (buf.length < sectOffset + 40) break;

    const sectVA = buf.readUInt32LE(sectOffset + 12);
    const sectRawSize = buf.readUInt32LE(sectOffset + 16);
    const sectRawOffset = buf.readUInt32LE(sectOffset + 20);

    if (rsrcRVA >= sectVA && rsrcRVA < sectVA + sectRawSize) {
      rsrcFileOffset = sectRawOffset + (rsrcRVA - sectVA);
      break;
    }
  }

  if (!rsrcFileOffset || buf.length < rsrcFileOffset + 16) return [];

  const rows: ResourceRow[] = [];

  // Parse resource directory tree (3 levels: type → name → language)
  // Level 1: types
  const typeDir = rsrcFileOffset;
  if (buf.length < typeDir + 16) return [];

  const typeNameCount = buf.readUInt16LE(typeDir + 12);
  const typeIdCount = buf.readUInt16LE(typeDir + 14);
  const totalTypes = typeNameCount + typeIdCount;

  for (let t = 0; t < totalTypes && t < 50; t++) {
    const typeEntryOffset = typeDir + 16 + t * 8;
    if (buf.length < typeEntryOffset + 8) break;

    const typeId = buf.readUInt32LE(typeEntryOffset);
    const typeSubdirRVA = buf.readUInt32LE(typeEntryOffset + 4);
    if (!(typeSubdirRVA & 0x80000000)) continue; // must be subdirectory

    const typeName = typeId & 0x80000000
      ? `NAMED_TYPE_${typeId & 0x7fffffff}`
      : (RESOURCE_TYPES[typeId] ?? `RT_${typeId}`);

    const nameDir = rsrcFileOffset + (typeSubdirRVA & 0x7fffffff);
    if (buf.length < nameDir + 16) continue;

    const nameNameCount = buf.readUInt16LE(nameDir + 12);
    const nameIdCount = buf.readUInt16LE(nameDir + 14);
    const totalNames = nameNameCount + nameIdCount;

    for (let n = 0; n < totalNames && n < 50; n++) {
      const nameEntryOffset = nameDir + 16 + n * 8;
      if (buf.length < nameEntryOffset + 8) break;

      const nameId = buf.readUInt32LE(nameEntryOffset);
      const nameSubdirRVA = buf.readUInt32LE(nameEntryOffset + 4);
      if (!(nameSubdirRVA & 0x80000000)) continue;

      const resName: string | number = nameId & 0x80000000
        ? `name_${nameId & 0x7fffffff}`
        : nameId;

      const langDir = rsrcFileOffset + (nameSubdirRVA & 0x7fffffff);
      if (buf.length < langDir + 16) continue;

      const langIdCount = buf.readUInt16LE(langDir + 14);
      const langNameCount = buf.readUInt16LE(langDir + 12);
      const totalLangs = langIdCount + langNameCount;

      for (let l = 0; l < totalLangs && l < 20; l++) {
        const langEntryOffset = langDir + 16 + l * 8;
        if (buf.length < langEntryOffset + 8) break;

        const langId = buf.readUInt32LE(langEntryOffset) & 0x7fffffff;
        const dataLeafRVA = buf.readUInt32LE(langEntryOffset + 4);
        if (dataLeafRVA & 0x80000000) continue; // should be leaf

        // Data entry
        const dataOffset = rsrcFileOffset + dataLeafRVA;
        if (buf.length < dataOffset + 16) continue;

        const dataRVA = buf.readUInt32LE(dataOffset);
        const dataSize = buf.readUInt32LE(dataOffset + 4);
        rows.push({
          type: typeName,
          name: resName,
          language: langId,
          size: dataSize,
          offset: dataRVA,
        });
      }
    }
  }

  return rows;
}

async function runResourceExtract(args: string[]): Promise<SysIntResult> {
  const platform = getPlatformName();
  const filePath = parseArg(args, '--file');
  if (!filePath) {
    return buildError('resource-extract requires --file <path>', 'EXEC_FAILED', 'resource-extract');
  }

  const typeFilter = (parseArg(args, '--type') ?? 'all').toLowerCase();

  try {
    const buf = readFileSync(filePath);
    let rows = parsePEResources(buf);

    if (typeFilter !== 'all') {
      const typeMap: Record<string, string[]> = {
        icon: ['RT_ICON', 'RT_GROUP_ICON', 'RT_CURSOR', 'RT_GROUP_CURSOR'],
        string: ['RT_STRING'],
        version: ['RT_VERSION'],
        manifest: ['RT_MANIFEST'],
      };
      const allowed = typeMap[typeFilter];
      if (allowed) {
        rows = rows.filter((r) => allowed.includes(r.type));
      }
    }

    return buildSuccess(rows, 'resource-extract', platform);
  } catch (err) {
    return buildError(`resource-extract failed: ${String(err)}`, 'EXEC_FAILED', 'resource-extract');
  }
}

export async function run(toolId: string, args: string[]): Promise<SysIntResult> {
  if (toolId === 'resource-extract') return runResourceExtract(args);
  return buildError(`No handler for tool: ${toolId}`, 'EXEC_FAILED', toolId);
}
