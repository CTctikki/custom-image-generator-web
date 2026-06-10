import type { HistoryItem } from "./types";

interface ZipEntry {
  fileName: string;
  bytes: Uint8Array;
  date?: Date;
}

const textEncoder = new TextEncoder();
const crcTable = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(input = new Date()) {
  const year = Math.max(1980, input.getFullYear());
  const month = input.getMonth() + 1;
  const day = input.getDate();
  const hours = input.getHours();
  const minutes = input.getMinutes();
  const seconds = Math.floor(input.getSeconds() / 2);

  return {
    date: ((year - 1980) << 9) | (month << 5) | day,
    time: (hours << 11) | (minutes << 5) | seconds
  };
}

function writeUint16(target: number[], value: number) {
  target.push(value & 0xff, (value >>> 8) & 0xff);
}

function writeUint32(target: number[], value: number) {
  target.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function appendBytes(target: number[], bytes: Uint8Array) {
  for (const byte of bytes) {
    target.push(byte);
  }
}

function sanitizeFileName(value: string) {
  return value.replace(/[<>:"\\|?*\u0000-\u001f]/g, "-").replace(/\s+/g, "-").slice(0, 80);
}

function extensionFromMimeType(mimeType: string) {
  if (mimeType.includes("webp")) {
    return "webp";
  }
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) {
    return "jpg";
  }
  return "png";
}

function bytesFromDataUrl(dataUrl: string) {
  const [, payload] = dataUrl.match(/^data:[^;,]+;base64,(.+)$/) ?? [];
  if (!payload) {
    throw new Error("无法读取图片数据。");
  }

  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function bytesFromImageSource(source: string) {
  if (source.startsWith("data:")) {
    return bytesFromDataUrl(source);
  }

  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`图片下载失败：${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export function createZipBlob(entries: ZipEntry[]) {
  const fileRecords: Array<{ centralHeader: number[] }> = [];
  const output: number[] = [];

  entries.forEach((entry) => {
    const fileNameBytes = textEncoder.encode(entry.fileName);
    const checksum = crc32(entry.bytes);
    const { date, time } = dosDateTime(entry.date);
    const localOffset = output.length;

    writeUint32(output, 0x04034b50);
    writeUint16(output, 20);
    writeUint16(output, 0);
    writeUint16(output, 0);
    writeUint16(output, time);
    writeUint16(output, date);
    writeUint32(output, checksum);
    writeUint32(output, entry.bytes.length);
    writeUint32(output, entry.bytes.length);
    writeUint16(output, fileNameBytes.length);
    writeUint16(output, 0);
    appendBytes(output, fileNameBytes);
    appendBytes(output, entry.bytes);

    const centralHeader: number[] = [];
    writeUint32(centralHeader, 0x02014b50);
    writeUint16(centralHeader, 20);
    writeUint16(centralHeader, 20);
    writeUint16(centralHeader, 0);
    writeUint16(centralHeader, 0);
    writeUint16(centralHeader, time);
    writeUint16(centralHeader, date);
    writeUint32(centralHeader, checksum);
    writeUint32(centralHeader, entry.bytes.length);
    writeUint32(centralHeader, entry.bytes.length);
    writeUint16(centralHeader, fileNameBytes.length);
    writeUint16(centralHeader, 0);
    writeUint16(centralHeader, 0);
    writeUint16(centralHeader, 0);
    writeUint16(centralHeader, 0);
    writeUint32(centralHeader, 0);
    writeUint32(centralHeader, localOffset);
    appendBytes(centralHeader, fileNameBytes);
    fileRecords.push({ centralHeader });
  });

  const centralDirectoryOffset = output.length;
  fileRecords.forEach((record) => appendBytes(output, new Uint8Array(record.centralHeader)));
  const centralDirectorySize = output.length - centralDirectoryOffset;

  writeUint32(output, 0x06054b50);
  writeUint16(output, 0);
  writeUint16(output, 0);
  writeUint16(output, entries.length);
  writeUint16(output, entries.length);
  writeUint32(output, centralDirectorySize);
  writeUint32(output, centralDirectoryOffset);
  writeUint16(output, 0);

  return new Blob([new Uint8Array(output)], { type: "application/zip" });
}

export async function createHistoryZipBlob(items: HistoryItem[]) {
  const entries = await Promise.all(items.map(async (item, index) => {
    const createdAt = new Date(item.createdAt);
    const timestamp = item.createdAt.replace(/[:.]/g, "-");
    const fileName = `${String(index + 1).padStart(2, "0")}-${sanitizeFileName(timestamp)}.${extensionFromMimeType(item.mimeType)}`;
    return {
      fileName,
      bytes: await bytesFromImageSource(item.imageDataUrl),
      date: Number.isNaN(createdAt.getTime()) ? new Date() : createdAt
    };
  }));

  return createZipBlob(entries);
}

export async function downloadHistoryAsZip(items: HistoryItem[]) {
  const zip = await createHistoryZipBlob(items);
  const anchor = document.createElement("a");
  const objectUrl = URL.createObjectURL(zip);
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  anchor.href = objectUrl;
  anchor.download = `image-studio-${timestamp}.zip`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
