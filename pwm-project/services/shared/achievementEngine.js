const db = require("./postgresClient.js");

const CATALOG = [
  {
    code: "territories_single",
    name: "Espansione Territoriale",
    description: "Conquista 10 territori in una singola partita.",
    requirement: { metric: "territories_single", target: 10 },
    reward: { type: "elo", value: 50 },
  },
  {
    code: "kills_total",
    name: "Supremazia Bellica",
    description: "Elimina 50.000 unita nemiche complessive.",
    requirement: { metric: "kills_total", target: 50000 },
    reward: { type: "elo", value: 100 },
  },
  {
    code: "wins_total",
    name: "Comandante Vittorioso",
    description: "Vinci 3 partite.",
    requirement: { metric: "wins_total", target: 3 },
    reward: { type: "elo", value: 150 },
  },
];

const parseJson = (value, fallback) => {
  try {
    return typeof value === "string" ? JSON.parse(value) : value || fallback;
  } catch (_error) {
    return fallback;
  }
};

const ensureCatalog = async (client = db) => {
  for (const objective of CATALOG) {
    await client.query(
      `INSERT INTO obiettivi (nome_obbiettivo, descrizione, requisito, ricompensa)
       SELECT $1, $2, $3, $4
       WHERE NOT EXISTS (
         SELECT 1 FROM obiettivi WHERE requisito::jsonb ->> 'code' = $5
       )`,
      [
        objective.name,
        objective.description,
        JSON.stringify({ code: objective.code, ...objective.requirement }),
        JSON.stringify(objective.reward),
        objective.code,
      ],
    );
  }
};

const ensureUserObjectives = async (userId, client = db) => {
  await client.query(
    `INSERT INTO obiettivi_utente (id_user, id_obbiettivo)
     SELECT $1, o.id_obbiettivo
     FROM obiettivi o
     WHERE NOT EXISTS (
       SELECT 1 FROM obiettivi_utente ou
       WHERE ou.id_user = $1 AND ou.id_obbiettivo = o.id_obbiettivo
     )`,
    [userId],
  );
};

const updateForMatch = async (players, matchId, client = db) => {
  await ensureCatalog(client);
  for (const player of players) {
    if (player.isBot || player.username?.startsWith("Abbandonato_")) continue;

    let userId = player.userId;
    if (!userId && player.username) {
      const userResult = await client.query(
        "SELECT id_user FROM utenti WHERE username = $1 LIMIT 1",
        [player.username],
      );
      userId = userResult.rows[0]?.id_user || null;
    }
    if (!userId) continue;
    await ensureUserObjectives(userId, client);

    const stats = player.stats || {};
    const result = await client.query(
      `SELECT o.id_obbiettivo, o.requisito, ou.progress, ou.stato
       FROM obiettivi o
       JOIN obiettivi_utente ou ON ou.id_obbiettivo = o.id_obbiettivo
       WHERE ou.id_user = $1`,
      [userId],
    );

    for (const row of result.rows) {
      const requirement = parseJson(row.requisito, {});
      const target = Number(requirement.target) || 1;
      let progress = Number(row.progress) || 0;
      if (requirement.metric === "territories_single") {
        progress = Math.max(progress, Number(stats.territories) || 0);
      } else if (requirement.metric === "kills_total") {
        const total = await client.query(
          `SELECT COALESCE(SUM(kills), 0)::int AS value
           FROM statistiche_match WHERE utente_id = $1`,
          [userId],
        );
        progress = Number(total.rows[0]?.value) || 0;
      } else if (requirement.metric === "wins_total") {
        const total = await client.query(
          `SELECT COUNT(*)::int AS value
           FROM statistiche_match
           WHERE utente_id = $1 AND esito = 'vinto'`,
          [userId],
        );
        progress = Number(total.rows[0]?.value) || 0;
      }

      const completed = progress >= target;
      await client.query(
        `UPDATE obiettivi_utente
         SET progress = $1, stato = CASE WHEN $2 THEN 'completo' ELSE stato END, updated_at = NOW()
         WHERE id_user = $3 AND id_obbiettivo = $4 AND stato <> 'ricompensa_riscattata'`,
        [Math.min(progress, target), completed, userId, row.id_obbiettivo],
      );
    }
  }
};

const listForUser = async (userId) => {
  await ensureCatalog();
  await ensureUserObjectives(userId);
  const result = await db.query(
    `SELECT o.id_obbiettivo AS id, o.nome_obbiettivo AS title,
            o.descrizione AS description, o.requisito AS requirement,
            o.ricompensa AS reward, ou.progress, ou.stato AS status
     FROM obiettivi o
     JOIN obiettivi_utente ou ON ou.id_obbiettivo = o.id_obbiettivo
     WHERE ou.id_user = $1
     ORDER BY o.created_at, o.nome_obbiettivo`,
    [userId],
  );
  return result.rows.map((row) => ({
    ...row,
    requirement: parseJson(row.requirement, {}),
    reward: parseJson(row.reward, {}),
    progress: Number(row.progress) || 0,
    completed: row.status === "completo" || row.status === "ricompensa_riscattata",
    claimed: row.status === "ricompensa_riscattata",
  }));
};

const claimForUser = async (userId, objectiveId) => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT ou.id_obbiettivo_utente, ou.stato, o.ricompensa
       FROM obiettivi_utente ou
       JOIN obiettivi o ON o.id_obbiettivo = ou.id_obbiettivo
       WHERE ou.id_user = $1 AND ou.id_obbiettivo = $2
       FOR UPDATE`,
      [userId, objectiveId],
    );
    const row = result.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return { status: 404, error: "objective_not_found" };
    }
    if (row.stato === "ricompensa_riscattata") {
      await client.query("ROLLBACK");
      return { status: 409, error: "reward_already_claimed" };
    }
    if (row.stato !== "completo") {
      await client.query("ROLLBACK");
      return { status: 409, error: "objective_not_completed" };
    }

    const reward = parseJson(row.ricompensa, {});
    if (reward.type === "elo") {
      await client.query(
        "UPDATE utenti SET elo_rating = COALESCE(elo_rating, 1000) + $1 WHERE id_user = $2",
        [Number(reward.value) || 0, userId],
      );
    }
    await client.query(
      `UPDATE obiettivi_utente SET stato = 'ricompensa_riscattata', updated_at = NOW()
       WHERE id_obbiettivo_utente = $1`,
      [row.id_obbiettivo_utente],
    );
    await client.query("COMMIT");
    return { status: 200, message: "Ricompensa riscattata", reward };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

module.exports = { ensureCatalog, ensureUserObjectives, updateForMatch, listForUser, claimForUser };