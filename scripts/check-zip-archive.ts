import { createHistoryZipBlob, createZipBlob } from "../src/zipArchive";

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

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input) => {
  assert(String(input) === "https://cos.example.com/task/main.png", "Remote ZIP entries must fetch the COS URL.");
  return new Response(new TextEncoder().encode("remote-image"), {
    status: 200,
    headers: {
      "Content-Type": "image/png"
    }
  });
}) as typeof fetch;

try {
  const historyZip = await createHistoryZipBlob([
    {
      id: "data-url",
      imageDataUrl: `data:image/png;base64,${Buffer.from("data-url-image").toString("base64")}`,
      mimeType: "image/png",
      prompt: "data url",
      modelName: "gpt-image-2",
      protocol: "openai_images",
      aspectRatio: "1:1",
      imageSize: "1K",
      inputImageNames: [],
      createdAt: "2026-06-08T10:00:00.000Z"
    },
    {
      id: "cos-url",
      imageDataUrl: "https://cos.example.com/task/main.png",
      mimeType: "image/png",
      prompt: "cos url",
      modelName: "gpt-image-2",
      protocol: "openai_images",
      aspectRatio: "1:1",
      imageSize: "1K",
      inputImageNames: [],
      createdAt: "2026-06-08T10:00:01.000Z"
    }
  ]);
  const historyText = new TextDecoder().decode(new Uint8Array(await historyZip.arrayBuffer()));
  assert(historyText.includes("data-url-image"), "History ZIP must include bytes decoded from data URLs.");
  assert(historyText.includes("remote-image"), "History ZIP must include bytes fetched from remote image URLs.");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("ZIP archive checks passed.");
