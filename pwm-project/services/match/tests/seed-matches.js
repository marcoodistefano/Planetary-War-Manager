const baseUrl = process.env.GATEWAY_URL || "http://localhost:4000";
const matchServiceUrl = process.env.MATCH_SERVICE_URL || "http://localhost:3001";
const authTokensRaw = process.env.AUTH_TOKENS || process.env.AUTH_TOKEN || "";

const authTokens = authTokensRaw
  .split(",")
  .map((token) => token.trim())
  .filter(Boolean);

const useGateway = authTokens.length > 0;

if (authTokens.length === 0) {
  console.error("[SEED] Missing AUTH_TOKEN/AUTH_TOKENS.");
  process.exit(1);
}

const payloads = [
  {
    squad: false,
    alleanzeConsentite: false,
    ranked: true,
    alleanzeWin: false,
    randomSpawn: true,
    maxPlayers: "10",
    duration: "7 giorni",
    moltiplicatoreTemporale: "x1",
    modalita: "Tutti contro tutti",
    regioni: ["World"],
    hasElo: true,
  },
  {
    squad: true,
    alleanzeConsentite: true,
    ranked: false,
    alleanzeWin: true,
    randomSpawn: false,
    maxPlayers: "2v2",
    duration: "10 giorni",
    moltiplicatoreTemporale: "x10",
    modalita: "Domination",
    regioni: ["Europe"],
    hasElo: false,
  },
  {
    squad: false,
    alleanzeConsentite: true,
    ranked: false,
    alleanzeWin: true,
    randomSpawn: true,
    maxPlayers: "50",
    duration: "14 giorni",
    moltiplicatoreTemporale: "x3",
    modalita: "Capture the Flag",
    regioni: ["Asia"],
    hasElo: false,
  },
];

const postMatch = async ({ payload, token }) => {
  const targetUrl = useGateway
    ? new URL("/match/create", baseUrl)
    : new URL("/match/create", matchServiceUrl);

  const headers = { "Content-Type": "application/json" };
  headers.Authorization = `Bearer ${token}`;

  const response = await fetch(targetUrl.toString(), {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch (error) {
    body = { raw: text };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      body,
    };
  }

  return { ok: true, status: response.status, body };
};

const run = async () => {
  const jobs = [];

  authTokens.forEach((token, index) => {
    const payload = payloads[index % payloads.length];
    jobs.push({ token, payload });
  });

  console.log(`[SEED] Creating ${jobs.length} match(es)...`);

  for (let i = 0; i < jobs.length; i += 1) {
    const { token, payload } = jobs[i];
    try {
      const result = await postMatch({ payload, token });
      if (result.ok) {
        console.log(`[SEED] Match ${i + 1} OK:`, result.body?.data?.matchId || result.body);
      } else {
        console.log(`[SEED] Match ${i + 1} FAILED (${result.status}):`, result.body);
      }
    } catch (error) {
      console.error(`[SEED] Match ${i + 1} ERROR:`, error.message);
    }
  }
};

run().catch((error) => {
  console.error("[SEED] Fatal error:", error.message);
  process.exit(1);
});
