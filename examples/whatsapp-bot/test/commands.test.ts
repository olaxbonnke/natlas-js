import { describe, expect, it } from "vitest";
import { parseCommand } from "../src/commands.js";

describe("parseCommand", () => {
  it("treats plain text as chat", () => {
    expect(parseCommand("  Báwo ni?  ")).toEqual({ kind: "chat", text: "Báwo ni?" });
    expect(parseCommand("1/2 of the money")).toEqual({ kind: "chat", text: "1/2 of the money" });
  });

  it("parses /help and its aliases", () => {
    for (const t of ["/help", "/HELP", "!help", "/start", "/menu", "/help@natlas_bot"]) {
      expect(parseCommand(t)).toEqual({ kind: "help" });
    }
  });

  it("parses /reset", () => {
    expect(parseCommand("/reset")).toEqual({ kind: "reset" });
    expect(parseCommand("/clear")).toEqual({ kind: "reset" });
  });

  it("parses /lang with codes and names", () => {
    expect(parseCommand("/lang ha")).toEqual({ kind: "lang", lang: "ha" });
    expect(parseCommand("/lang Yoruba")).toEqual({ kind: "lang", lang: "yo" });
    expect(parseCommand("/language igbo")).toEqual({ kind: "lang", lang: "ig" });
    expect(parseCommand("/lang")).toEqual({ kind: "lang", lang: undefined });
    expect(parseCommand("/lang off")).toEqual({ kind: "lang", lang: null });
    expect(parseCommand("/lang auto")).toEqual({ kind: "lang", lang: null });
  });

  it("rejects unsupported /lang values", () => {
    const c = parseCommand("/lang fr");
    expect(c.kind).toBe("invalid");
    expect(c.kind === "invalid" && c.message).toMatch(/Unsupported language "fr"/);
  });

  it("parses /translate <to> <text>", () => {
    expect(parseCommand("/translate yo Hello")).toEqual({ kind: "translate", to: "yo", text: "Hello" });
    expect(parseCommand("/translate hausa Good morning, mother")).toEqual({
      kind: "translate",
      to: "ha",
      text: "Good morning, mother",
    });
  });

  it("parses /translate <from>:<to> and keeps multi-line text", () => {
    expect(parseCommand("/translate en:ig Wash your hands\nbefore eating")).toEqual({
      kind: "translate",
      from: "en",
      to: "ig",
      text: "Wash your hands\nbefore eating",
    });
    expect(parseCommand("/tr yo->en Ẹ káàrọ̀")).toEqual({ kind: "translate", from: "yo", to: "en", text: "Ẹ káàrọ̀" });
  });

  it("reports /translate usage errors", () => {
    expect(parseCommand("/translate").kind).toBe("invalid");
    expect(parseCommand("/translate yo").kind).toBe("invalid");
    expect(parseCommand("/translate fr Hello").kind).toBe("invalid");
    expect(parseCommand("/translate xx:yo Hello").kind).toBe("invalid");
  });

  it("flags unknown commands", () => {
    expect(parseCommand("/weather Lagos")).toEqual({ kind: "unknown", command: "weather" });
  });
});
