import "dotenv/config";
import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { terminal } from "spectrum-ts/providers/terminal";
import { lookup, refine, isCached, type Result } from "./pipeline";

const TERMINAL = process.argv.includes("--terminal");

const app = await Spectrum(
  TERMINAL
    ? { providers: [terminal.config()] }
    : {
        projectId: process.env.PROJECT_ID!,
        projectSecret: process.env.PROJECT_SECRET!,
        providers: [imessage.config()],
      }
);
console.log(`What's This Charge? is live on ${TERMINAL ? "terminal" : "iMessage"}`);

const INTRO =
  "Hi! Paste a charge from your bank or card statement exactly as it appears, like SQ *BLUE BOTL 4155551234 CA, and I'll figure out who charged you.";

// Senders we asked a clarifying question, keyed by sender id.
const pending = new Map<string, Result>();

async function handle(space: any, who: string, text: string) {
  try {
    await space.responding(async () => {
      if (/^(hi|hello|hey|help|start)\b/i.test(text)) {
        await space.send(INTRO);
        return;
      }

      const prev = pending.get(who);
      pending.delete(who);
      // Statement lines are pasted in caps; conversational replies usually aren't.
      const looksLikeDescriptor = text === text.toUpperCase() && /[A-Z]/.test(text);

      let res: Result;
      if (prev && !looksLikeDescriptor) {
        if (/^(skip|no|idk|nope|dunno)$/i.test(text)) {
          await space.send(format({ ...prev, context: ["skip"] }));
          return;
        }
        res = await refine(prev, text);
      } else {
        if (!isCached(text)) await space.send("On it. Checking the web for this one...");
        res = await lookup(text);
      }

      if (res.level === "medium" && res.context.length === 0) pending.set(who, res);
      await space.send(format(res));
    });
  } catch (err) {
    console.error(err);
    await space.send("Something broke on my end. Try that charge again in a moment.").catch(() => {});
  }
}

const pct = (p: number) => `${Math.round(p * 100)}%`;

function format(r: Result): string {
  const time = `\n\n(${(r.ms / 1000).toFixed(1)}s${r.cached ? ", cached" : ""})`;

  if (r.level === "non_merchant") {
    return r.kind === "bank_fee"
      ? `That looks like a fee or adjustment from your bank or card issuer, not a store (${pct(r.pTop)} confident). Your issuer's app or support line can explain it.${time}`
      : `That looks like a person-to-person transfer (${pct(r.pTop)} confident), not a purchase. Check your Venmo, Zelle, Cash App, or PayPal history.${time}`;
  }

  const clues: string[] = [];
  if (r.parsed.processor) clues.push(`paid through ${r.parsed.processor}`);
  if (r.parsed.phone) clues.push(`phone ${r.parsed.phone}`);
  if (r.parsed.state) clues.push(`located in ${r.parsed.state}`);
  const clueLine = clues.length ? `\nClues: ${clues.join(", ")}.` : "";
  const sub = r.recurring >= 0.6 ? "\n\nHeads up: this looks like a recurring subscription." : "";
  const c = r.pick ?? r.lead;
  // Show the weaker of the two Jev scores: pTop is relative to the candidates, anyMatch is absolute.
  const conf = Math.min(r.pTop, r.anyMatch);

  if (r.level === "high" && c) {
    return `That's most likely ${c.title}\n${c.url}\n${clueLine}\nConfidence: ${pct(conf)}${sub}${time}`;
  }
  if (r.level === "medium" && c && r.context.length === 0) {
    return `Best guess: ${c.title} (${pct(conf)})\n${c.url}\n\nI'm not sure yet. Any extra detail helps: the city you were in, what you might have bought, or the amount. Reply "skip" to keep this guess.`;
  }
  if (r.level === "medium" && c) {
    return `Best guess: ${c.title} (${pct(conf)})\n${c.url}\n\nStill not certain, so double check before disputing.${sub}${time}`;
  }
  return c
    ? `I couldn't pin this one down. Closest lead: ${c.title}\n${c.url}\n\nIf you don't recognize the charge, contact your card issuer to dispute it.${time}`
    : `I couldn't find this merchant online. If you don't recognize the charge, contact your card issuer to dispute it.${time}`;
}

// Keep last: this loop never ends, so anything declared below it would stay uninitialized.
for await (const [space, message] of app.messages) {
  if (message.content.type !== "text") continue;
  void handle(space, message.sender.id, message.content.text.trim());
}
