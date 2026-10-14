import { describe, expect, it } from "vitest";
import {
  LANGUAGES,
  LANGUAGE_CODES,
  NAtlas,
  NAtlasValidationError,
  buildTranslationMessages,
  cleanTranslation,
  getLanguage,
  isLanguageCode,
  normalizeLanguage,
} from "../src/index.js";
import { completion, deltaEvent, jsonResponse, lastBody, mockFetch, sseResponse } from "./helpers.js";

const client = (f: ReturnType<typeof mockFetch>) =>
  new NAtlas({ baseUrl: "http://localhost:8000", fetch: f, retryDelayMs: 1 });

describe("languages", () => {
  it("has the four N-ATLaS languages", () => {
    expect(LANGUAGE_CODES).toEqual(["en", "yo", "ha", "ig"]);
    expect(LANGUAGES.yo.nativeName).toBe("Èdè Yorùbá");
    expect(LANGUAGES.ha.iso639_3).toBe("hau");
  });

  it("normalises names and ISO codes", () => {
    expect(normalizeLanguage("Yoruba")).toBe("yo");
    expect(normalizeLanguage("YOR")).toBe("yo");
    expect(normalizeLanguage("hausa")).toBe("ha");
    expect(normalizeLanguage("ibo")).toBe("ig");
    expect(normalizeLanguage("en_NG")).toBe("en");
    expect(normalizeLanguage("french")).toBeUndefined();
    expect(isLanguageCode("ig")).toBe(true);
    expect(isLanguageCode("fr")).toBe(false);
    expect(() => getLanguage("swahili")).toThrow(RangeError);
  });
});

describe("prompt templates", () => {
  it("builds a strict translator prompt with target orthography", () => {
    const msgs = buildTranslationMessages({ text: "Good morning", from: "en", to: "yo" });
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.role).toBe("system");
    expect(msgs[0]!.content).toMatch(/from English into Yoruba/);
    expect(msgs[0]!.content).toMatch(/tone marks/);
    expect(msgs[0]!.content).toMatch(/Output only the translation/);
    expect(msgs[1]!.content).toBe("Translate from English into Yoruba:\n\nGood morning");
  });

  it("includes Hausa hooked letters and Igbo dotted vowels guidance", () => {
    expect(buildTranslationMessages({ text: "x", from: "en", to: "ha" })[0]!.content).toContain("ɓ, ɗ, ƙ");
    expect(buildTranslationMessages({ text: "x", from: "en", to: "ig" })[0]!.content).toContain("ị, ọ, ụ");
  });

  it("supports auto-detect, domain and tone", () => {
    const msgs = buildTranslationMessages({ text: "x", from: "auto", to: "en", domain: "health", tone: "formal" });
    expect(msgs[0]!.content).toContain("detect it");
    expect(msgs[0]!.content).toContain("health");
    expect(msgs[0]!.content).toContain("formal");
    expect(msgs[1]!.content.startsWith("Translate into English:")).toBe(true);
  });

  it("cleans labels and wrapping quotes", () => {
    expect(cleanTranslation('Translation: "Ẹ kú àárọ̀"')).toBe("Ẹ kú àárọ̀");
    expect(cleanTranslation("Hausa: Ina kwana")).toBe("Ina kwana");
    expect(cleanTranslation("“Ụtụtụ ọma”")).toBe("Ụtụtụ ọma");
    expect(cleanTranslation('He said "hi" and "bye"')).toBe('He said "hi" and "bye"');
  });
});

describe("translate()", () => {
  it("sends the template with low temperature and returns cleaned text", async () => {
    const f = mockFetch(jsonResponse(completion('Translation: "Ẹ kú àárọ̀, màmá"')));
    const r = await client(f).translate("Good morning, mother", { from: "en", to: "yo" });
    expect(r).toMatchObject({ text: "Ẹ kú àárọ̀, màmá", from: "en", to: "yo" });
    const body = lastBody(f);
    expect(body.temperature).toBe(0.1);
    expect(body.max_tokens).toBeGreaterThanOrEqual(256);
    expect(body.messages[0].content).toMatch(/expert translator/);
    expect(body.messages[1].content).toContain("Good morning, mother");
  });

  it("accepts language names and lets callers override temperature", async () => {
    const f = mockFetch(jsonResponse(completion("Where is the market?")));
    const r = await client(f).translate("Ina kasuwa take?", { from: "Hausa", to: "english", temperature: 0.3 });
    expect(r.from).toBe("ha");
    expect(r.to).toBe("en");
    expect(lastBody(f).temperature).toBe(0.3);
  });

  it("short-circuits when from === to", async () => {
    const f = mockFetch();
    const r = await client(f).translate("Kedụ", { from: "ig", to: "ig" });
    expect(r.text).toBe("Kedụ");
    expect(f).not.toHaveBeenCalled();
  });

  it("validates input", async () => {
    const n = client(mockFetch());
    await expect(n.translate("", { to: "yo" })).rejects.toBeInstanceOf(NAtlasValidationError);
    await expect(n.translate("hi", { to: "fr" })).rejects.toBeInstanceOf(NAtlasValidationError);
    await expect(n.translate("hi", { from: "xx", to: "yo" })).rejects.toBeInstanceOf(NAtlasValidationError);
    await expect(n.translate("hi", {} as never)).rejects.toBeInstanceOf(NAtlasValidationError);
  });

  it("streams translations", async () => {
    const f = mockFetch(sseResponse([deltaEvent("Ina "), deltaEvent("kwana", "stop"), "data: [DONE]\n\n"]));
    const gen = client(f).translateStream("Good morning", { from: "en", to: "ha" });
    const out: string[] = [];
    let r = await gen.next();
    while (!r.done) {
      out.push(r.value.delta);
      r = await gen.next();
    }
    expect(out.join("")).toBe("Ina kwana");
    expect(r.value).toBe("Ina kwana");
  });
});
