import "dotenv/config";
import { lookup } from "./pipeline";

const raw = process.argv.slice(2).join(" ") || "SQ *BLUE BOTTLE COF CA";
const r = await lookup(raw);
console.log(
  JSON.stringify(
    {
      level: r.level,
      kind: r.kind,
      pick: r.pick?.title,
      url: r.pick?.url,
      pTop: r.pTop,
      recurring: r.recurring,
      parsed: r.parsed,
      candidates: r.candidates.map((c) => `${c.title} (${c.host})`),
      ms: r.ms,
    },
    null,
    2
  )
);
