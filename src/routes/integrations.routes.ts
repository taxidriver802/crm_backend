import { Router } from "express";
import { abcRouter } from "./abc.routes";

export const integrationsRouter = Router();

integrationsRouter.use("/abc", abcRouter);