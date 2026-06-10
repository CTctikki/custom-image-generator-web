import { handleListEcommerceTasksRequest } from "../../server/ecommerce/http.js";

function sendJson(response: any, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

export default async function handler(request: any, response: any) {
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed.", tasks: [] });
    return;
  }

  const result = await handleListEcommerceTasksRequest(request.query ?? {});
  sendJson(response, result.status, result.body);
}
