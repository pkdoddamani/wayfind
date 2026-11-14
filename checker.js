// Nextshore offer checker: deterministic checks against official registers.
// No AI, no network calls of its own: the caller passes load(path) -> Promise<JSON>
// that reads files written by fetch_data.py (meta.json, uk/xx.json, nl/xx.json, in/*.json).
// Shared by the website and the Android app.

export const RULES_CHECKED = '2026-11-13';

export const FEE_CAP_INR = 30000;            // Emigration Rules: max service charge for a registered agent
export const FEE_CAP_WITH_GST = 35400;       // + 18% GST
export const UK_GENERAL_MIN = 41700;         // Skilled Worker general threshold (GBP/yr)
export const UK_NEW_ENTRANT_MIN = 33400;     // lowest reduced threshold (GBP/yr)

export const GULF = ['AE', 'SA', 'QA', 'KW', 'OM', 'BH'];
export const COUNTRIES = {
  GB: 'United Kingdom', NL: 'Netherlands', AE: 'UAE', SA: 'Saudi Arabia', QA: 'Qatar',
  KW: 'Kuwait', OM: 'Oman', BH: 'Bahrain', OTHER: 'Another country',
};

const SRC = {
  meaCap: { label: 'MEA advisory on overcharging by agents', url: 'https://www.goa.gov.in/wp-content/uploads/2024/08/ADVISORY-ON-OVERCHARGING.pdf' },
  emigrate: { label: 'eMigrate (Ministry of External Affairs)', url: 'https://emigrate.gov.in/' },
  madad: { label: 'MADAD complaint portal (MEA)', url: 'https://madad.gov.in/' },
  ukRegister: { label: 'UK register of licensed sponsors', url: 'https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers' },
  ukSalary: { label: 'GOV.UK: Skilled Worker visa – salary', url: 'https://www.gov.uk/skilled-worker-visa/your-job' },
  ukCare: { label: 'GOV.UK: Statement of changes, July 2025', url: 'https://www.gov.uk/government/collections/immigration-rules-statement-of-changes' },
  ukFraud: { label: 'GOV.UK: Visa scams and sponsorship fraud', url: 'https://www.gov.uk/government/publications/visa-fraud-and-scams' },
  ind: { label: 'IND public register of recognised sponsors', url: 'https://ind.nl/en/public-register-recognised-sponsors/public-register-work' },
};

// ---------- text helpers (NORM must match fetch_data.py) ----------
const STOP = new Set(['ltd', 'limited', 'plc', 'llp', 'llc', 'inc', 'co', 'company', 'the', 'and', 'uk', 'bv', 'b', 'v',
  'nv', 'pvt', 'private', 'gmbh', 'group', 'services', 'service', 'international', 'intl', 'of']);

export function norm(name) {
  return String(name || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bnational health service\b/g, 'nhs')
    .split(' ').filter((w) => w && !STOP.has(w)).join(' ');
}
export function shardKey(n) {
  const k = n.replace(/[^a-z0-9]/g, '').slice(0, 2);
  return k.length === 2 ? k : (k + '_').slice(0, 2) || '__';
}
export function phones(s) {
  const out = new Set();
  for (const m of String(s || '').match(/\+?\d[\d\s().-]{7,}\d/g) || []) {
    const d = m.replace(/\D/g, '');
    if (d.length >= 10) out.add(d.slice(-10));
  }
  return [...out];
}
export function emails(s) {
  return [...new Set((String(s || '').match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) || []).map((e) => e.toLowerCase().replace(/\.$/, '')))];
}
export const FREE_MAIL = new Set(['gmail.com', 'yahoo.com', 'yahoo.co.in', 'hotmail.com', 'outlook.com', 'rediffmail.com',
  'ymail.com', 'live.com', 'icloud.com', 'aol.com', 'protonmail.com', 'zoho.com', 'mail.com', 'gmx.com']);
export function domainOf(s) {
  let d = String(s || '').toLowerCase().trim().split('@').pop().replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
  return d && d.includes('.') ? d : '';
}
// Dice coefficient on character bigrams: 1 = identical.
export function similarity(a, b) {
  if (a === b) return 1;
  const grams = (s) => { const g = new Map(); const t = ` ${s} `; for (let i = 0; i < t.length - 1; i++) { const k = t.slice(i, i + 2); g.set(k, (g.get(k) || 0) + 1); } return g; };
  const A = grams(a), B = grams(b);
  let inter = 0, total = 0;
  for (const [k, v] of A) { inter += Math.min(v, B.get(k) || 0); total += v; }
  for (const v of B.values()) total += v;
  return total ? (2 * inter) / total : 0;
}
const fmtINR = (n) => '₹' + Math.round(n).toLocaleString('en-IN');

// ---------- reading a pasted message / offer ----------
const KW = {
  visit: /\b(visit|tourist|tourism|travel)\s*visa\b/i,
  sponsorFee: /\b(cos|certificate of sponsorship|sponsorship (fee|charge|cost)|visa sponsorship fee|sponsor licen[cs]e fee)\b/i,
  feeWords: /\b(processing|registration|booking|security|visa|medical|ticket|file|service|documentation)\s*(fee|fees|charge|charges|deposit|amount)\b|\bdeposit\b/i,
  refundable: /\brefundable\b/i,
  guarantee: /\b(100\s*%|guarantee[d]?)\b.{0,30}\b(visa|job|placement|selection)\b|\b(visa|job|placement)\b.{0,20}\bguarantee[d]?\b/i,
  urgency: /\b(urgent(ly)?|limited (seats|slots|vacancies)|last date|today only|within 24 hours|immediate(ly)? (joining|payment)|hurry)\b/i,
  chatOnly: /\b(whats\s?app|telegram|signal)\b/i,
  noInterview: /\b(no interview|without interview|direct (selection|joining)|spot (offer|selection))\b/i,
  personalPay: /\b(upi|gpay|google pay|phonepe|paytm|personal account|my account|account number|ifsc)\b/i,
};
const CARE = /\b(care (worker|assistant|giver)|caregiver|carer|senior care|home care|domiciliary|support worker)\b/i;
const LOW_SKILL = /\b(driver|warehouse|packer|packing|picker|cleaner|cleaning|labou?rer|helper|kitchen (porter|helper)|dishwasher|waiter|waitress|housekeep\w*|security guard|farm (worker|hand)|fruit pick\w*|delivery (rider|boy|driver)|loader)\b/i;

export function readText(text) {
  const t = String(text || '');
  const flags = {};
  for (const [k, re] of Object.entries(KW)) flags[k] = re.test(t);
  // Rupee amounts: "Rs 2,50,000", "₹50000", "INR 1.5 lakh", "2 lakhs"
  const amounts = [];
  const re = /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)\s*(lakh|lakhs|lac|lacs|l|k|thousand)?|([\d.]+)\s*(lakh|lakhs|lac|lacs)\b/gi;
  let m;
  while ((m = re.exec(t))) {
    const num = parseFloat((m[1] || m[3]).replace(/,/g, ''));
    const unit = (m[2] || m[4] || '').toLowerCase();
    const mult = /^l/.test(unit) ? 100000 : unit === 'k' || unit === 'thousand' ? 1000 : 1;
    if (num > 0) amounts.push(num * mult);
  }
  return { flags, amounts, phones: phones(t), emails: emails(t) };
}

// ---------- register lookups ----------
async function lookupShard(load, dir, name) {
  const n = norm(name);
  if (!n) return { exact: [], prefix: [], close: [] };
  let rows = [];
  try { rows = await load(`${dir}/${shardKey(n)}.json`); } catch { rows = []; }
  const exact = rows.filter((r) => r[0] === n);
  // "asml" -> "asml netherlands", "asml holding": same company, longer legal name
  const prefix = exact.length || n.length < 3 ? [] : rows.filter((r) => r[0].startsWith(n + ' ')).slice(0, 5);
  const close = exact.length || prefix.length ? [] : rows
    .map((r) => ({ r, s: similarity(n, r[0]) }))
    .filter((x) => x.s >= 0.72)
    .sort((a, b) => b.s - a.s).slice(0, 5).map((x) => x.r);
  return { exact, prefix, close };
}

export async function lookupUK(load, meta, name) {
  const { exact, prefix, close } = await lookupShard(load, 'uk', name);
  const shape = (r) => ({ name: r[1], town: r[2], ratings: r[3].map((i) => meta.uk.ratings[i]), routes: r[4].map((i) => meta.uk.routes[i]) });
  return { exact: exact.map(shape), prefix: prefix.map(shape), close: close.map(shape) };
}
export async function lookupNL(load, name) {
  const { exact, prefix, close } = await lookupShard(load, 'nl', name);
  const shape = (r) => ({ name: r[1], kvk: r[2] });
  return { exact: exact.map(shape), prefix: prefix.map(shape), close: close.map(shape) };
}

function matchAgents(list, q) {
  const hits = [];
  for (const a of list) {
    const why = [];
    if (q.phones.some((p) => a.phones.includes(p))) why.push('phone');
    if (q.emails.some((e) => a.emails.includes(e))) why.push('email');
    if (q.domains.some((d) => a.domains.includes(d))) why.push('website');
    if (q.rc && a.rc && norm(a.rc) === q.rc) why.push('licence number');
    if (q.n && a.n && (a.n === q.n || (q.n.split(' ').length >= 2 && similarity(a.n, q.n) >= 0.9))) why.push('name');
    if (why.length) hits.push({ a, why });
  }
  // strongest evidence first: phone/email/licence beat name
  const score = (h) => h.why.filter((w) => w !== 'name').length * 10 + h.why.length;
  return hits.sort((x, y) => score(y) - score(x)).slice(0, 5);
}

// ---------- the check ----------
/**
 * offer: {
 *   country: 'GB'|'NL'|'AE'|...|'OTHER', company, jobTitle, website,
 *   salary: { amount, currency: 'GBP'|'EUR'|'INR'|..., period: 'year'|'month'|'hour' },
 *   agent: { name, phone, email, licence }, senderEmail,
 *   fee (INR asked so far, number), visaType: 'work'|'visit'|'unknown',
 *   asked: { sponsorshipFee, noInterview, chatOnly, personalAccount, urgency, guarantee, noContract } (booleans),
 *   text: pasted message / offer text
 * }
 * returns { verdict: 'red'|'amber'|'green', headline, findings: [{level, title, detail, source}], extracted }
 */
export async function checkOffer(offer, load) {
  const meta = await load('meta.json');
  const F = [];
  const add = (level, title, detail, source) => F.push({ level, title, detail, source });
  const country = offer.country || 'OTHER';
  const txt = readText(offer.text);
  const asked = { ...(offer.asked || {}) };
  for (const k of ['sponsorFee', 'refundable', 'guarantee', 'urgency', 'chatOnly', 'noInterview', 'personalPay']) {
    if (txt.flags[k]) asked[k === 'sponsorFee' ? 'sponsorshipFee' : k === 'personalPay' ? 'personalAccount' : k] = true;
  }
  const visaType = offer.visaType === 'visit' || txt.flags.visit ? 'visit' : offer.visaType || 'unknown';
  const fee = Math.max(Number(offer.fee) || 0, ...(txt.amounts.length && (txt.flags.feeWords || asked.sponsorshipFee) ? txt.amounts : [0]));

  // 1. Visa type
  if (visaType === 'visit') {
    add('red', 'Job on a visit or tourist visa',
      'A real job abroad needs a work or employment visa. Going on a visit visa to "convert it later" leaves you without legal status, wages protection or the right to complain. India\'s Ministry of External Affairs warns against it.', SRC.meaCap);
  }

  // 2. Fees
  if (fee > FEE_CAP_WITH_GST) {
    add('red', `Asking ${fmtINR(fee)}: above the legal limit`,
      `A registered recruiting agent may charge at most ${fmtINR(FEE_CAP_INR)} + 18% GST (${fmtINR(FEE_CAP_WITH_GST)}) and must give you a receipt. Anything more is illegal overcharging.`, SRC.meaCap);
  } else if (fee > 0) {
    add('info', `Fee of ${fmtINR(fee)} is within the legal limit`,
      `The limit is ${fmtINR(FEE_CAP_WITH_GST)} including GST, and only a registered agent may charge it. Pay only after you have a signed contract and the visa, and get a receipt.`, SRC.meaCap);
  }
  if (asked.sponsorshipFee && country === 'GB') {
    add('red', 'You are being asked to pay for UK sponsorship',
      'UK employers must pay for the Certificate of Sponsorship and the Immigration Skills Charge themselves. They are not allowed to pass these costs to you. "Selling" a CoS is a known scam.', SRC.ukFraud);
  } else if (asked.sponsorshipFee) {
    add('amber', 'You are being asked to pay for sponsorship or a work permit',
      'In most countries the employer pays for the work permit. Ask for an official government receipt in the employer\'s name before paying anything.', SRC.meaCap);
  }
  if (asked.personalAccount) add('amber', 'Payment to a personal account or UPI',
    'Registered agents and real employers take payment in a company account and give a GST receipt. Paying a person\'s UPI or bank account leaves you no proof and no way to get it back.', SRC.meaCap);
  if (asked.refundable) add('amber', '"Refundable" deposit',
    'A promise that money is refundable is a common hook. Ask for it in writing on company letterhead, with the agent\'s licence number.', SRC.meaCap);

  // 3. How the offer came
  if (asked.guarantee) add('amber', 'Promises a guaranteed visa or job', 'No agent can guarantee a visa; only the embassy decides. A guarantee is a sales line, not a fact.', SRC.meaCap);
  if (asked.noInterview) add('amber', 'Offer without a proper interview', 'Real employers interview before they hire, usually by video with someone from the company. A job offered without one is a strong warning sign.', SRC.meaCap);
  if (asked.chatOnly) add('amber', 'Only on WhatsApp, Telegram or social media', 'Illegal agents often work only through chat apps, with no office address. Ask for the company\'s registered address and a call from an official company number.', SRC.meaCap);
  if (asked.urgency) add('amber', 'Pressure to pay quickly', '"Last date today" or "limited seats" is used to stop you checking. A real job will wait a few days for you to verify it.', SRC.meaCap);
  if (asked.noContract) add('amber', 'No signed employment contract', 'Before you travel you should have a contract signed by the employer, and by the agent if one is involved, with salary, hours and duties in writing.', SRC.meaCap);

  const sender = domainOf(offer.senderEmail || txt.emails.find((e) => !emails(offer.agent?.email || '').includes(e)) || '');
  const site = domainOf(offer.website || '');
  if (sender && FREE_MAIL.has(sender) && offer.company) {
    add('amber', `Offer sent from a free email address (${sender})`, `A company like "${offer.company}" would normally write from its own domain${site ? ` (…@${site})` : ''}. Anyone can open a Gmail account in any name.`, SRC.ukFraud);
  } else if (sender && site && !(sender === site || sender.endsWith('.' + site) || site.endsWith('.' + sender))) {
    add('amber', 'Email domain doesn\'t match the company website', `The offer came from …@${sender} but the company's website is ${site}. Look-alike domains are a common trick.`, SRC.ukFraud);
  }

  // 4. Indian recruiting agent
  const ag = offer.agent || {};
  const q = {
    n: norm(ag.name), rc: norm(ag.licence),
    phones: [...new Set([...phones(ag.phone), ...txt.phones])],
    emails: [...new Set([...emails(ag.email), ...txt.emails])],
  };
  q.domains = [...new Set([...q.emails.map(domainOf), domainOf(ag.website || '')].filter((d) => d && !FREE_MAIL.has(d)))];
  const agentGiven = q.n || q.rc || q.phones.length || q.emails.length;
  let agentResult = null;
  if (agentGiven) {
    const [illegal, agents] = await Promise.all([load('in/illegal.json'), load('in/agents.json')]);
    const bad = matchAgents(illegal, q);
    const reg = matchAgents(agents, q);
    const strongBad = bad.filter((h) => h.why.some((w) => w !== 'name'));
    agentResult = { illegal: bad, registered: reg };
    if (strongBad.length) {
      const h = strongBad[0];
      add('red', 'On the government\'s list of illegal agents',
        `The ${h.why.join(' and ')} you entered matches "${h.a.name}" (${h.a.state}) on MEA's list of illegal agents${h.a.complaints ? `, with ${h.a.complaints} complaint${h.a.complaints > 1 ? 's' : ''}` : ''}. Do not pay. You can report it on MADAD.`, SRC.emigrate);
    } else if (bad.length) {
      add('amber', 'A similar name is on the illegal-agents list',
        `"${bad[0].a.name}" (${bad[0].a.state}) is on MEA's list of illegal agents. Names can be shared, so compare the phone number and address before you trust this agent.`, SRC.emigrate);
    }
    const best = reg[0];
    if (best) {
      const active = /^active$/i.test(best.a.status);
      if (active) {
        add(strongBad.length ? 'amber' : 'ok', `Registered agent: ${best.a.name}`,
          `Licence ${best.a.rc || best.a.id}, ${best.a.district ? best.a.district + ', ' : ''}${best.a.state}. Matched on ${best.why.join(' and ')}. ${best.why.every((w) => w === 'name') ? 'Only the name matched: scammers borrow real agents\' names, so call the number on the official list to confirm the person you\'re dealing with works there.' : 'Still call the number on the official list to confirm this offer is theirs.'}`, SRC.emigrate);
      } else {
        add('red', `Agent's licence is not active (${best.a.status})`,
          `"${best.a.name}" is on MEA's list, but the licence status is ${best.a.status}. They are not allowed to recruit right now.`, SRC.emigrate);
      }
    } else if (!strongBad.length) {
      add('amber', 'Agent not found on the list of registered agents',
        'Only agents registered with the Ministry of External Affairs may recruit people in India for jobs abroad. Check the spelling, or ask the agent for their licence (RC) number and search it on eMigrate. A company hiring you directly doesn\'t need an agent.', SRC.emigrate);
    }
  } else if (GULF.includes(country) && fee > 0) {
    add('amber', 'You\'re paying, but no agent details were entered', 'Add the agent\'s name, phone or licence number so we can check them against the government lists.', SRC.emigrate);
  }

  // 5. Destination checks
  let employer = null;
  const title = String(offer.jobTitle || '');
  if (country === 'GB') {
    if (CARE.test(title)) {
      add('red', 'UK care-worker visas are closed to people outside the UK',
        'Since 22 July 2025 UK employers can no longer sponsor care workers or senior care workers from abroad. Only people already in the UK on a care visa can switch jobs. An overseas "care job in the UK" is very likely a scam.', SRC.ukCare);
    } else if (LOW_SKILL.test(title)) {
      add('amber', 'This kind of job rarely qualifies for a UK work visa',
        'Since 22 July 2025 a Skilled Worker visa usually needs a degree-level job (RQF 6). Jobs like drivers, warehouse or cleaning staff mostly don\'t qualify, so be very careful with these offers.', SRC.ukSalary);
    }
    if (offer.company) {
      employer = await lookupUK(load, meta, offer.company);
      const found = employer.exact.length ? employer.exact : employer.prefix;
      if (found.length) {
        const e = found[0];
        const routes = [...new Set(found.flatMap((x) => x.routes))];
        const ratings = [...new Set(found.flatMap((x) => x.ratings))];
        const bRated = ratings.some((r) => /B rating/.test(r));
        const skilled = routes.some((r) => /Skilled Worker|Senior or Specialist|Graduate Trainee/.test(r));
        const viaPrefix = !employer.exact.length;
        add(bRated || !skilled ? 'amber' : 'ok', `Licensed UK sponsor: ${e.name}${viaPrefix && found.length > 1 ? ` (+${found.length - 1} similar)` : ''}`,
          `${viaPrefix ? `Found as ${found.map((x) => x.name).join(', ')}: make sure the name on your offer letter matches one of these exactly. ` : ''}${found.map((x) => x.town).filter(Boolean).slice(0, 3).join(', ') || 'UK'} · ${ratings.join(', ')} · ${routes.join(', ')}.${bRated ? ' A B rating means the Home Office has put them on an action plan; ask how they will sponsor you.' : ''}${!skilled ? ' This licence doesn\'t cover the Skilled Worker route.' : ''} Being on the register doesn\'t prove this offer came from them: reply through the email on their own website.`, SRC.ukRegister);
      } else {
        add('red', `"${offer.company}" is not on the UK sponsor register`,
          `Only employers on the Home Office register (${meta.uk.orgs.toLocaleString('en-IN')} today) can sponsor a work visa.${employer.close.length ? ' Did you mean one of the names below? Check the exact legal name on the offer letter.' : ' Check the exact legal name on the offer letter (e.g. "… Ltd").'}`, SRC.ukRegister);
      }
    }
    const s = offer.salary || {};
    if (s.amount && (s.currency || 'GBP') === 'GBP') {
      const yearly = s.period === 'month' ? s.amount * 12 : s.period === 'hour' ? s.amount * 37.5 * 52 : s.amount;
      if (yearly < UK_NEW_ENTRANT_MIN) {
        add('red', `Salary £${Math.round(yearly).toLocaleString('en-GB')} a year is too low for a work visa`,
          `Skilled Worker visas need at least £${UK_GENERAL_MIN.toLocaleString('en-GB')} a year in most cases, and never less than £${UK_NEW_ENTRANT_MIN.toLocaleString('en-GB')} even with discounts.`, SRC.ukSalary);
      } else if (yearly < UK_GENERAL_MIN) {
        add('amber', `Salary £${Math.round(yearly).toLocaleString('en-GB')} is below the usual £${UK_GENERAL_MIN.toLocaleString('en-GB')}`,
          'This only works if you qualify for a lower threshold, e.g. as a new entrant (under 26, recent graduate) or with a relevant PhD. Ask the employer which rule they are using.', SRC.ukSalary);
      }
    }
  } else if (country === 'NL' && offer.company) {
    employer = await lookupNL(load, offer.company);
    const found = employer.exact.length ? employer.exact : employer.prefix;
    if (found.length) {
      const e = found[0];
      add('ok', `Recognised sponsor in the Netherlands: ${e.name}${found.length > 1 ? ` (+${found.length - 1} similar)` : ''}`, `${employer.exact.length ? '' : `Found as ${found.map((x) => x.name).join(', ')}: make sure the name on your offer letter matches one of these exactly. `}Chamber of Commerce (KVK) number ${e.kvk}. Confirm the offer through the contact details on the company's own website.`, SRC.ind);
    } else {
      add('amber', `"${offer.company}" is not a recognised sponsor in the Netherlands`,
        `A Highly Skilled Migrant permit needs an employer on IND's register (${meta.nl.orgs.toLocaleString('en-IN')} today). Check the exact legal name (e.g. "… B.V.").${employer.close.length ? ' Similar names are below.' : ''}`, SRC.ind);
    }
  } else if (GULF.includes(country)) {
    add('info', `Before you fly to ${COUNTRIES[country]}`,
      'If your passport says "Emigration Check Required" (ECR), you need emigration clearance on eMigrate, which only a registered agent or the employer can apply for. Don\'t travel until your contract is registered there.', SRC.emigrate);
  }

  const reds = F.filter((f) => f.level === 'red').length;
  const ambers = F.filter((f) => f.level === 'amber').length;
  const verdict = reds ? 'red' : ambers ? 'amber' : 'green';
  const headline = reds
    ? 'Stop. Don\'t pay anything yet.'
    : ambers ? 'Check these points before you pay.' : 'No warning signs in what we could check.';
  const order = { red: 0, amber: 1, info: 2, ok: 3 };
  F.sort((a, b) => order[a.level] - order[b.level]);
  return {
    verdict, headline, findings: F,
    employer, agent: agentResult,
    extracted: { fee, visaType, phones: txt.phones, emails: txt.emails },
    dataAsOf: { uk: meta.uk?.asOf, nl: meta.nl?.asOf, in: meta.in?.asOf },
    help: SRC.madad,
  };
}
