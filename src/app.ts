import express from "express";
import cors from "cors";
import health from "./routes/health.js";
import auth from "./routes/auth.js";
import students from "./routes/students.js";
import vacancies from "./routes/vacancies.js";
import companies from "./routes/companies.js";
import interviews from "./routes/interviews.js";
import internships from "./routes/internships.js";
import invitations from "./routes/invitations.js";
import studentCourses from "./routes/studentCourses.js";
import pnl from "./routes/pnl.js";
import hiringContracts from "./routes/hiringContracts.js";
import liquidations from "./routes/liquidations.js";
import stats from "./routes/stats.js";
import matching from "./routes/matching.js";
import { env } from "./config/env.js";
import { requireAuth } from "./middleware/auth.js";

const app = express();

const allowedOrigins = env.CORS_ORIGIN.split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.includes("*") ? true : allowedOrigins,
    credentials: true,
  })
);
app.use(express.json());

app.use("/health", health);
app.use("/auth", auth);

// Everything below requires auth
app.use(requireAuth);

app.use("/students", students);
app.use("/vacancies", vacancies);
app.use("/companies", companies);
app.use("/interviews", interviews);
app.use("/internships", internships);
app.use("/invitations", invitations);
app.use("/student-courses", studentCourses);
app.use("/pnl", pnl);
app.use("/hiring-contracts", hiringContracts);
app.use("/liquidations", liquidations);
app.use("/stats", stats);
app.use("/matching", matching);

export default app;
