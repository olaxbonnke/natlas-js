export interface WhatsAppConfig {
  /** Permanent or temporary access token from Meta (WhatsApp > API Setup). */
  token: string;
  /** The sender phone number ID (not the phone number itself). */
  phoneNumberId: string;
  /** Any string you choose; paste the same value in the Meta webhook settings. */
  verifyToken: string;
  /** Optional: Meta App Secret. When set, POSTs must carry a valid X-Hub-Signature-256. */
  appSecret?: string;
  /** Graph API version. Default v21.0. */
  graphVersion: string;
}

function read(env: Record<string, string | undefined>, name: string): string | undefined {
  const v = env[name];
  return v && v.trim() ? v.trim() : undefined;
}

/** Read and validate the bot's environment. NATLAS_BASE_URL / NATLAS_API_KEY are read by the SDK itself. */
export function loadConfig(env: Record<string, string | undefined> = process.env): WhatsAppConfig {
  const missing = ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_VERIFY_TOKEN", "NATLAS_BASE_URL"].filter(
    (k) => !read(env, k),
  );
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(", ")} (see .env.example)`);
  return {
    token: read(env, "WHATSAPP_TOKEN")!,
    phoneNumberId: read(env, "WHATSAPP_PHONE_NUMBER_ID")!,
    verifyToken: read(env, "WHATSAPP_VERIFY_TOKEN")!,
    appSecret: read(env, "WHATSAPP_APP_SECRET"),
    graphVersion: read(env, "WHATSAPP_GRAPH_VERSION") ?? "v21.0",
  };
}
