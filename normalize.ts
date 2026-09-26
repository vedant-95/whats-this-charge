export type Parsed = {
  raw: string;
  processor: string | null;
  name: string;
  phone: string | null;
  state: string | null;
};

// Order matters: more specific prefixes first.
const PROCESSORS: [RegExp, string][] = [
  [/^SQ\s*\*\s*/, "Square"],
  [/^TST\s*\*\s*/, "Toast"],
  [/^PAYPAL\s*\*\s*/, "PayPal"],
  [/^PP\s*\*\s*/, "PayPal"],
  [/^AMZN\s+MKTP\s*(US)?\s*\*?\s*/, "Amazon Marketplace"],
  [/^SQSP\s*\*\s*/, "Squarespace"],
  [/^SP\s+(?=\S)/, "Shopify"],
  [/^GOOGLE\s*\*\s*/, "Google"],
  [/^(CKE|CLV)\s*\*\s*/, "Clover"],
  [/^(DD|DOORDASH)\s*\*\s*/, "DoorDash"],
  [/^UBER\s*\*\s*/, "Uber"],
  [/^LYFT\s*\*\s*/, "Lyft"],
  [/^IC\s*\*\s*/, "Instacart"],
  [/^WPY\s*\*\s*/, "WePay"],
  [/^FS\s*\*\s*/, "FastSpring"],
  [/^PADDLE\.NET\s*\*\s*/, "Paddle"],
];

const STATES = new Set(
  "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(" ")
);

export function parse(input: string): Parsed {
  const raw = input.trim().replace(/\s+/g, " ");
  let s = raw.toUpperCase();

  let processor: string | null = null;
  for (const [re, label] of PROCESSORS) {
    if (re.test(s)) {
      processor = label;
      s = s.replace(re, "");
      break;
    }
  }

  const pm = s.match(/(?:\+?1[\s.-]?)?\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})/);
  const phone = pm ? `${pm[1]}-${pm[2]}-${pm[3]}` : null;
  if (pm) s = s.replace(pm[0], " ");

  let state: string | null = null;
  s = s.trim();
  const tail = s.match(/\b([A-Z]{2})$/);
  if (tail && STATES.has(tail[1])) {
    state = tail[1];
    s = s.slice(0, -2);
  }

  const name = s
    .replace(/#\s*\d+/g, " ")
    .replace(/\b\d{4,}\b/g, " ")
    .replace(/\*+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Leftover like "2K4L81" is an order code, not a name.
  const hasWord = /[A-Z]{3,}/.test(name) && !/^(?=.*\d)[A-Z0-9]{5,10}$/.test(name.replace(/\s/g, ""));
  return { raw, processor, name: hasWord ? name : processor || raw, phone, state };
}
