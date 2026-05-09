const express = require("express");
const cors = require("cors");
const app = express();
const authRoutes = require("./services/auth-elo/auth.routes.js");
// const homeRoutes = require("./routes/home.routes.js");
// const userRoutes = require("./routes/user.routes.js");
// const gameRoutes = require("./routes/game.routes.js");
// const matchesRoutes = require("./routes/matches.routes.js");

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use(authRoutes);
// app.use(homeRoutes);
// app.use(userRoutes);
// app.use(gameRoutes);
// app.use(matchesRoutes);

const PORT = parseInt(process.env.PORT ?? "", 10) || 3001;

app.listen(PORT, () =>
  console.log(`App-route attivo su http://app-route:${PORT}`),
);