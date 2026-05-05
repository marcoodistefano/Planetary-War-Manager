const express = require("express");
const cors = require("cors");
const authRoutes = require("./auth.routes.js");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use(authRoutes);

app.listen(3000, () =>
  console.log("Auth service attivo su http://localhost:3000"),
);
