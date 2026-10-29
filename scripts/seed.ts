import { openDatabase } from "../src/db/client.js";
import { seed } from "../src/db/seed.js";

const path = process.env.DATABASE_PATH ?? "./data/scheduler.db";
const { db, close } = openDatabase(path);
seed(db);
close();
console.log(`Seeded ${path}`);
