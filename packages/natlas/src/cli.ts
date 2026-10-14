/**
 * natlas-js CLI
 *
 *   NATLAS_BASE_URL=https://xyz.trycloudflare.com npx @olaxbonnke/natlas-js "Báwo ni?"
 *   npx @olaxbonnke/natlas-js --translate --from en --to ha "Where is the market?"
 *   npx @olaxbonnke/natlas-js --health
 */
import { NAtlas } from "./client.js";
import { NAtlasError } from "./errors.js";
import { LANGUAGE_CODES, normalizeLanguage, type LanguageCode } from "./languages.js";

const HELP = `natlas-js - talk to N-ATLaS (Yoruba, Hausa, Igbo, Nigerian English) from your terminal

Usage:
  natlas-js [options] "<prompt>"
  echo "text" | natlas-js --translate --to yo

Options:
  -u, --base-url <url>   N-ATLaS server URL (default: $NATLAS_BASE_URL)
  -k, --api-key <key>    API key (default: $NATLAS_API_KEY)
  -t, --translate        Translate the text instead of chatting
  -f, --from <lang>      Source language: en | yo | ha | ig | auto (default auto)
      --to <lang>        Target language for --translate (default en)
  -r, --reply-in <lang>  Ask the model to answer in this language
      --temperature <n>  Sampling temperature
      --max-tokens <n>   Maximum tokens to generate
      --no-stream        Wait for the full reply instead of streaming
      --health           Check whether the endpoint is online
  -h, --help             Show this help
`;

interface Args {
  baseUrl?: string;
  apiKey?: string;
  translate: boolean;
  from: string;
  to: string;
  replyIn?: string;
  temperature?: number;
  maxTokens?: number;
  stream: boolean;
  health: boolean;
  help: boolean;
  text: string[];
}

function parseArgs(argv: string[]): Args {
  const a: Args = { translate: false, from: "auto", to: "en", stream: true, health: false, help: false, text: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${arg}`);
      return v;
    };
    switch (arg) {
      case "-u":
      case "--base-url":
        a.baseUrl = next();
        break;
      case "-k":
      case "--api-key":
        a.apiKey = next();
        break;
      case "-t":
      case "--translate":
        a.translate = true;
        break;
      case "-f":
      case "--from":
        a.from = next();
        break;
      case "--to":
        a.to = next();
        break;
      case "-r":
      case "--reply-in":
        a.replyIn = next();
        break;
      case "--temperature":
        a.temperature = Number(next());
        break;
      case "--max-tokens":
        a.maxTokens = Number(next());
        break;
      case "--no-stream":
        a.stream = false;
        break;
      case "--health":
        a.health = true;
        break;
      case "-h":
      case "--help":
        a.help = true;
        break;
      default:
        a.text.push(arg);
    }
  }
  return a;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8").trim();
}

function lang(value: string | undefined, flag: string): LanguageCode | undefined {
  if (value === undefined) return undefined;
  const code = normalizeLanguage(value);
  if (!code) throw new Error(`${flag}: unsupported language "${value}". Use ${LANGUAGE_CODES.join(", ")}.`);
  return code;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const client = new NAtlas({ baseUrl: args.baseUrl, apiKey: args.apiKey });

  if (args.health) {
    const h = await client.health();
    process.stdout.write(`${h.status} (${h.latencyMs} ms)${h.detail ? ` - ${h.detail}` : ""}\n`);
    return h.ok ? 0 : 1;
  }

  const text = args.text.join(" ").trim() || (await readStdin());
  if (!text) {
    process.stderr.write(HELP);
    return 1;
  }
  const common = { temperature: args.temperature, maxTokens: args.maxTokens };

  if (args.translate) {
    const to = lang(args.to, "--to")!;
    const from = args.from === "auto" ? "auto" : lang(args.from, "--from")!;
    if (!args.stream) {
      const r = await client.translate(text, { ...common, from, to });
      process.stdout.write(`${r.text}\n`);
      return 0;
    }
    for await (const c of client.translateStream(text, { ...common, from, to })) process.stdout.write(c.delta);
    process.stdout.write("\n");
    return 0;
  }

  const replyIn = lang(args.replyIn, "--reply-in");
  if (!args.stream) {
    const r = await client.chat(text, { ...common, replyIn });
    process.stdout.write(`${r.content}\n`);
    return 0;
  }
  for await (const c of client.chatStream(text, { ...common, replyIn })) process.stdout.write(c.delta);
  process.stdout.write("\n");
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    const msg = err instanceof NAtlasError ? `${err.name}: ${err.message}` : err instanceof Error ? err.message : String(err);
    process.stderr.write(`natlas-js: ${msg}\n`);
    process.exit(1);
  },
);
