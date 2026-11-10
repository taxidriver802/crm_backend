import dotenv from "dotenv";

dotenv.config({ path: process.env.NODE_ENV === "test" ? ".env.test" : ".env" });

import { env } from "./config/env";
import { assertProductionConfig } from "./config/production";
import { app } from "./app";

try {
  assertProductionConfig();
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}

// HOST lets a production backend listen on 127.0.0.1 only, behind the
// frontend's /api rewrite. Unset, it listens on every interface as before.
const host = process.env.HOST?.trim() || undefined;

const onListen = () => {
  console.log(`API running on http://${host ?? "localhost"}:${env.port}`);
};

if (host) {
  app.listen(env.port, host, onListen);
} else {
  app.listen(env.port, onListen);
}
