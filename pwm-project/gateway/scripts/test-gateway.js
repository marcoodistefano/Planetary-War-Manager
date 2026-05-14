const crypto = require("crypto");
const net = require("net");

const BASE_URL = process.env.BASE_URL || "http://localhost:4000";
const AUTH_TOKEN = process.env.AUTH_TOKEN || "";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const httpRequest = async (method, path, body) => {
  const url = new URL(path, BASE_URL);
  const hasBody = body !== undefined;
  const headers = {};

  if (hasBody) {
    headers["content-type"] = "application/json";
  }

  if (AUTH_TOKEN) {
    headers.authorization = `Bearer ${AUTH_TOKEN}`;
  }

  const response = await fetch(url, {
    method,
    headers,
    body: hasBody ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  return { status: response.status, text };
};

const websocketHandshake = (path) =>
  new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const key = crypto.randomBytes(16).toString("base64");
    const port = url.port || (url.protocol === "https:" ? 443 : 80);
    const host = url.hostname;

    const socket = net.connect(port, host, () => {
      const headers = [
        `GET ${url.pathname} HTTP/1.1`,
        `Host: ${url.host}`,
        "Connection: Upgrade",
        "Upgrade: websocket",
        "Sec-WebSocket-Version: 13",
        `Sec-WebSocket-Key: ${key}`,
      ];

      if (AUTH_TOKEN) {
        headers.push(`Authorization: Bearer ${AUTH_TOKEN}`);
      }

      socket.write(`${headers.join("\r\n")}\r\n\r\n`);
    });

    socket.setTimeout(4000, () => {
      socket.destroy();
      reject(new Error("Timeout handshake"));
    });

    socket.once("data", (chunk) => {
      const responseLine = chunk.toString("utf8").split("\r\n")[0];
      const statusMatch = responseLine.match(/HTTP\/1\.1\s+(\d+)/i);
      const status = statusMatch ? Number(statusMatch[1]) : 0;
      socket.destroy();
      resolve({ status, line: responseLine });
    });

    socket.once("error", (error) => {
      reject(error);
    });
  });

const run = async () => {
  console.log(`BASE_URL: ${BASE_URL}`);
  console.log(`AUTH_TOKEN provided: ${AUTH_TOKEN ? "yes" : "no"}`);

  const health = await httpRequest("GET", "/health");
  console.log("/health", health.status);

  const protectedResult = await httpRequest("GET", "/match/health");
  console.log("/match/health", protectedResult.status);
  if (!AUTH_TOKEN && protectedResult.status !== 401) {
    throw new Error("Expected 401 for /match/health without token");
  }
  if (AUTH_TOKEN && protectedResult.status === 401) {
    throw new Error("Unexpected 401 for /match/health with token");
  }

  await wait(200);
  try {
    const wsResult = await websocketHandshake("/match");
    console.log("WS /match", wsResult.status, wsResult.line);
    if (!AUTH_TOKEN && wsResult.status !== 401) {
      throw new Error("Expected 401 for WS /match without token");
    }
    if (AUTH_TOKEN && wsResult.status === 401) {
      throw new Error("Unexpected 401 for WS /match with token");
    }
  } catch (error) {
    console.error("WS handshake error:", error.message);
    throw error;
  }
};

run().catch((error) => {
  console.error("Test failed:", error);
  process.exit(1);
});
