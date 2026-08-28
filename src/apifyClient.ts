export interface LinkedinProfile {
  id: string;
  publicIdentifier: string;
  linkedinUrl: string;
  firstName: string;
  lastName: string;
  headline: string;
  location?: string;
  currentPosition?: string;
  profilePicture?: string;
  createdAt: string;
  source: "linkedin";
}

export interface FacebookPost {
  id: string;
  text: string;
  url: string;
  pageName: string;
  pageUrl: string;
  likes?: number;
  followers?: number;
  location?: string;
  source: "facebook";
}

const APIFY_BASE = "https://api.apify.com/v2";
const FB_ACTOR = "Us34x9p7VgjCz99H6";
const LI_ACTOR = "M2FMdjRVeF1HPGFcc";

export class ApifyClient {
  constructor(private readonly token: string) {}

  private auth() {
    return { authorization: `Bearer ${this.token}`, "content-type": "application/json" };
  }

  private async startRun(actorId: string, input: Record<string, unknown>) {
    const res = await fetch(`${APIFY_BASE}/acts/${actorId}/runs`, {
      method: "POST",
      headers: this.auth(),
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(`Apify run start failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as any;
    return json.data.id as string;
  }

  private async waitForRun(runId: string, timeoutMs = 300_000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 4000));
      const res = await fetch(`${APIFY_BASE}/actor-runs/${runId}`, { headers: this.auth() });
      const json = (await res.json()) as any;
      const status = json.data?.status;
      if (status === "SUCCEEDED") return json.data?.defaultDatasetId as string;
      if (status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") {
        throw new Error(`Apify run ${status}`);
      }
    }
    throw new Error("Apify run timed out");
  }

  private async getDatasetItems(datasetId: string): Promise<any[]> {
    const res = await fetch(`${APIFY_BASE}/datasets/${datasetId}/items?format=json`, {
      headers: this.auth(),
    });
    if (!res.ok) throw new Error(`Apify dataset fetch failed: ${res.status}`);
    const json = (await res.json()) as unknown;
    return Array.isArray(json) ? json : [];
  }

  async searchLinkedIn(query: string, limit = 10): Promise<LinkedinProfile[]> {
    const input = {
      searchQuery: query,
      profileScraperMode: "Short",
      startPage: 1,
      takePages: Math.max(1, Math.ceil(limit / 25)),
      maxItems: limit,
    };
    const runId = await this.startRun(LI_ACTOR, input);
    const datasetId = await this.waitForRun(runId);
    const items = await this.getDatasetItems(datasetId);
    return items
      .filter((p) => p?.id && p?.firstName)
      .slice(0, limit)
      .map((p) => ({
        id: p.id,
        publicIdentifier: p.publicIdentifier ?? "",
        linkedinUrl: p.linkedinUrl ?? `https://www.linkedin.com/in/${p.id}`,
        firstName: p.firstName ?? "",
        lastName: p.lastName ?? "",
        headline: p.headline ?? p.summary ?? "",
        location:
          typeof p.location === "object" && p.location
            ? p.location.linkedinText ?? p.location.text
            : p.location,
        currentPosition: Array.isArray(p.currentPosition) && p.currentPosition[0]
          ? p.currentPosition[0].companyName
          : undefined,
        profilePicture: typeof p.profilePicture === "object" && p.profilePicture
          ? p.profilePicture.url
          : p.photo,
        createdAt: new Date().toISOString(),
        source: "linkedin" as const,
      }));
  }

  async searchFacebook(query: string, limit = 10): Promise<FacebookPost[]> {
    const input = {
      categories: [query],
      locations: [],
      resultsLimit: limit,
    };
    const runId = await this.startRun(FB_ACTOR, input);
    const datasetId = await this.waitForRun(runId);
    const items = await this.getDatasetItems(datasetId);
    return items
      .filter((p) => p?.pageName || p?.title)
      .slice(0, limit)
      .map((p) => ({
        id: p.pageId ?? p.facebookId ?? String(Math.random()),
        text: Array.isArray(p.info) ? p.info.join(" ") : p.info ?? "",
        url: p.pageUrl ?? p.facebookUrl ?? "",
        pageName: p.pageName ?? p.title ?? "",
        pageUrl: p.pageUrl ?? p.facebookUrl ?? "",
        likes: p.likes,
        followers: p.followers,
        location: p.title ?? undefined,
        source: "facebook" as const,
      }));
  }
}