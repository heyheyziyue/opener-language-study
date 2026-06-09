// CORS 工具：跨域头 + JSON 响应构造 + OPTIONS 预检
// 同一 EdgeOne Pages 域名下不需要 CORS，但本地开发时（Vite 5173 调 EdgeOne
// 本地服务）就需要放开。前端部署到 EdgeOne 后可以把 Allow-Origin 收紧到具体域名。

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

/** 构造 JSON 响应 */
export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

/** OPTIONS 预检：返回 204 */
export function handleOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
