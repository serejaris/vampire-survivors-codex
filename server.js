const path = require("path");
const express = require("express");
const { Pool } = require("pg");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const LEADERBOARD_LIMIT = 25;
const MAX_NICKNAME_LENGTH = 20;
const DATABASE_URL = process.env.DATABASE_URL;
const useDatabase = Boolean(DATABASE_URL);

const memoryStore = {
  matches: [],
  ratings: new Map()
};

let pool = null;

if (useDatabase) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.PGSSL === "false" ? false : { rejectUnauthorized: false }
  });
}

app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    storage: useDatabase ? "postgres" : "memory",
    timestamp: new Date().toISOString()
  });
});

app.get("/api/leaderboard", async (req, res) => {
  const limit = toSafeInteger(req.query.limit, 1, 100, LEADERBOARD_LIMIT);

  try {
    const leaderboard = useDatabase
      ? await getLeaderboardFromDb(limit)
      : getLeaderboardFromMemory(limit);

    res.json({ leaderboard });
  } catch (error) {
    console.error("Leaderboard fetch failed:", error);
    res.status(500).json({ error: "Failed to load leaderboard." });
  }
});

app.post("/api/scores", async (req, res) => {
  const nickname = normalizeNickname(req.body?.nickname);
  const score = toSafeInteger(req.body?.score, 0, 10_000_000, null);
  const survivedSeconds = toSafeInteger(req.body?.survivedSeconds, 0, 86_400, null);

  if (!nickname) {
    return res.status(400).json({
      error: `Nickname must be 2-${MAX_NICKNAME_LENGTH} characters.`
    });
  }

  if (score === null || survivedSeconds === null) {
    return res.status(400).json({
      error: "Invalid score payload."
    });
  }

  try {
    const result = useDatabase
      ? await saveScoreToDb(nickname, score, survivedSeconds)
      : saveScoreToMemory(nickname, score, survivedSeconds);

    const leaderboard = useDatabase
      ? await getLeaderboardFromDb(LEADERBOARD_LIMIT)
      : getLeaderboardFromMemory(LEADERBOARD_LIMIT);

    res.status(201).json({
      ok: true,
      player: result.player,
      leaderboard
    });
  } catch (error) {
    console.error("Score save failed:", error);
    res.status(500).json({ error: "Failed to save score." });
  }
});

app.use((_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

async function initStorage() {
  if (!useDatabase) {
    console.log("Starting without DATABASE_URL. Using in-memory leaderboard.");
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS matches (
      id BIGSERIAL PRIMARY KEY,
      nickname VARCHAR(${MAX_NICKNAME_LENGTH}) NOT NULL,
      score INTEGER NOT NULL CHECK (score >= 0),
      survived_seconds INTEGER NOT NULL CHECK (survived_seconds >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS player_ratings (
      nickname VARCHAR(${MAX_NICKNAME_LENGTH}) PRIMARY KEY,
      rating INTEGER NOT NULL DEFAULT 0,
      best_score INTEGER NOT NULL DEFAULT 0,
      runs_count INTEGER NOT NULL DEFAULT 0,
      last_survived_seconds INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS player_ratings_rank_idx
    ON player_ratings (rating DESC, best_score DESC);
  `);
}

async function saveScoreToDb(nickname, score, survivedSeconds) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `
        INSERT INTO matches (nickname, score, survived_seconds)
        VALUES ($1, $2, $3);
      `,
      [nickname, score, survivedSeconds]
    );

    const { rows } = await client.query(
      `
        INSERT INTO player_ratings (
          nickname,
          rating,
          best_score,
          runs_count,
          last_survived_seconds,
          updated_at
        )
        VALUES ($1, $2, $2, 1, $3, NOW())
        ON CONFLICT (nickname)
        DO UPDATE SET
          rating = player_ratings.rating + EXCLUDED.rating,
          best_score = GREATEST(player_ratings.best_score, EXCLUDED.best_score),
          runs_count = player_ratings.runs_count + 1,
          last_survived_seconds = EXCLUDED.last_survived_seconds,
          updated_at = NOW()
        RETURNING
          nickname,
          rating,
          best_score,
          runs_count,
          last_survived_seconds,
          updated_at;
      `,
      [nickname, score, survivedSeconds]
    );

    await client.query("COMMIT");
    return { player: rows[0] };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getLeaderboardFromDb(limit) {
  const { rows } = await pool.query(
    `
      SELECT
        nickname,
        rating,
        best_score,
        runs_count,
        last_survived_seconds,
        updated_at
      FROM player_ratings
      ORDER BY rating DESC, best_score DESC, updated_at ASC
      LIMIT $1;
    `,
    [limit]
  );

  return rows;
}

function saveScoreToMemory(nickname, score, survivedSeconds) {
  memoryStore.matches.push({
    id: memoryStore.matches.length + 1,
    nickname,
    score,
    survivedSeconds,
    createdAt: new Date().toISOString()
  });

  const existing = memoryStore.ratings.get(nickname) || {
    nickname,
    rating: 0,
    best_score: 0,
    runs_count: 0,
    last_survived_seconds: 0,
    updated_at: new Date().toISOString()
  };

  existing.rating += score;
  existing.best_score = Math.max(existing.best_score, score);
  existing.runs_count += 1;
  existing.last_survived_seconds = survivedSeconds;
  existing.updated_at = new Date().toISOString();

  memoryStore.ratings.set(nickname, existing);

  return { player: existing };
}

function getLeaderboardFromMemory(limit) {
  return [...memoryStore.ratings.values()]
    .sort((a, b) => {
      if (b.rating !== a.rating) {
        return b.rating - a.rating;
      }
      if (b.best_score !== a.best_score) {
        return b.best_score - a.best_score;
      }
      return new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
    })
    .slice(0, limit);
}

function normalizeNickname(value) {
  if (typeof value !== "string") {
    return null;
  }

  const compacted = value.trim().replace(/\s+/g, " ");

  if (compacted.length < 2 || compacted.length > MAX_NICKNAME_LENGTH) {
    return null;
  }

  if (!/^[\p{L}\p{N}_.\- ]+$/u.test(compacted)) {
    return null;
  }

  return compacted;
}

function toSafeInteger(value, min, max, fallback) {
  if (typeof value === "string" && value.trim() !== "") {
    value = Number(value);
  }

  if (!Number.isInteger(value)) {
    return fallback;
  }

  if (value < min || value > max) {
    return fallback;
  }

  return value;
}

initStorage()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Startup failed:", error);
    process.exit(1);
  });
