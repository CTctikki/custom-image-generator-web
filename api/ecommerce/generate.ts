import { waitUntil } from "@vercel/functions";
import { handleCreateEcommerceTaskRequest } from "../../server/ecommerce/http.js";

async function readBody(request: any) {
  if (request.body && typeof request.body === "object") {
    return request.body;
  }
  if (typeof request.body === "string") {
    return JSON.parse(request.body);
  }

  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? JSON.parse(text) : {};
}

function sendJson(response: any, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

export default async function handler(request: any, response: any) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  const result = await handleCreateEcommerceTaskRequest(await readBody(request), {
    enqueueTask: (job) => {
      waitUntil(job());
    }
  });
  sendJson(response, result.status, result.body);
}
