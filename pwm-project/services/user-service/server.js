const express = require("express");
const cors = require("cors");
const authRoutes = require("./routes/auth.routes.js");
const playerRoutes = require("./routes/player.routes.js");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use(authRoutes);
app.use(playerRoutes);

app.listen(3000, () =>
  console.log("User service attivo su http://localhost:3000"),
);
