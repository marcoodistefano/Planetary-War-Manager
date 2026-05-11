const express = require("express");
const cors = require("cors");
const app = express();
const controller = require("./app-controller.js");

const SERVICE_TARGETS = {
  auth: process.env.AUTH_SERVICE_URL || "http://auth-service:3000",
  match: process.env.MATCH_SERVICE_URL || "http://match-service:3000",
};

const hopByHopHeaders = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const buildForwardHeaders = (headers, hasJsonBody) => {
  const forwardedHeaders = {};

  for (const [name, value] of Object.entries(headers ?? {})) {
    if (hopByHopHeaders.has(name.toLowerCase())) {
      continue;
    }

    forwardedHeaders[name] = value;
  }

  if (hasJsonBody) {
    forwardedHeaders["content-type"] = "application/json";
  }

  return forwardedHeaders;
};

const forwardRequest = async (req, res, targetBaseUrl, safeRequest) => {
  const targetUrl = new URL(req.originalUrl, targetBaseUrl);
  const hasBody =
    !["GET", "HEAD"].includes(req.method) &&
    safeRequest.body &&
    Object.keys(safeRequest.body).length > 0;

  const response = await fetch(targetUrl, {
    method: req.method,
    headers: buildForwardHeaders(req.headers, hasBody),
    body: hasBody ? JSON.stringify(safeRequest.body) : undefined,
  });

  const payload = await response.text();

  response.headers.forEach((value, key) => {
    if (!hopByHopHeaders.has(key.toLowerCase())) {
      res.setHeader(key, value);
    }
  });

  return res.status(response.status).send(payload);
};

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use(async (req, res, next) => {
  if (req.path === "/health") {
    return next();
  }

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  try {
    const safeRequest = await controller.normalizePayload(req);

    if (!safeRequest.isValid) {
      return res.status(400).json(safeRequest.body);
    }

    req.safeRequest = safeRequest;
    return next();
  } catch (error) {
    console.error("Errore nel controller gateway:", error);
    return res.status(500).json({
      error: "Errore interno del gateway",
      details: error.message,
    });
  }
});

app.use(async (req, res) => {
  if (req.path === "/health") {
    return res.json({ status: "ok" });
  }

  const routeGroup = req.safeRequest?.routeGroup;
  const targetBaseUrl = routeGroup ? SERVICE_TARGETS[routeGroup] : null;

  if (!targetBaseUrl) {
    return res.status(404).json({
      error: "Route gateway non gestita",
      path: req.originalUrl,
    });
  }

  try {
    return await forwardRequest(req, res, targetBaseUrl, req.safeRequest);
  } catch (error) {
    console.error("Errore nel forwarding gateway:", error);
    return res.status(502).json({
      error: "Impossibile contattare il servizio di destinazione",
      details: error.message,
    });
  }
});

const PORT = parseInt(process.env.PORT ?? "", 10) || 3001;

app.listen(PORT, () =>
  console.log(`App-route attivo su http://app-route:${PORT}`),
);