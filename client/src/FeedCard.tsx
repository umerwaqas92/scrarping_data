import { XTweet, RedditPost, LinkedinProfile, LinkedinPost } from "./api";

export type FeedItem = XTweet | RedditPost | LinkedinProfile | LinkedinPost;

export function isTweet(item: FeedItem): item is XTweet {
  return (item as XTweet).text !== undefined;
}

export function isLinkedin(item: FeedItem): item is LinkedinProfile | LinkedinPost {
  return (item as LinkedinProfile | LinkedinPost).source === "linkedin";
}

function formatCount(n?: number): string {
  if (n === undefined) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function timeAgo(s: string): string {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const sec = Math.max(0, Math.floor(diff / 1000));
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(day / 365)}y ago`;
}

function Badge({ children }: { children: string }) {
  return <span className={`badge badge-${children.toLowerCase()}`}>{children}</span>;
}

export default function FeedCard({ item }: { item: FeedItem }) {
  if (isLinkedin(item)) {
    const p = item as LinkedinProfile | LinkedinPost;
    const isPost = (p as LinkedinPost).content !== undefined;
    const title = isPost
      ? (p as LinkedinPost).authorName
      : `${(p as LinkedinProfile).firstName} ${(p as LinkedinProfile).lastName}`;
    const subtitle = isPost
      ? (p as LinkedinPost).authorHeadline
      : (p as LinkedinProfile).headline;
    const avatar = isPost ? (p as LinkedinPost).authorPicture : (p as LinkedinProfile).profilePicture;
    return (
      <article className="tweet">
        <div className="tweet-head">
          {avatar ? (
            <img className="avatar avatar-img" src={avatar} alt="" />
          ) : (
            <div className="avatar avatar-linkedin" aria-hidden>
              {title?.[0] ?? "L"}
            </div>
          )}
          <div>
            <div className="tweet-name">
              <a href={p.linkedinUrl} target="_blank" rel="noreferrer">
                {title}
              </a>
            </div>
            <div className="tweet-handle">{subtitle}</div>
          </div>
          <span className="tweet-date">
            <Badge>LinkedIn</Badge> {isPost ? timeAgo((p as LinkedinPost).postedAt) : ""}
          </span>
        </div>

        {isPost && <p className="tweet-text">{(p as LinkedinPost).content}</p>}
        {!isPost && (p as LinkedinProfile).currentPosition && (
          <p className="tweet-text">Currently at {(p as LinkedinProfile).currentPosition}</p>
        )}

        <div className="tweet-metrics">
          {isPost && (
            <>
              <span>👍 {(p as LinkedinPost).likes ?? 0}</span>
              <span>💬 {(p as LinkedinPost).comments ?? 0}</span>
              <span>🔁 {(p as LinkedinPost).shares ?? 0}</span>
            </>
          )}
          {!isPost && (p as LinkedinProfile).location && (
            <span>📍 {(p as LinkedinProfile).location}</span>
          )}
        </div>
      </article>
    );
  }

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
            <Badge>X</Badge> {timeAgo(tweet.createdAt)}
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
          <Badge>Reddit</Badge> {timeAgo(post.createdAt)}
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