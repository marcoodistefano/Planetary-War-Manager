const db = require("./postgresClient.js");
const redisClient = require("./redisClient.js");

const BAN_CACHE_TTL = 60;

const getBanStatus = async (userId) => {
  const cacheKey = `ban:${userId}`;
  const cached = await redisClient.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  const result = await db.query(
    `SELECT
       u.is_banned,
       u.is_perma_banned,
       EXISTS (
         SELECT 1
         FROM ban b
         WHERE b.id_user = u.id_user AND b.time_until > CURRENT_TIMESTAMP
       ) AS has_active_ban
     FROM utenti u
     WHERE u.id_user = $1`,
    [userId],
  );
  const row = result.rows[0] || {};
  const status = {
    isBanned: row.is_banned === true
      && (row.is_perma_banned === true || row.has_active_ban === true),
    isPermaBanned: row.is_perma_banned === true,
  };

  await redisClient.setEx(cacheKey, BAN_CACHE_TTL, JSON.stringify(status));
  return status;
};

const invalidateBanStatus = async (userId) => {
  await redisClient.del(`ban:${userId}`);
};

module.exports = { getBanStatus, invalidateBanStatus };
