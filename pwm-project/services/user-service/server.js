const express = require("express");
const cors = require("cors");
const authRoutes = require("./routes/auth.routes.js");
const playerRoutes = require("./routes/player.routes.js");

const app = express();

const allowedOrigins = new Set([
  process.env.FRONTEND_URL,
  "http://localhost:8100",
  "http://127.0.0.1:8100",
  "http://localhost",
  "http://127.0.0.1",
]);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.has(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`Origin non autorizzata: ${origin}`));
  },
  credentials: true,
}));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use(authRoutes);
app.use(playerRoutes);

app.listen(3000, () =>
  console.log("User service attivo su http://localhost:3000"),
);
