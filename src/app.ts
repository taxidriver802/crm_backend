import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";

import { tasksRouter } from "./routes/tasks.routes";

import { authRouter } from "./routes/auth.routes";
import { leadsRouter } from "./routes/leads.routes";

import { dashboardRouter } from "./routes/dashboard.routes";

dotenv.config({ path: process.env.NODE_ENV === "test" ? ".env.test" : ".env" });

export const app = express();

app.use(helmet());
app.use(cors({ origin: "http://localhost:3000", credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(morgan("dev"));

// Routes
app.use("/auth", authRouter);
app.use("/leads", leadsRouter);
app.use("/tasks", tasksRouter);
app.use("/dashboard", dashboardRouter);

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "crm-backend", time: new Date().toISOString() });
});