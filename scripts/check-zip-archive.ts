import { createZipBlob } from "../src/zipArchive";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const zip = createZipBlob([
  {
    fileName: "first.txt",
    bytes: new TextEncoder().encode("hello"),
    date: new Date("2026-05-18T00:00:00.000Z")
  },
  {
    fileName: "folder/second.txt",
    bytes: new TextEncoder().encode("world"),
    date: new Date("2026-05-18T00:01:00.000Z")
  }
]);

const buffer = new Uint8Array(await zip.arrayBuffer());
const text = new TextDecoder().decode(buffer);

assert(zip.type === "application/zip", "ZIP blob must use application/zip.");
assert(buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04, "ZIP must start with a local file header.");
assert(text.includes("first.txt"), "ZIP must include the first filename.");
assert(text.includes("folder/second.txt"), "ZIP must include nested filenames.");
assert(
  buffer.some((value, index) => value === 0x50 && buffer[index + 1] === 0x4b && buffer[index + 2] === 0x05 && buffer[index + 3] === 0x06),
  "ZIP must include an end of central directory record."
);

console.log("ZIP archive checks passed.");
