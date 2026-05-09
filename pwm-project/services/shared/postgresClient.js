const { Pool } = require("pg");

const parsePort = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const connectionString = process.env.DB_URL;

const pool = connectionString
  ? new Pool({ connectionString })
  : new Pool({
      host: process.env.DB_HOST || "db",
      user: process.env.DB_USER || "commander_admin",
      password: process.env.DB_PASSWORD || "secret",
      database: process.env.DB_NAME || "pwm_tactical_database",
      port: parsePort(process.env.DB_PORT, 5432),
    });

pool.on("error", (err) => {
  console.error("❌ Postgres pool error:", err);
});

module.exports = pool;
