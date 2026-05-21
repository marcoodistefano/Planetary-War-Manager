const express = require("express");
const cors = require("cors");
const matchRoutes = require("./matchRoute.js");

const app = express();

app.use(cors());
app.use(express.json());
app.use("/match", matchRoutes);

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.listen(3004, () =>
  console.log("Match service attivo su http://localhost:3004"),
);
