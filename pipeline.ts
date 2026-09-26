import { parse, type Parsed } from "./normalize";
import { findCandidates, type Candidate } from "./search";
import { triage, judge, type Triage } from "./jev";

export type Level = "high" | "medium" | "low" | "non_merchant";

export type Result = Triage & {
  parsed: Parsed;
  level: Level;
  pick: Candidate | null;
  lead: Candidate | null;
  pTop: number;
  anyMatch: number;
  candidates: Candidate[];
  context: string[];
  ms: number;
  cached?: boolean;
};

// Tune these on your eval set.
const HIGH = 0.7;
const MEDIUM = 0.4;
const ANY_MATCH = 0.6;

const cache = new Map<string, Result>();
const key = (raw: string) => parse(raw).raw.toUpperCase();

export const isCached = (raw: string) => cache.has(key(raw));

export async function lookup(raw: string): Promise<Result> {
  const t0 = Date.now();
  const parsed = parse(raw);
  const hit = cache.get(key(raw));
  if (hit) return { ...hit, cached: true, ms: Date.now() - t0 };

  // Triage and search in parallel; search is the slow part.
  const [tri, candidates] = await Promise.all([triage(parsed), findCandidates(parsed)]);

  let res: Result;
  if ((tri.kind === "bank_fee" || tri.kind === "p2p") && tri.kindProb >= HIGH) {
    res = { ...tri, parsed, level: "non_merchant", pick: null, lead: null, pTop: tri.kindProb, anyMatch: tri.kindProb, candidates, context: [], ms: 0 };
  } else {
    res = await decide(parsed, tri, candidates, []);
  }
  res.ms = Date.now() - t0;
  if (res.level === "high" || res.level === "non_merchant") cache.set(key(raw), res);
  return res;
}

// Rerun only the Jev judge with extra user context. No new browsing.
export async function refine(prev: Result, extra: string): Promise<Result> {
  const t0 = Date.now();
  const res = await decide(prev.parsed, prev, prev.candidates, [...prev.context, extra]);
  res.ms = Date.now() - t0;
  return res;
}

async function decide(parsed: Parsed, tri: Triage, candidates: Candidate[], context: string[]): Promise<Result> {
  const j = await judge(parsed, candidates, context);
  const pick = j.index === null ? null : candidates[j.index] ?? null;
  const lead = j.lead === null ? null : candidates[j.lead] ?? null;

  let level: Level = "low";
  if (pick && j.pTop >= HIGH && j.anyMatch >= ANY_MATCH) level = "high";
  else if (pick && j.pTop >= MEDIUM) level = "medium";

  return { kind: tri.kind, kindProb: tri.kindProb, recurring: tri.recurring, parsed, level, pick, lead, pTop: j.pTop, anyMatch: j.anyMatch, candidates, context, ms: 0 };
}
