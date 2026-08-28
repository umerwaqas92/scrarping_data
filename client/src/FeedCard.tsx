import { XTweet, RedditPost } from "./api";

export type FeedItem = XTweet | RedditPost;

export function isTweet(item: FeedItem): item is XTweet {
  return (item as XTweet).text !== undefined;
}

function formatCount(n?: number): string {
  if (n === undefined) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDate(s: string): string {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function Badge({ children }: { children: string }) {
  return <span className={`badge badge-${children.toLowerCase()}`}>{children}</span>;
}

export default function FeedCard({ item }: { item: FeedItem }) {
  if (isTweet(item)) {
    const tweet = item as XTweet;
    return (
      <article className="tweet">
        <div className="tweet-head">
          <div className="avatar" aria-hidden>
            {tweet.user?.screenName?.[0]?.toUpperCase() ?? "X"}
          </div>
          <div>
            <div className="tweet-name">
              <a href={tweet.url} target="_blank" rel="noreferrer">
                {tweet.user?.name ?? "Unknown"}
              </a>
            </div>
            <div className="tweet-handle">@{tweet.user?.screenName ?? "unknown"}</div>
          </div>
          <span className="tweet-date">
            <Badge>X</Badge> {formatDate(tweet.createdAt)}
          </span>
        </div>

        <p className="tweet-text">{tweet.text}</p>

        {tweet.media && tweet.media.length > 0 && (
          <div className="tweet-media">
            {tweet.media.slice(0, 4).map((url) => (
              <img key={url} src={url.replace("_normal", "")} alt="" loading="lazy" />
            ))}
          </div>
        )}

        <div className="tweet-metrics">
          <span title="Replies">💬 {formatCount(tweet.replyCount)}</span>
          <span title="Retweets">🔁 {formatCount(tweet.retweetCount)}</span>
          <span title="Likes">❤️ {formatCount(tweet.likeCount)}</span>
          <span title="Views">👁️ {formatCount(tweet.viewCount)}</span>
        </div>
      </article>
    );
  }

  const post = item as RedditPost;
  return (
    <article className="tweet">
      <div className="tweet-head">
        <div className="avatar avatar-reddit" aria-hidden>
          r/
        </div>
        <div>
          <div className="tweet-name">
            <a href={post.url} target="_blank" rel="noreferrer">
              {post.title}
            </a>
          </div>
          <div className="tweet-handle">
            r/{post.subreddit} · u/{post.author}
          </div>
        </div>
        <span className="tweet-date">
          <Badge>Reddit</Badge> {formatDate(post.createdAt)}
        </span>
      </div>

      {post.selftext && <p className="tweet-text">{post.selftext.slice(0, 500)}</p>}

      {post.thumbnail && (
        <div className="tweet-media">
          <img src={post.thumbnail} alt="" loading="lazy" />
        </div>
      )}

      <div className="tweet-metrics">
        <span title="Score">▲ {formatCount(post.score)}</span>
        <span title="Comments">💬 {formatCount(post.numComments)}</span>
      </div>
    </article>
  );
}