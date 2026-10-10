import json
import csv
import os
import sys
import time
import urllib.request
import urllib.error

# Complete list of AI and Full-Stack keywords requested
KEYWORDS = [
    "AI Agent Development",
    "LangChain",
    "Node.js",
    "Web Application",
    "Chatbot Development",
    "LLM Prompt Engineering",
    "Mobile App Development",
    "iOS Development",
    "SaaS Development",
    "Full-Stack Development",
    "AI Development",
    "AI App Development",
    "Next.js, Python/FastAPI, RAG, AI Agents"
]

def get_apify_tokens():
    tokens = [
        os.environ.get("APIFY_TOKEN"),
        os.environ.get("APIFY_TOKEN2"),
        os.environ.get("APIFY_TOKEN3"),
        os.environ.get("APIFY_TOKEN4"),
    ]
    tokens = [t for t in tokens if t]
    if not tokens:
        env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
        if os.path.exists(env_path):
            with open(env_path, "r") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("APIFY_TOKEN"):
                        parts = line.split("=", 1)
                        if len(parts) == 2:
                            val = parts[1].strip().strip('"').strip("'")
                            if val and val not in tokens:
                                tokens.append(val)
    return tokens

APIFY_TOKENS = get_apify_tokens()

def run_scraper(queries, max_items_per_query=50, sort="recency+desc"):
    if not APIFY_TOKENS:
        print("❌ Error: No APIFY_TOKEN found in environment or .env file.")
        sys.exit(1)
    token = APIFY_TOKENS[0]
    payload = {
        "searchQueries": queries,
        "maxItems": max_items_per_query,
        "sort": sort,
        "proxyConfiguration": {
            "useApifyProxy": True,
            "apifyProxyGroups": ["RESIDENTIAL"]
        }
    }
    
    url = f"https://api.apify.com/v2/acts/devcake~upwork-jobs-scraper/runs?token={token}"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    
    print(f"\n🚀 Launching Upwork batch scrape for {len(queries)} keywords:")
    for idx, q in enumerate(queries, 1):
        print(f"  [{idx:02d}] {q}")
        
    try:
        res = urllib.request.urlopen(req)
        run_data = json.loads(res.read().decode())["data"]
        run_id = run_data["id"]
        print(f"\n[+] Actor Run Created: {run_id}")
    except urllib.error.HTTPError as e:
        print(f"[-] Error launching run: {e.code} - {e.read().decode()}")
        return []

    # Poll for completion
    while True:
        time.sleep(6)
        check_url = f"https://api.apify.com/v2/actor-runs/{run_id}?token={token}"
        status_data = json.loads(urllib.request.urlopen(check_url).read().decode())["data"]
        status = status_data["status"]
        print(f"[*] Scraper Status: {status}")
        
        if status == "SUCCEEDED":
            dataset_id = status_data["defaultDatasetId"]
            dataset_url = f"https://api.apify.com/v2/datasets/{dataset_id}/items?token={token}&limit=10000"
            items = json.loads(urllib.request.urlopen(dataset_url).read().decode())
            print(f"\n✅ Finished! Successfully retrieved {len(items)} total jobs from Upwork.")
            return items
        elif status in ["FAILED", "TIMED-OUT", "ABORTED"]:
            print(f"[-] Run ended with status: {status}")
            return []

def save_to_csv(jobs, filepath="upwork_scraped_jobs.csv"):
    if not jobs:
        return
    
    headers = [
        "ID", "Title", "URL", "Job Type", "Budget / Rate", "Experience Level",
        "Proposals", "Skills", "Client Country", "Payment Verified", "Client Spent", "Published On", "Description"
    ]
    
    with open(filepath, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(headers)
        
        for job in jobs:
            skills = ", ".join(job.get("skills", [])) if isinstance(job.get("skills"), list) else ""
            client = job.get("client", {}) or {}
            budget = job.get("budget") or (f"${job.get('hourlyMin')}-${job.get('hourlyMax')}/hr" if job.get('hourlyMin') else "N/A")
            
            writer.writerow([
                job.get("id") or job.get("ciphertext", ""),
                job.get("title", ""),
                job.get("url", ""),
                job.get("jobType", ""),
                budget,
                job.get("experienceLevel") or job.get("contractorTier", ""),
                job.get("proposalsRange") or str(job.get("applicantsCount", "")),
                skills,
                client.get("country", ""),
                "Yes" if client.get("paymentVerified") else "No",
                f"${client.get('totalSpent', 0)}" if client.get("totalSpent") is not None else "",
                job.get("publishTime") or job.get("postedOn", ""),
                (job.get("description") or "").replace("\n", " ")
            ])
    print(f"📊 Exported CSV report to {filepath}")

if __name__ == "__main__":
    results = run_scraper(KEYWORDS, max_items_per_query=50)
    
    if results:
        json_file = "upwork_scraped_jobs.json"
        with open(json_file, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2)
        print(f"💾 Saved JSON results to {json_file}")
        
        save_to_csv(results, "upwork_scraped_jobs.csv")
