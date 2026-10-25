// After `next build`: tell the Cloudflare Worker where the API is (for link-preview tags on
// the public share pages). Same value the app itself was built with.
import { writeFileSync } from "node:fs";

const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
writeFileSync(new URL("../out/share-config.json", import.meta.url), JSON.stringify({ apiUrl }));
console.log(`share-config.json: ${apiUrl || "(no NEXT_PUBLIC_API_URL; previews stay generic)"}`);
