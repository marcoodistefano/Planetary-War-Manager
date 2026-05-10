const express = require("express");
const cors = require("cors");
const matchRoutes = require("./matchRoute.js");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use(matchRoutes);

app.listen(3000, () =>
  console.log("Match service attivo su http://localhost:3000"),
);
