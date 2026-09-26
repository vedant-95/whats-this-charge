# What's This Charge?

An iMessage bot that decodes confusing bank and card statement lines.
Text it `SQ *BLUE BOTL 4155551234 CA` and it replies with the real merchant,
their website, the clues it used, and a confidence score.

Built with **Photon** (Spectrum iMessage), **Browserbase**, and **Jev** (TypeSafe AI).
Uses only public and synthetic descriptors.

## How it works

```
iMessage -> Photon/Spectrum -> index.ts (bot)
                                  |
                        pipeline.ts lookup()
                                  |
            normalize.ts: strip processor prefix (SQ*, TST*, PAYPAL*...),
                          extract phone, state, merchant name
                                  |
            +---------------------+----------------------+
            |           (in parallel)                    |
     Jev triage:                               Browserbase: 2-3 cloud browsers
     merchant / subscription /                 search the web for candidates
     p2p / bank fee?                           (DuckDuckGo, Bing fallback)
            |                                            |
            +---------------------+----------------------+
                                  |
            Jev judge: which candidate is the business? (+ "none")
                                  |
            Code decides: high / medium / low confidence
                                  |
            Templated reply (no LLM-written text)
```

- **Photon** is the interface, **Browserbase** finds candidates, **Jev** judges,
  and **code** owns every decision and every word of the reply.
- Jev returns calibrated probabilities, not prose. Two scores drive confidence:
  `pTop` (how sure the pick is the best candidate) and `anyMatch` (how sure any
  candidate is actually the business). High confidence requires both.
- **Medium confidence** asks the user for context (city, item, amount), then
  reruns only the Jev judge with that context. No new browsing, about 0.2s.
- Bank fees and person-to-person transfers are recognized and answered without
  a merchant lookup.
- Confident results are cached, so repeat lookups return instantly.

## Run it

Node 20+.

```bash
npm install
cp env.example .env   # fill in Photon, TypeSafe, and Browserbase keys
npm run one -- "SQ *BLUE BOTL 4155551234 CA"   # one lookup, prints JSON
npm run local                                   # bot in the terminal
npm start                                       # bot on iMessage
```

## Files

| File | Role |
|---|---|
| `index.ts` | Spectrum bot: message loop, conversation state, reply templates |
| `pipeline.ts` | Orchestration, confidence thresholds, cache, refine |
| `normalize.ts` | Descriptor parser |
| `search.ts` | Browserbase web search |
| `jev.ts` | Jev triage and judge |
| `test.ts` | CLI runner |
