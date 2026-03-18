import dotenv from "dotenv";

dotenv.config({ path: process.env.NODE_ENV === "test" ? ".env.test" : ".env" });

import { env } from "./config/env";
import { app } from "./app";

app.listen(env.port, () => {
  console.log(`API running on http://localhost:${env.port}`);
});