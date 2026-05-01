import express from "express";
import cors from "cors";
import health from "./routes/health.js";
import auth from "./routes/auth.js";
import students from "./routes/students.js";
import locations from "./routes/locations.js";
import vacancies from "./routes/vacancies.js";
import companies from "./routes/companies.js";
import interviews from "./routes/interviews.js";
import internships from "./routes/internships.js";
import invitations from "./routes/invitations.js";
import studentCourses from "./routes/studentCourses.js";
import courseItineraries from "./routes/courseItineraries.js";
import contractCodes from "./routes/contractCodes.js";
import practices from "./routes/practices.js";
import hiringContracts from "./routes/hiringContracts.js";
import liquidations from "./routes/liquidations.js";
import stats from "./routes/stats.js";
import matching from "./routes/matching.js";
import transactionHistory from "./routes/transactionHistory.js";
import { env } from "./config/env.js";
import { requireAuth } from "./middleware/auth.js";

const app = express();
const apiRouter = express.Router();

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
apiRouter.use("/health", health);
apiRouter.use("/auth", auth);

// Everything below requires auth
apiRouter.use(requireAuth);

apiRouter.use("/students", students);
apiRouter.use("/locations", locations);
apiRouter.use("/vacancies", vacancies);
apiRouter.use("/companies", companies);
apiRouter.use("/interviews", interviews);
apiRouter.use("/internships", internships);
apiRouter.use("/invitations", invitations);
apiRouter.use("/student-courses", studentCourses);
apiRouter.use("/course-itineraries", courseItineraries);
apiRouter.use("/contract-codes", contractCodes);
apiRouter.use("/practices", practices);
apiRouter.use("/hiring-contracts", hiringContracts);
apiRouter.use("/liquidations", liquidations);
apiRouter.use("/stats", stats);
apiRouter.use("/matching", matching);
apiRouter.use("/transaction-history", transactionHistory);

// Support both "/..." and "/api/..." prefixes (local vs deployed setups).
app.use("/api", apiRouter);
app.use("/", apiRouter);

export default app;
