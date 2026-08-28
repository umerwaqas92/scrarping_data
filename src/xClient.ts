import { XConfig } from "./config.js";

export interface XUser {
  id: string;
  screenName: string;
  name: string;
}

export interface XTweet {
  id: string;
  url: string;
  createdAt: string;
  text: string;
  user: XUser | null;
  replyCount?: number;
  retweetCount?: number;
  likeCount?: number;
  quoteCount?: number;
  viewCount?: number;
  media?: string[];
}

export interface SearchOptions {
  product?: "Top" | "Latest";
  count?: number;
}

const FEATURES = [
  "rweb_video_screen_enabled",
  "rweb_cashtags_enabled",
  "profile_label_improvements_pcf_label_in_post_enabled",
  "responsive_web_profile_redirect_enabled",
  "rweb_tipjar_consumption_enabled",
  "verified_phone_label_enabled",
  "creator_subscriptions_tweet_preview_api_enabled",
  "responsive_web_graphql_timeline_navigation_enabled",
  "premium_content_api_read_enabled",
  "communities_web_enable_tweet_community_results_fetch",
  "c9s_tweet_anatomy_moderator_badge_enabled",
  "responsive_web_grok_analyze_button_fetch_trends_enabled",
  "responsive_web_grok_analyze_post_followups_enabled",
  "rweb_cashtags_composer_attachment_enabled",
  "responsive_web_jetfuel_frame",
  "responsive_web_grok_share_attachment_enabled",
  "responsive_web_grok_annotations_enabled",
  "articles_preview_enabled",
  "responsive_web_edit_tweet_api_enabled",
  "rweb_conversational_replies_downvote_enabled",
  "graphql_is_translatable_rweb_tweet_is_translatable_enabled",
  "view_counts_everywhere_api_enabled",
  "longform_notetweets_consumption_enabled",
  "responsive_web_twitter_article_tweet_consumption_enabled",
  "content_disclosure_indicator_enabled",
  "content_disclosure_ai_generated_indicator_enabled",
  "responsive_web_grok_show_grok_translated_post",
  "responsive_web_grok_analysis_button_from_backend",
  "post_ctas_fetch_enabled",
  "freedom_of_speech_not_reach_fetch_enabled",
  "standardized_nudges_misinfo",
  "tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled",
  "longform_notetweets_rich_text_read_enabled",
  "longform_notetweets_inline_media_enabled",
  "responsive_web_grok_image_annotation_enabled",
  "responsive_web_grok_imagine_annotation_enabled",
  "responsive_web_grok_community_note_auto_translation_is_enabled",
  "responsive_web_enhance_cards_enabled",
];

const FIELD_TOGGLES = [
  "withPayments",
  "withAuxiliaryUserLabels",
  "withArticleRichContentState",
  "withArticlePlainText",
  "withArticleSummaryText",
  "withArticleVoiceOver",
  "withGrokAnalyze",
  "withDisallowedReplyControls",
];

export class XSearchClient {
  private readonly config: XConfig;

  constructor(config: XConfig) {
    this.config = config;
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.config.bearerToken}`,
      "x-csrf-token": this.config.ct0,
      "x-twitter-active-user": "yes",
      "x-twitter-client-language": "en",
      "content-type": "application/json",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      cookie: [
        `auth_token=${this.config.authToken}`,
        `ct0=${this.config.ct0}`,
        `guest_id=${this.config.guestToken}`,
      ].join("; "),
    };
  }

  async search(query: string, opts: SearchOptions = {}): Promise<XTweet[]> {
    const { product = "Latest", count = 20 } = opts;
    const url = `https://x.com/i/api/graphql/${this.config.searchTimelineQueryId}/SearchTimeline`;

    const body = {
      variables: { rawQuery: query, count, querySource: "recent_search_click", product },
      features: Object.fromEntries(FEATURES.map((f) => [f, true])),
      fieldToggles: Object.fromEntries(FIELD_TOGGLES.map((f) => [f, true])),
    };

    const res = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`X API error ${res.status}: ${errText.slice(0, 500)}`);
    }

    const json = (await res.json()) as any;
    const timeline = json?.data?.search_by_raw_query?.search_timeline?.timeline;
    if (!timeline) return [];
    return this.extractTweets(timeline);
  }

  private extractTweets(timeline: any): XTweet[] {
    const seen = new Set<string>();
    const tweets: XTweet[] = [];

    const walk = (node: any): void => {
      if (!node || typeof node !== "object") return;
      if (node.tweet_results && typeof node.tweet_results === "object") {
        const result = node.tweet_results.result;
        if (result && result.rest_id && !seen.has(result.rest_id)) {
          seen.add(result.rest_id);
          const t = this.mapTweet(result);
          if (t) tweets.push(t);
        }
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) {
          for (const item of value) walk(item);
        } else {
          walk(value);
        }
      }
    };
    walk(timeline);
    return tweets;
  }

  private mapTweet(result: any): XTweet | null {
    const id: string | undefined = result.rest_id;
    if (!id) return null;

    const userResult = result.core?.user_results?.result;
    const user: XUser | null = userResult
      ? {
          id: userResult.rest_id ?? userResult.id ?? "",
          screenName: userResult.core?.screen_name ?? "",
          name: userResult.core?.name ?? "",
        }
      : null;

    const legacy = result.legacy ?? {};
    const entities = legacy.entities ?? {};
    const media = (entities.media ?? []).map((m: any) => m.media_url_https ?? m.url).filter(Boolean);

    return {
      id,
      url: user ? `https://x.com/${user.screenName}/status/${id}` : `https://x.com/i/web/status/${id}`,
      createdAt: legacy.created_at ?? "",
      text: legacy.full_text ?? "",
      user,
      replyCount: legacy.reply_count,
      retweetCount: legacy.retweet_count,
      likeCount: legacy.favorite_count,
      quoteCount: legacy.quote_count,
      viewCount: result.views?.count,
      media,
    };
  }
}