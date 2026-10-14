import type { LanguageCode } from "@olaxbonnke/natlas-js";

export interface SamplePrompt {
  lang: LanguageCode;
  label: string;
  prompt: string;
}

/** Starter prompts in each N-ATLaS language. */
export const CHAT_SAMPLES: SamplePrompt[] = [
  { lang: "yo", label: "Greeting", prompt: "Báwo ni o ṣe wà lónìí?" },
  { lang: "yo", label: "Folktale", prompt: "Sọ ìtàn kúkúrú kan nípa Ìjàpá àti Erin." },
  { lang: "yo", label: "Health", prompt: "Kí ni àwọn àǹfààní mímu omi tó pọ̀ lójoojúmọ́?" },
  { lang: "ha", label: "Greeting", prompt: "Sannu, yaya kake?" },
  { lang: "ha", label: "Farming", prompt: "Menene amfanin noman rani ga manoma?" },
  { lang: "ha", label: "Meaning", prompt: "Menene ake nufi da gwagwarmaya?" },
  { lang: "ig", label: "Greeting", prompt: "Kedụ ka ị mere?" },
  { lang: "ig", label: "Education", prompt: "Kọwaa uru agụmakwụkwọ bara n'obodo anyị." },
  { lang: "ig", label: "Folktale", prompt: "Gwa m akụkọ banyere mbe na nnụnụ." },
  { lang: "en", label: "Civic", prompt: "Explain Nigeria's Data Protection Act 2023 in simple terms for a small business owner." },
  { lang: "en", label: "Proverb", prompt: "What does the Yoruba proverb \"Àgbájọ ọwọ́ la fi ń sọ̀yà\" mean, and when is it used?" },
];

export const TRANSLATE_SAMPLES: Array<{ from: LanguageCode; to: LanguageCode; text: string }> = [
  { from: "en", to: "yo", text: "Good morning. Please take this medicine twice a day after meals." },
  { from: "en", to: "ha", text: "The farmers' market opens every Saturday at seven in the morning." },
  { from: "en", to: "ig", text: "Education is the key to a better future for our children." },
  { from: "yo", to: "en", text: "Ẹ kú àárọ̀, ṣé ẹ ti jẹun?" },
  { from: "ha", to: "en", text: "Ina kwana? Yaya aiki?" },
  { from: "ig", to: "en", text: "Ụtụtụ ọma, kedụ maka ezinụlọ gị?" },
];
