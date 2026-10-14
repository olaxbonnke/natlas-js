/**
 * Vercel serverless function: https://<your-app>.vercel.app/api/webhook
 * Uses Vercel's web-standard handlers (Request -> Response).
 */
import { handlerFromEnv } from "../src/webhook.js";

export const maxDuration = 60; // N-ATLaS on a free T4 can take a while to answer

export function GET(request: Request): Promise<Response> {
  return handlerFromEnv()(request);
}

export function POST(request: Request): Promise<Response> {
  return handlerFromEnv()(request);
}
