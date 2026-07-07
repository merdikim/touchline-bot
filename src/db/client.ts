import { drizzle } from "drizzle-orm/d1";
import type { WorkerEnv } from "../env";
import * as schema from "./schema";

export function createDb(env: WorkerEnv) {
  return drizzle(env.DB, { schema });
}
