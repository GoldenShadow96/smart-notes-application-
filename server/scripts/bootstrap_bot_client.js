// server/scripts/bootstrap_bot_client.js
import "dotenv/config";
import crypto from "crypto";
import { pool } from "../db/pool.js";

function sha256(x) {
  return crypto.createHash("sha256").update(x).digest();
}

async function main() {
  const key = (process.env.BOT_API_KEY ?? "").toString();
  if (!key || key.length < 32) {
    console.error("Missing/weak BOT_API_KEY in .env (use long random string)");
    process.exit(1);
  }

  const name = "discord";
  const hash = sha256(key);

  const [rows] = await pool.query("SELECT id FROM bot_clients WHERE name=? LIMIT 1", [name]);
  if (rows.length) {
    console.log(`bot_clients "${name}" already exists. If key changed, delete row and rerun.`);
    process.exit(0);
  }

  await pool.execute("INSERT INTO bot_clients (name, api_key_hash) VALUES (?, ?)", [name, hash]);
  console.log("Created bot client.");
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error(e);
    await pool.end();
    process.exit(1);
  });