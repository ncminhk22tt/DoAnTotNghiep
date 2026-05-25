const fs = require("fs");
const path = require("path");

function loadEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

function assertTrue(cond, message) {
  if (!cond) throw new Error(message);
}

async function postJson(baseUrl, pathName, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${pathName}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function getJson(baseUrl, pathName, token) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${pathName}`, { method: "GET", headers });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function main() {
  loadEnv();

  const baseUrl = process.env.API_BASE_URL || "http://localhost:3000";
  const phone = process.env.TEST_ADMIN_PHONE || process.env.ADMIN_PHONE || "+84900000000";
  const password = process.env.TEST_ADMIN_PASSWORD || "123456";

  console.log(`Smoke test at ${baseUrl}`);

  const loginRes = await postJson(baseUrl, "/api/auth/login", { phone, password });
  assertTrue(loginRes.status === 200, `Login fail: ${loginRes.status}`);
  assertTrue(Boolean(loginRes.json?.token), "Login khong tra access token");
  assertTrue(Boolean(loginRes.json?.refresh_token), "Login khong tra refresh token");

  const accessToken = loginRes.json.token;
  const refreshToken = loginRes.json.refresh_token;

  const usersRes = await getJson(baseUrl, "/api/admin/users", accessToken);
  assertTrue(usersRes.status === 200, `GET /api/admin/users fail: ${usersRes.status}`);

  const refreshRes = await postJson(baseUrl, "/api/auth/refresh", { refresh_token: refreshToken });
  assertTrue(refreshRes.status === 200, `Refresh fail: ${refreshRes.status}`);
  assertTrue(Boolean(refreshRes.json?.token), "Refresh khong tra access token moi");
  assertTrue(Boolean(refreshRes.json?.refresh_token), "Refresh khong tra refresh token moi");

  const logoutRes = await postJson(
    baseUrl,
    "/api/auth/logout",
    { refresh_token: refreshRes.json.refresh_token },
    refreshRes.json.token
  );
  assertTrue(logoutRes.status === 200, `Logout fail: ${logoutRes.status}`);

  console.log("PASS: test-api-smoke");
}

main().catch((error) => {
  console.error("FAIL: test-api-smoke");
  console.error(error.message || error);
  process.exit(1);
});
