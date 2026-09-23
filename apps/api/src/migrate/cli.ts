import { Pool } from "pg";
import { migrateDown, migrateUp } from "./runner.js";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const [cmd = "up", arg] = process.argv.slice(2);
    if (cmd === "up") console.log("applied:", (await migrateUp(pool)).join(", ") || "nothing");
    else if (cmd === "down")
      console.log("reverted:", (await migrateDown(pool, Number(arg ?? 1))).join(", ") || "nothing");
    else throw new Error(`unknown command ${cmd}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
