import { ascii, be16, be32, box, boxRaw, concat } from './boxes';
import type { MediaIO } from './io';
import { parseMp4 } from './mp4/reader';
import { interleave, planOutput, writeMuxed } from './mp4/writer';

export interface TagMeta {
  title?: string;
  artist?: string;
  album?: string;
}

const COPY_CHUNK = 1 << 20;

function utf16le(value: string): Uint8Array {
  const out = new Uint8Array(2 + value.length * 2);
  out[0] = 0xff;
  out[1] = 0xfe;
  let off = 2;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    out[off++] = code & 0xff;
    out[off++] = code >> 8;
  }
  return out;
}

// id3v2.3 size field — 7 bits per byte
function syncsafe(value: number): Uint8Array {
  return new Uint8Array([
    (value >> 21) & 0x7f,
    (value >> 14) & 0x7f,
    (value >> 7) & 0x7f,
    value & 0x7f,
  ]);
}

function id3TextFrame(id: string, value: string): Uint8Array | null {
  if (value.length === 0) return null;
  // pure ascii stays latin1 (enc 0); anything else gets utf16 with bom
  const asciiOnly = /^[\x20-\x7e]*$/u.test(value);
  const payload = asciiOnly ? concat(new Uint8Array([0]), ascii(value)) : concat(new Uint8Array([1]), utf16le(value));
  return concat(ascii(id), be32(payload.length), be16(0), payload);
}

function sniffMime(bytes: Uint8Array): 'image/jpeg' | 'image/png' | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  return null;
}

function id3ApicFrame(cover: Uint8Array): Uint8Array | null {
  const mime = sniffMime(cover);
  if (mime === null) return null;
  // enc 0, mime, picture type 3 (front cover), empty description
  const payload = concat(new Uint8Array([0]), ascii(mime), new Uint8Array([0, 3, 0]), cover);
  return concat(ascii('APIC'), be32(payload.length), be16(0), payload);
}

// whole id3v2.3 tag (header + frames); empty when nothing to write
export function buildId3v2(meta: TagMeta, cover: Uint8Array | null): Uint8Array {
  const frames: Uint8Array[] = [];
  const apic = cover ? id3ApicFrame(cover) : null;
  if (apic) frames.push(apic);
  for (const [id, value] of [['TIT2', meta.title], ['TPE1', meta.artist], ['TALB', meta.album]] as const) {
    const frame = value === undefined ? null : id3TextFrame(id, value);
    if (frame) frames.push(frame);
  }
  const body = concat(...frames);
  if (body.length === 0) return new Uint8Array(0);
  return concat(ascii('ID3'), new Uint8Array([3, 0, 0]), syncsafe(body.length), body);
}

// data box: type 1 = utf8 text, 13 = picture
function dataBox(type: number, payload: Uint8Array): Uint8Array {
  return box('data', concat(be32(type), be32(0), payload));
}

function ilstTextItem(id: Uint8Array, value: string): Uint8Array {
  return boxRaw(id, dataBox(1, ascii(value)));
}

// 0xa9 + ascii, matching apple's latin-1 atom ids (not utf-8 ©)
const ATOM_NAM = new Uint8Array([0xa9, 0x6e, 0x61, 0x6d]);
const ATOM_ART = new Uint8Array([0xa9, 0x41, 0x52, 0x54]);
const ATOM_ALB = new Uint8Array([0xa9, 0x61, 0x6c, 0x62]);

// udta > meta(hdlr mdir/appl + ilst) — null when no tags or cover
export function buildUdta(meta: TagMeta, cover: Uint8Array | null): Uint8Array | null {
  const items: Uint8Array[] = [];
  for (const [id, value] of [[ATOM_NAM, meta.title], [ATOM_ART, meta.artist], [ATOM_ALB, meta.album]] as const) {
    if (value !== undefined && value.length > 0) items.push(ilstTextItem(id, value));
  }
  if (cover && sniffMime(cover)) items.push(box('covr', dataBox(13, cover)));
  if (items.length === 0) return null;
  const hdlr = box('hdlr', concat(be32(0), be32(0), ascii('mdir'), be32(0), be32(0), be32(0), ascii('appl'), new Uint8Array([0])));
  return box('udta', box('meta', concat(be32(0), hdlr, box('ilst', concat(...items)))));
}

async function tagMp3(
  io: MediaIO,
  srcPath: string,
  outPath: string,
  tag: Uint8Array
): Promise<boolean> {
  try {
    const size = await io.size(srcPath);
    await io.create(outPath);
    if (tag.length > 0) await io.write(outPath, tag, 0);
    let off = 0;
    while (off < size) {
      const len = Math.min(COPY_CHUNK, size - off);
      const bytes = await io.read(srcPath, off, len);
      await io.write(outPath, bytes, off + tag.length);
      off += bytes.length;
    }
    return true;
  } catch {
    return false;
  }
}

async function tagM4a(
  io: MediaIO,
  srcPath: string,
  outPath: string,
  meta: TagMeta,
  cover: Uint8Array | null
): Promise<boolean> {
  try {
    const info = await parseMp4(io, srcPath, await io.size(srcPath));
    const audio = info.tracks.find((t) => t.kind === 'audio');
    if (!audio) return false;
    const udta = buildUdta(meta, cover);
    const plan = planOutput(info, [audio], interleave([audio]), udta);
    await writeMuxed(io, outPath, plan, [{ path: srcPath, info }], [audio]);
    return true;
  } catch {
    return false;
  }
}

// mp3 -> id3v2.3 prepended; anything else -> m4a ilst atoms
export async function tagAudio(
  io: MediaIO,
  srcPath: string,
  outPath: string,
  meta: TagMeta,
  coverPath?: string
): Promise<boolean> {
  let cover: Uint8Array | null = null;
  if (coverPath !== undefined) {
    cover = await io.read(coverPath, 0, await io.size(coverPath));
  }
  if (outPath.toLowerCase().endsWith('.mp3')) {
    return tagMp3(io, srcPath, outPath, buildId3v2(meta, cover));
  }
  return tagM4a(io, srcPath, outPath, meta, cover);
}
