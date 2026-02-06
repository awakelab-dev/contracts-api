import express from "express";
import cors from "cors";
import health from "./routes/health";
import auth from "./routes/auth";
import students from "./routes/students";
import vacancies from "./routes/vacancies";
import companies from "./routes/companies";
import interviews from "./routes/interviews";
import internships from "./routes/internships";
import invitations from "./routes/invitations";
import studentCourses from "./routes/studentCourses";
import pnl from "./routes/pnl";
import hiringContracts from "./routes/hiringContracts";
import liquidations from "./routes/liquidations";
import stats from "./routes/stats";
import matching from "./routes/matching";
import { env } from "./config/env";
import { requireAuth } from "./middleware/auth";

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
