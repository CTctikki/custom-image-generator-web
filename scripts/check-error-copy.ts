import { toUserFacingError } from "../src/api";

function assertEqual(actual: string, expected: string) {
  if (actual !== expected) {
    throw new Error(`Expected "${expected}" but received "${actual}".`);
  }
}

assertEqual(toUserFacingError(new Error("401 Unauthorized")), "API Key 无效或权限不足，请检查 Key 是否填写正确。");
assertEqual(toUserFacingError(new Error("429 Too Many Requests")), "请求太频繁了，请稍等一会儿再试，或把生成数量调低。");
assertEqual(toUserFacingError(new Error("405 Method Not Allowed")), "上游接口不支持当前请求方式，请刷新模型列表后重试。");
assertEqual(toUserFacingError(new Error("Unexpected token '<', <!doctype html> is not valid JSON")), "上游返回了非标准响应，可能是接口临时异常，请稍后重试。");
assertEqual(toUserFacingError(new Error("Failed to fetch")), "网络请求失败，可能是网络波动或上游跨域配置异常。");

console.log("Chinese error copy checks passed.");
