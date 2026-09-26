import { TypeSafeClient, choice, noul } from "@typesafe-ai/sdk";
import type { Parsed } from "./normalize";
import type { Candidate } from "./search";

const client = new TypeSafeClient({ defaultModel: process.env.JEV_MODEL ?? "jev-latest" });

export type Triage = { kind: string; kindProb: number; recurring: number };

export async function triage(p: Parsed): Promise<Triage> {
  const t0 = Date.now();
  const { answers } = (await client.systemOne({
    state: { descriptor: p.raw, processor: p.processor, cleaned_name: p.name },
    questions: {
      kind: choice("What kind of card statement line is `descriptor`?", {
        merchant: "A purchase at a specific business: store, restaurant, website, app, or service",
        subscription: "A recurring subscription or membership charge from a business",
        p2p: "A person-to-person money transfer such as Venmo, Zelle, Cash App, or PayPal to a friend",
        bank_fee: "A fee, interest charge, or adjustment from the bank or card issuer itself",
        other: "None of the above clearly fits",
      }),
      recurring: noul("Does `descriptor` look like a recurring subscription charge?"),
    },
  })) as any;
  const kind = answers.kind.choice;
  const out = { kind, kindProb: answers.kind.probabilities[kind], recurring: answers.recurring.noul };
  console.log(`[jev] triage ${Date.now() - t0}ms`, out);
  return out;
}

export type Judgment = { index: number | null; lead: number | null; pTop: number; anyMatch: number };

export async function judge(p: Parsed, cands: Candidate[], context: string[]): Promise<Judgment> {
  if (cands.length === 0) return { index: null, lead: null, pTop: 0, anyMatch: 0 };
  const t0 = Date.now();

  const criteria: Record<string, string> = {};
  cands.forEach((c, i) => {
    criteria[`c${i}`] = `${c.title} | ${c.host} | ${c.snippet.slice(0, 220)}`;
  });
  criteria.none = "None of these is the business that made this charge";

  const { answers } = (await client.systemOne({
    state: {
      descriptor: p.raw,
      processor: p.processor,
      cleaned_name: p.name,
      phone: p.phone,
      state: p.state,
      user_context: context,
    },
    questions: {
      merchant: choice(
        "Which option is the actual business that charged a card with `descriptor`? Prefer the business's own website or listing over directories, review sites, and charge-lookup sites. Use `user_context` if present.",
        criteria
      ),
      any_match: noul("Is at least one of the search results clearly the business behind `descriptor`?"),
    },
  })) as any;

  const probs: Record<string, number> = answers.merchant.probabilities;
  const pick: string = answers.merchant.choice;
  const lead = Object.entries(probs)
    .filter(([k]) => k !== "none")
    .sort((a, b) => b[1] - a[1])[0]?.[0];

  const out = {
    index: pick === "none" ? null : Number(pick.slice(1)),
    lead: lead ? Number(lead.slice(1)) : null,
    pTop: probs[pick],
    anyMatch: answers.any_match.noul,
  };
  console.log(`[jev] judge ${Date.now() - t0}ms over ${cands.length} candidates`, out);
  return out;
}
