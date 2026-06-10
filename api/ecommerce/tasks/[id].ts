import { handleGetEcommerceTaskRequest } from "../../../server/ecommerce/http.js";

function sendJson(response: any, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

export default async function handler(request: any, response: any) {
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed.", task: null });
    return;
  }

  const result = await handleGetEcommerceTaskRequest({
    ...(request.query ?? {}),
    id: request.query?.id
  });
  sendJson(response, result.status, result.body);
}
