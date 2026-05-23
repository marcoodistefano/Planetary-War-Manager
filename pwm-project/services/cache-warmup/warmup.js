const { createClient } = require("redis");
const { Pool } = require("pg");

const parseIntSafe = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const REDIS_URL = process.env.REDIS_URL || "redis://redis:6379";
const DB_URL = process.env.DB_URL || "postgres://commander_admin:secret@db:5432/pwm_tactical_database";
const MATCH_SERVICE_URL = process.env.MATCH_SERVICE_URL || "http://match-service:3004";

const LEADERBOARD_KEY = process.env.LEADERBOARD_KEY || "Leaderboard";
const MATCHES_JOINABLE_KEY = process.env.MATCHES_JOINABLE_KEY || "Matches:Joinable";
const GLOBAL_LIMIT = parseIntSafe(process.env.LEADERBOARD_GLOBAL_LIMIT, 1000);
const REGIONAL_LIMIT = parseIntSafe(process.env.LEADERBOARD_REGIONAL_LIMIT, 100);
const LOOP_DELAY_MS = parseIntSafe(process.env.WARMUP_LOOP_DELAY_MS, 15000);

const redis = createClient({ url: REDIS_URL });
const db = new Pool({ connectionString: DB_URL });

redis.on("error", (err) => {
  console.error("[CACHE_WARMUP] Redis error:", err.message);
});

db.on("error", (err) => {
  console.error("[CACHE_WARMUP] Postgres error:", err.message);
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getInfoValue = (info, key) => {
  const line = info
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${key}:`));
  return line ? line.split(":")[1] : null;
};

const getRedisRunId = async () => {
  const info = await redis.info("server");
  return getInfoValue(info, "run_id");
};

const waitForRedis = async () => {
  while (true) {
    try {
      if (!redis.isOpen) {
        await redis.connect();
      }
      await redis.ping();
      return;
    } catch (err) {
      console.log("[CACHE_WARMUP] Redis non pronto, attendo...");
      await sleep(1000);
    }
  }
};

const waitForDb = async () => {
  while (true) {
    try {
      await db.query("SELECT 1");
      return;
    } catch (err) {
      console.log("[CACHE_WARMUP] Postgres non pronto, attendo...");
      await sleep(1000);
    }
  }
};

const buildPlayerMap = (rows) => {
  const result = {};
  rows.forEach((row, index) => {
    result[`player${index + 1}`] = {
      username: row.username,
      ELO: row.elo_rating,
    };
  });
  return result;
};

const loadLeaderboards = async () => {
  const globalQuery = "SELECT username, elo_rating FROM utenti ORDER BY elo_rating DESC LIMIT $1";
  const globalRows = (await db.query(globalQuery, [GLOBAL_LIMIT])).rows;

  const regionalQuery = `
    SELECT reg, username, elo_rating
    FROM (
      SELECT reg, username, elo_rating,
             ROW_NUMBER() OVER (PARTITION BY reg ORDER BY elo_rating DESC) AS rn
      FROM utenti
      WHERE reg IS NOT NULL AND reg <> ''
    ) ranked
    WHERE rn <= $1
    ORDER BY reg, rn
  `;
  const regionalRows = (await db.query(regionalQuery, [REGIONAL_LIMIT])).rows;

  const regionale = {};
  const counters = {};
  regionalRows.forEach((row) => {
    const region = row.reg;
    if (!regionale[region]) {
      regionale[region] = { nome: region, lead_b: {} };
      counters[region] = 0;
    }
    counters[region] += 1;
    regionale[region].lead_b[`player${counters[region]}`] = {
      username: row.username,
      ELO: row.elo_rating,
    };
  });

  return {
    globale: buildPlayerMap(globalRows),
    regionale,
  };
};

const fetchJoinableMatches = async () => {
  const url = new URL("/match/joinable", MATCH_SERVICE_URL).toString();
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Match service non disponibile (status ${response.status})`);
  }
  const payload = await response.json();
  if (!payload) return [];
  if (Array.isArray(payload.matches)) return payload.matches;
  if (Array.isArray(payload.data)) return payload.data;
  return [];
};

const runWarmup = async (runId) => {
  await waitForDb();

  const leaderboard = await loadLeaderboards();
  const joinableMatches = await fetchJoinableMatches();

  const multi = redis.multi();
  multi.set(LEADERBOARD_KEY, JSON.stringify(leaderboard));
  multi.set(MATCHES_JOINABLE_KEY, JSON.stringify(joinableMatches));
  multi.set("cache_warmup:run_id", runId);
  multi.set("cache_warmup:last_run", new Date().toISOString());
  await multi.exec();

  console.log("[CACHE_WARMUP] Cache popolata correttamente.");
};

const startLoop = async () => {
  await waitForRedis();

  while (true) {
    try {
      const runId = await getRedisRunId();
      if (!runId) {
        throw new Error("run_id Redis mancante");
      }
      const cachedRunId = await redis.get("cache_warmup:run_id");

      if (cachedRunId !== runId) {
        console.log("[CACHE_WARMUP] Avvio warmup per Redis run_id:", runId);
        await runWarmup(runId);
      }
    } catch (err) {
      console.error("[CACHE_WARMUP] Errore warmup:", err.message);
    }

    await sleep(LOOP_DELAY_MS);
  }
};

startLoop().catch((err) => {
  console.error("[CACHE_WARMUP] Errore critico:", err.message);
  process.exit(1);
});
