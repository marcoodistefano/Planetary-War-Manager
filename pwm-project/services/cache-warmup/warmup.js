const { createClient } = require("redis");
const { Pool } = require("pg");
const fs = require("fs/promises");
const { createReadStream } = require("fs");
const readline = require("readline");
const path = require("path");

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
const MAX_ASSET_SIZE_BYTES = parseIntSafe(
  process.env.MAX_CACHED_ASSET_SIZE_BYTES,
  16 * 1024 * 1024,
);
const ASSET_ROOT_CANDIDATES = [
  process.env.ASSET_ROOT,
  "/app/assets",
  path.resolve(__dirname, "../../shared/assets"),
].filter(Boolean);
const ASSET_DIRECTORIES = ["2Dmodels", "map", "profile_icons"];
const ASSET_FILES = ["game_rules.json"];
const ASSET_PREFIXES = ["ETOPO", "lc_mcd12"];

const redis = createClient({ url: REDIS_URL });
const db = new Pool({ connectionString: DB_URL });

redis.on("error", (err) => {
  console.error("[CACHE_WARMUP] Redis error:", err.message);
});

db.on("error", (err) => {
  console.error("[CACHE_WARMUP] Postgres error:", err.message);
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const findExistingPath = async (candidates) => {
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch (err) {
      continue;
    }
  }
  return null;
};

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

const shouldLoadRootFile = (fileName) => {
  if (ASSET_FILES.includes(fileName)) return true;
  return ASSET_PREFIXES.some((prefix) => fileName.startsWith(prefix));
};

const collectAssets = async (assetRoot) => {
  const assetEntries = [];

  const visitDirectory = async (absoluteDir, relativeDir) => {
    const entries = await fs.readdir(absoluteDir, { withFileTypes: true });

    for (const entry of entries) {
      const relativePath = relativeDir ? path.posix.join(relativeDir, entry.name) : entry.name;
      const absolutePath = path.join(absoluteDir, entry.name);

      if (entry.isDirectory()) {
        await visitDirectory(absolutePath, relativePath);
        continue;
      }

      const stats = await fs.stat(absolutePath);

      assetEntries.push({
        key: `assets:${relativePath}`,
        relativePath,
        absolutePath,
        size: stats.size,
      });
    }
  };

  const rootEntries = await fs.readdir(assetRoot, { withFileTypes: true });

  for (const entry of rootEntries) {
    const absolutePath = path.join(assetRoot, entry.name);

    if (entry.isDirectory()) {
      if (ASSET_DIRECTORIES.includes(entry.name)) {
        await visitDirectory(absolutePath, entry.name);
      }
      continue;
    }

    if (shouldLoadRootFile(entry.name)) {
      const stats = await fs.stat(absolutePath);
      assetEntries.push({
        key: `assets:${entry.name}`,
        relativePath: entry.name,
        absolutePath,
        size: stats.size,
      });
    }
  }

  return assetEntries;
};

const loadAssetsToRedis = async () => {
  const assetRoot = await findExistingPath(ASSET_ROOT_CANDIDATES);
  if (!assetRoot) {
    throw new Error("cartella assets non trovata");
  }

  const assets = await collectAssets(assetRoot);
  if (assets.length === 0) {
    throw new Error("nessun asset da caricare trovato");
  }

  const multi = redis.multi();
  const manifestFiles = [];
  const skippedAssets = [];

  for (const asset of assets) {
    if (asset.size > MAX_ASSET_SIZE_BYTES) {
      skippedAssets.push(asset);
      continue;
    }

    const data = await fs.readFile(asset.absolutePath);
    multi.set(asset.key, data.toString("base64"));
    manifestFiles.push({ path: asset.relativePath, size: data.length });
  }

  multi.set(
    "assets:manifest",
    JSON.stringify({
      root: assetRoot,
      loadedAt: new Date().toISOString(),
      files: manifestFiles,
    }),
  );

  await multi.exec();
  console.log(`[CACHE_WARMUP] Caricati ${manifestFiles.length} asset in Redis.`);
  if (skippedAssets.length > 0) {
    const skippedPreview = skippedAssets.slice(0, 5).map((asset) => asset.relativePath).join(", ");
    console.log(
      `[CACHE_WARMUP] Saltati ${skippedAssets.length} asset troppo grandi per Redis (${skippedPreview}${skippedAssets.length > 5 ? ", ..." : ""}).`,
    );
  }
};

const shouldRunAssetWarmup = async (runId) => {
  const cachedRunId = await redis.get("cache_warmup:run_id");
  const manifest = await redis.get("assets:manifest");

  return cachedRunId !== runId || !manifest;
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
  const globalQuery = "SELECT username, elo_rating FROM utenti ORDER BY elo_rating DESC, created_at ASC, username ASC LIMIT $1";
  const globalRows = (await db.query(globalQuery, [GLOBAL_LIMIT])).rows;

  const regionalQuery = `
    SELECT reg, username, elo_rating
    FROM (
      SELECT reg, username, elo_rating,
             ROW_NUMBER() OVER (PARTITION BY reg ORDER BY elo_rating DESC, created_at ASC, username ASC) AS rn
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

const waitForMatchService = async () => {
  while (true) {
    try {
      await fetchJoinableMatches();
      return;
    } catch (err) {
      console.log("[CACHE_WARMUP] Match service non pronto, attendo...");
      await sleep(1000);
    }
  }
};

const loadMapDataForBackend = async () => {
  const assetRoot = await findExistingPath(ASSET_ROOT_CANDIDATES);
  if (!assetRoot) {
    console.log("[CACHE_WARMUP] Impossibile caricare dati backend mappa: cartella assets non trovata.");
    return;
  }

  const mapDir = path.join(assetRoot, "map");
  try {
    const entries = await fs.readdir(mapDir, { withFileTypes: true });

    let multi = redis.multi();
    let batchedCommands = 0;

    // File attualmente abilitati per il caricamento in cache backend
    const ENABLED_MAP_FILES = [
      "archs.json",
      "map.json",
      "minimum_path.json",
      "regions.json",
      "nations.json"
    ];

    for (const entry of entries) {
      if (entry.isDirectory() || !entry.name.endsWith(".json")) continue;

      if (!ENABLED_MAP_FILES.includes(entry.name)) {
        console.log(`[CACHE_WARMUP] Salto il caricamento backend di ${entry.name} (attualmente disabilitato).`);
        continue;
      }

      const absolutePath = path.join(mapDir, entry.name);
      const baseName = path.basename(entry.name, ".json");

      if (entry.name === "minimum_path.json") {
        console.log(`[CACHE_WARMUP] Caricamento in stream di ${entry.name} per il backend...`);
        const rl = readline.createInterface({
          input: createReadStream(absolutePath),
          crlfDelay: Infinity
        });

        for await (const line of rl) {
          const trimmed = line.trim();
          if (trimmed === "{" || trimmed === "}") continue;

          let jsonStr = trimmed;
          if (jsonStr.endsWith(",")) jsonStr = jsonStr.slice(0, -1);
          if (!jsonStr) continue;

          try {
            const obj = JSON.parse(`{${jsonStr}}`);
            const city = Object.keys(obj)[0];
            const paths = obj[city];

            multi.set(`map_data:minimum_path:${city}`, JSON.stringify(paths));
            batchedCommands++;

            if (batchedCommands > 1000) {
              await multi.exec();
              multi = redis.multi();
              batchedCommands = 0;
            }
          } catch (e) {
            console.error(`[CACHE_WARMUP] Errore parsing riga in minimum_path:`, e.message);
          }
        }
      } else {
        const content = await fs.readFile(absolutePath, "utf-8");
        multi.set(`map_data:${baseName}`, content);
        batchedCommands++;

        if (baseName === "regions") {
          console.log(`[CACHE_WARMUP] Calcolo adiacenze topologiche e template DB per regions...`);
          try {
            const r = JSON.parse(content);
            const objKey = Object.keys(r.objects)[0];
            const obj = r.objects[objKey];
            const arcsToPolygons = {};
            const adj = {};
            const blankTemplate = {};

            obj.geometries.forEach((geom, i) => {
              const provCode = geom.properties.adm1_code || String(i);
              const admin = geom.properties.admin || "World";

              adj[i] = {
                id: provCode,
                index: i,
                admin: admin,
                name: geom.properties.name || provCode,
                neighbors: new Set()
              };

              if (!blankTemplate[admin]) blankTemplate[admin] = {};
              blankTemplate[admin][provCode] = false;

              const addArc = (arc) => {
                const absoluteArc = arc < 0 ? ~arc : arc;
                if (!arcsToPolygons[absoluteArc]) arcsToPolygons[absoluteArc] = [];
                arcsToPolygons[absoluteArc].push(i);
              };

              if (geom.type === "Polygon") {
                (geom.arcs || []).forEach(ring => ring.forEach(addArc));
              } else if (geom.type === "MultiPolygon") {
                (geom.arcs || []).forEach(poly => poly.forEach(ring => ring.forEach(addArc)));
              }
            });

            for (const pols of Object.values(arcsToPolygons)) {
              if (pols.length > 1) {
                for (let x = 0; x < pols.length; x++) {
                  for (let y = x + 1; y < pols.length; y++) {
                    adj[pols[x]].neighbors.add(adj[pols[y]].index);
                    adj[pols[y]].neighbors.add(adj[pols[x]].index);
                  }
                }
              }
            }

            for (const key of Object.keys(adj)) {
              adj[key].neighbors = Array.from(adj[key].neighbors);
            }

            multi.set(`map_data:regions_adjacency`, JSON.stringify(adj));
            multi.set(`map_data:regions_blank_template`, JSON.stringify(blankTemplate));
            batchedCommands += 2;
            console.log(`[CACHE_WARMUP] Adiacenze e template calcolati per ${Object.keys(adj).length} regioni.`);
          } catch (parseError) {
            console.error(`[CACHE_WARMUP] Errore nel parsing di regions.json:`, parseError.message);
          }
        }
      }

      if (batchedCommands > 0) {
        await multi.exec();
      }

      console.log("[CACHE_WARMUP] Dati della mappa per il backend caricati su Redis con successo.");
    }
  } catch (err) {
    console.error("[CACHE_WARMUP] Errore durante il caricamento dei dati mappa per il backend:", err.message);
  }
};

const runWarmup = async (runId) => {
  await waitForDb();
  await waitForMatchService();

  await loadAssetsToRedis();
  await loadMapDataForBackend();
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
      if (await shouldRunAssetWarmup(runId)) {
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
