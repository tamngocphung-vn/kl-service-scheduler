// Writes the OpenAPI contract generated from the route schemas to docs/openapi.json.
import { writeFileSync } from "node:fs";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/client.js";

const { db, close } = openDatabase(":memory:");
const app = await buildApp({ db });
await app.ready();
writeFileSync("docs/openapi.json", JSON.stringify(app.swagger(), null, 2) + "\n");
await app.close();
close();
console.log("Wrote docs/openapi.json");
