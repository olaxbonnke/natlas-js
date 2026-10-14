/**
 * Languages supported by N-ATLaS (per the NCAIR1/N-ATLaS model card):
 * English (incl. Nigerian English), Hausa, Igbo and Yoruba.
 */

export type LanguageCode = "en" | "yo" | "ha" | "ig";

export interface LanguageInfo {
  /** ISO 639-1 code used throughout the SDK. */
  code: LanguageCode;
  /** ISO 639-3 code. */
  iso639_3: string;
  /** English name. */
  name: string;
  /** Name of the language in the language itself. */
  nativeName: string;
  /** A short greeting, handy for UIs and smoke tests. */
  greeting: string;
  /** Orthography guidance injected into prompts so output keeps correct spelling. */
  orthography: string;
}

export const LANGUAGES: Readonly<Record<LanguageCode, LanguageInfo>> = Object.freeze({
  en: {
    code: "en",
    iso639_3: "eng",
    name: "English",
    nativeName: "English",
    greeting: "Hello, how are you?",
    orthography:
      "Use clear, natural Nigerian English. Keep Nigerian names, places and cultural terms as they are.",
  },
  yo: {
    code: "yo",
    iso639_3: "yor",
    name: "Yoruba",
    nativeName: "Èdè Yorùbá",
    greeting: "Báwo ni o ṣe wà?",
    orthography:
      "Write standard Yoruba orthography with full tone marks (à, á, è, é, ì, í, ò, ó, ù, ú) and under-dots (ẹ, ọ, ṣ).",
  },
  ha: {
    code: "ha",
    iso639_3: "hau",
    name: "Hausa",
    nativeName: "Harshen Hausa",
    greeting: "Sannu, yaya kake?",
    orthography:
      "Write standard Boko (Latin) Hausa and use the hooked letters ɓ, ɗ, ƙ and ƴ where they belong.",
  },
  ig: {
    code: "ig",
    iso639_3: "ibo",
    name: "Igbo",
    nativeName: "Asụsụ Igbo",
    greeting: "Kedụ ka ị mere?",
    orthography:
      "Write standard Igbo (Ọnwụ) orthography with the dotted vowels ị, ọ, ụ and the letter ṅ where they belong.",
  },
});

/** All supported language codes, in display order. */
export const LANGUAGE_CODES: readonly LanguageCode[] = Object.freeze(["en", "yo", "ha", "ig"]);

const ALIASES: Record<string, LanguageCode> = {
  en: "en",
  eng: "en",
  english: "en",
  "en-ng": "en",
  "nigerian english": "en",
  yo: "yo",
  yor: "yo",
  yoruba: "yo",
  "yorùbá": "yo",
  ha: "ha",
  hau: "ha",
  hausa: "ha",
  ig: "ig",
  ibo: "ig",
  igbo: "ig",
};

/** True when `value` is one of the four canonical codes. */
export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === "string" && (LANGUAGE_CODES as readonly string[]).includes(value);
}

/**
 * Normalise a language name or code ("Yoruba", "yor", "YO", "en-NG") to a
 * canonical {@link LanguageCode}. Returns `undefined` when unsupported.
 */
export function normalizeLanguage(value: string): LanguageCode | undefined {
  if (typeof value !== "string") return undefined;
  const key = value.trim().toLowerCase().replace(/_/g, "-");
  return ALIASES[key];
}

/** Look up full language info by code or alias. Throws on unsupported input. */
export function getLanguage(value: string): LanguageInfo {
  const code = normalizeLanguage(value);
  if (!code) {
    throw new RangeError(
      `Unsupported language "${value}". N-ATLaS supports: ${LANGUAGE_CODES.join(", ")}.`,
    );
  }
  return LANGUAGES[code];
}

const WORD_HINTS: Record<Exclude<LanguageCode, "en">, string[]> = {
  yo: ["bawo", "báwo", "kaaro", "káàárọ̀", "kaale", "káalẹ́", "kaasan", "e kaabo", "ekaabo", "ese", "ẹ ṣé", "o se", "ọ ṣé", "kini", "kí ni", "nibo", "níbo", "mo fe", "mo fẹ́", "mi o", "mi ò", "se daadaa", "dáadáa", "daadaa", "ejo", "ẹ jọ̀wọ́", "jowo", "omo", "ọmọ", "oruko", "orúkọ", "ile", "ilé", "ounje", "oúnjẹ", "amala", "àmàlà", "eko", "ẹ̀kọ́", "nigba", "nígbà", "wa", "ni", "ati", "àti", "awon", "àwọn", "o dabo", "ó dàbọ̀", "pele", "pẹ̀lẹ́"],
  ha: ["sannu", "yaya", "ina kwana", "ina wuni", "nagode", "na gode", "lafiya", "kai", "ina", "yaushe", "menene", "mene ne", "don allah", "barka", "abinci", "gida", "aiki", "zan", "kuma", "suna", "ne", "da", "ba", "ka", "ki"],
  ig: ["kedu", "ndewo", "daalụ", "daalu", "biko", "nnọọ", "nnoo", "ụtụtụ ọma", "ututu oma", "gịnị", "gini", "ebee", "olee", "achọrọ", "achoro", "nri", "ụlọ", "ulo", "aha", "na", "nke", "ka", "m", "ọ", "ị"],
};

/**
 * Best-effort guess of the language a short message is written in, used when
 * the caller did not set `replyIn`. It looks at characters unique to each
 * orthography and at common words, so it also works on unaccented text such as
 * "bawo ni" or "e kaale sir". Returns "en" when nothing points elsewhere.
 */
export function detectLanguage(text: string): LanguageCode {
  const t = ` ${text.toLowerCase().normalize("NFC").replace(/[^\p{L}\p{M}\s']/gu, " ").replace(/\s+/g, " ")} `;
  const score: Record<Exclude<LanguageCode, "en">, number> = { yo: 0, ha: 0, ig: 0 };
  if (/[ẹọṣ]/u.test(t) || /[àèìòù]/u.test(t)) score.yo += 2;
  if (/[ụịṅ]/u.test(t)) score.ig += 3;
  if (/[ɓɗƙƴ]/u.test(t)) score.ha += 3;
  for (const lang of ["yo", "ha", "ig"] as const) {
    for (const w of WORD_HINTS[lang]) {
      if (t.includes(` ${w} `)) score[lang] += w.length <= 2 ? 0.5 : 2;
    }
  }
  const [best, value] = (Object.entries(score) as Array<[LanguageCode, number]>).sort((a, b) => b[1] - a[1])[0]!;
  return value >= 2 ? best : "en";
}
