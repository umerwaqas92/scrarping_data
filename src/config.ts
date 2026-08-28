export interface XConfig {
  authToken: string;
  ct0: string;
  guestToken: string;
  bearerToken: string;
  searchTimelineQueryId: string;
  port: number;
  apifyToken?: string;
  apifyToken2?: string;
  apifyToken3?: string;
}

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required env var: ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): XConfig {
  return {
    authToken: required("X_AUTH_TOKEN", env.X_AUTH_TOKEN),
    ct0: required("X_CT0", env.X_CT0),
    guestToken: required("X_GUEST_TOKEN", env.X_GUEST_TOKEN),
    bearerToken: required("X_BEARER_TOKEN", env.X_BEARER_TOKEN),
    searchTimelineQueryId: required("X_SEARCH_TIMELINE_QUERY_ID", env.X_SEARCH_TIMELINE_QUERY_ID),
    port: Number(env.PORT ?? 3000),
    apifyToken: env.APIFY_TOKEN,
    apifyToken2: env.APIFY_TOKEN2,
    apifyToken3: env.APIFY_TOKEN3,
  };
}