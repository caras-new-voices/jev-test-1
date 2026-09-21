#!/usr/bin/env python3
"""Score every creator post in the Brandwatch export with Jev, offline.

Why this exists
---------------
The report's headline number is earned media value, and the export counts
every post the listening query matched — including hauls that tag the brand
once among four. The export even has `relevant`, `relevance_confidence` and
`relevance_reason` columns, empty on all 6,168 rows. Nobody filled them in.

This script fills them, once, by asking Jev (TypeSafe AI's System One model)
six typed questions about every post, and commits the answers as data so the
site stays a static SPA. It talks to the *deployed* endpoint
(`/api/evaluate`), not to the gateway, so no key lives here or anywhere near
this file.

Usage
-----
    python3 scripts/score_posts.py --dry-run     # show three states, exit
    python3 scripts/score_posts.py --limit 30    # score 30 unscored posts
    python3 scripts/score_posts.py               # score everything left
    python3 scripts/score_posts.py --build       # aggregate to src/data/

Resumable: answers are appended to data/raw/post_scores.jsonl as they land and
a later run skips what is already there. Throttle-aware: the provider behind
the gateway returns 429 under sustained load, which pauses the whole pool.

Python 3 standard library only.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import queue
import random
import signal
import ssl
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POSTS_CSV = os.path.join(ROOT, "data", "raw", "posts.csv")
SCORES_JSONL = os.path.join(ROOT, "data", "raw", "post_scores.jsonl")
FAILED_JSONL = os.path.join(ROOT, "data", "raw", "post_scores.failed.jsonl")
OUT_JSON = os.path.join(ROOT, "src", "data", "posts_scored.json")

DEFAULT_ENDPOINT = "https://jev-test-1.vercel.app/api/evaluate"
MODEL = "typesafe-ai/jev"

# The endpoint caps the state at 1,200 characters; trim the caption rather than
# letting the server truncate mid-way through the "Caption:" label.
MAX_STATE_CHARS = 1200

START_CONCURRENCY = 2
MAX_CONCURRENCY = 4
MIN_CONCURRENCY = 2
MAX_ATTEMPTS = 12
PROGRESS_EVERY = 25

# ---------------------------------------------------------------- questions
# Wording is load-bearing: these are the exact six questions the committed
# scores were produced with, and the JSON file ships them so the view can
# show a reader what was actually asked.
QUESTIONS = {
    "aboutProduct": {
        "type": "boolean",
        "instructions": (
            "This is the caption of a creator post captured by a social-listening query for the "
            "named female hair-removal brand. Is the post substantively about that brand's "
            "hair-removal product, rather than an unrelated post that merely tags or mentions it "
            "in passing?"
        ),
    },
    "prominence": {
        "type": "score",
        "instructions": "How central is the named brand's hair-removal product to this post?",
        "criteria": [
            "Not really present or unrelated",
            "One tag or mention among many",
            "Featured alongside other products",
            "The main subject of the post",
        ],
    },
    "disclosed": {
        "type": "boolean",
        "instructions": (
            "Does the caption disclose, in any language, that this is a paid, sponsored, gifted or "
            "affiliate partnership (e.g. #ad, AD |, Werbung, Anzeige, annons, reklam, paid "
            "partnership, gifted, PR sample, discount code, affiliate link)?"
        ),
    },
    "format": {
        "type": "choice",
        "instructions": "What kind of post is this?",
        "criteria": {
            "review": "Personal review or honest opinion of the product",
            "tutorial": "How-to, routine or demonstration",
            "haul": "Haul, shopping trip, or get-ready-with-me featuring many products",
            "promo": "Promotional post with a discount code, link or launch announcement",
            "giveaway": "Giveaway or contest",
            "unrelated": "Not really about the product at all",
        },
    },
    "claim": {
        "type": "choice",
        "instructions": "Which product claim does the caption lean on most?",
        "criteria": {
            "smooth": "Smooth or close result",
            "skin": "Gentle, no irritation, sensitive skin",
            "value": "Price, value, deal",
            "design": "Design, colours, aesthetics",
            "convenience": "Speed, ease, subscription, travel",
            "none": "No product claim made",
        },
    },
    "language": {
        "type": "choice",
        "instructions": "What language is the caption written in? Ignore hashtags and @handles.",
        "criteria": {
            "en": "English",
            "de": "German",
            "fr": "French",
            "it": "Italian",
            "es": "Spanish",
            "pl": "Polish",
            "nl": "Dutch",
            "sv": "Swedish",
            "cs": "Czech",
            "ro": "Romanian",
            "other": "Some other language",
        },
    },
}

# Brand order the site uses; keeps the sanity report readable.
BRAND_ORDER = [520, 522, 474, 478, 523, 485]
SHORT_NAME = {
    474: "Estrid",
    478: "Veet",
    485: "Mercadona",
    520: "Venus",
    522: "OneBlade",
    523: "Wilkinson",
}

FORMAT_KEYS = ["review", "tutorial", "haul", "promo", "giveaway", "unrelated"]
LANG_KEYS = ["en", "de", "fr", "it", "es", "pl", "nl", "sv", "cs", "ro", "other"]


# ------------------------------------------------------------------- input


def read_posts() -> list[dict]:
    """Every row of the export, flattened to the fields the run needs.

    One row per post/segment link, so 14 post ids appear twice under two
    brands; the scoring key is (segment, post) because the brand is part of
    the question.
    """
    csv.field_size_limit(1 << 30)
    out: list[dict] = []
    with open(POSTS_CSV, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            try:
                stats = json.loads(row.get("computed_stats") or "{}")
            except json.JSONDecodeError:
                stats = {}
            seg = int(row["segment_id"])
            out.append(
                {
                    "key": f"{seg}:{row['post_id']}",
                    "segment_id": seg,
                    "segment_name": row["segment_name"],
                    "post_id": row["post_id"],
                    "username": row.get("username") or "",
                    "platform": (row.get("platform") or "").lower(),
                    "url": row.get("url") or "",
                    "text": row.get("text") or "",
                    "date": (row.get("publishedAt") or "")[:10],
                    "stats": stats,
                }
            )
    return out


def utf16_len(s: str) -> int:
    """Length in UTF-16 code units — what JavaScript's `String.slice` counts."""
    return len(s.encode("utf-16-le")) // 2


def state_text(post: dict) -> str:
    """The state sent to Jev. Naming the brand matters: the questions all say
    "the named brand".

    The trim is measured in UTF-16 code units, not characters, because the
    endpoint caps the text with `slice(0, 1200)` in JavaScript. A caption of
    1,200 characters that ends in emoji is longer than that in code units, so
    the server's own slice lands in the middle of a surrogate pair and the
    provider rejects the request as invalid Unicode. Cut it here instead, on a
    character boundary, so the server never has to.
    """
    head = f"Brand: {post['segment_name']}\nPlatform: {post['platform']}\nCaption: "
    caption = " ".join((post["text"] or "").split("\n")).strip()
    budget = MAX_STATE_CHARS - utf16_len(head) - 1  # room for the ellipsis
    if utf16_len(caption) > budget:
        lo, hi = 0, len(caption)
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if utf16_len(caption[:mid]) <= budget:
                lo = mid
            else:
                hi = mid - 1
        caption = caption[:lo].rstrip() + "…"
    return head + caption


def read_jsonl(path: str) -> list[dict]:
    if not os.path.exists(path):
        return []
    out = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue  # a half-written line from a hard kill
    return out


# ------------------------------------------------------------------- http


class HttpError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(f"HTTP {status}: {message}")
        self.status = status


def make_context() -> ssl.SSLContext:
    """Outbound HTTPS goes through the sandbox proxy; its CA is in
    SSL_CERT_FILE. Verification stays on."""
    return ssl.create_default_context(cafile=os.environ.get("SSL_CERT_FILE") or None)


def evaluate(endpoint: str, ctx: ssl.SSLContext, text: str, timeout: float = 30.0) -> dict:
    body = json.dumps({"text": text, "questions": QUESTIONS}).encode("utf-8")
    req = urllib.request.Request(
        endpoint,
        data=body,
        headers={"content-type": "application/json", "accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as res:
            return json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = e.read().decode("utf-8", "replace")[:200]
        except Exception:
            pass
        # Older deployments wrapped a provider throttle in a 502 with the
        # upstream status in the body; treat that as a 429 too.
        status = e.code
        if status == 502 and '"status":429' in detail.replace(" ", ""):
            status = 429
        raise HttpError(status, detail) from None
    except urllib.error.URLError as e:
        raise HttpError(0, str(e.reason)) from None
    except TimeoutError:
        raise HttpError(0, "timeout") from None


# ------------------------------------------------------------------- pool


class Scorer:
    """A tiny worker pool with a shared cooldown.

    A 429 is not one request's problem, it is the provider telling the whole
    key to slow down — so a throttle pauses every worker, halves the in-flight
    limit, and the pool creeps back up on a run of successes.

    One dispatcher thread owns every counter, the queue, the limit and the
    cooldown; the workers only pull a post off `work`, make the request, and
    push whatever came back onto `results`. Nothing but the dispatcher ever
    mutates pool state, which is what keeps the thing from wedging itself.
    """

    def __init__(self, endpoint: str, jobs: list[dict], total_target: int):
        self.endpoint = endpoint
        self.ctx = make_context()
        self.queue = [{"post": p, "attempt": 0, "at": 0.0} for p in jobs]
        self.work: queue.Queue = queue.Queue()
        self.results: queue.Queue = queue.Queue()
        self.inflight = 0
        self.limit = START_CONCURRENCY
        self.pause_until = 0.0
        self.consecutive_throttles = 0
        self.streak = 0
        self.stop = False

        self.total = total_target
        self.done = 0
        self.failed = 0
        self.throttles = 0
        self.retries = 0
        self.cost = 0.0
        self.model_ms = 0
        self.started = time.time()
        self.last_report = 0

        self.write_lock = threading.Lock()
        self.scores_fh = open(SCORES_JSONL, "a", encoding="utf-8")
        self.failed_fh = None

    # -- output ----------------------------------------------------------
    def record(self, post: dict, result: dict) -> None:
        answers = result.get("answers") or {}
        row = {
            "post_id": post["post_id"],
            "segment_id": post["segment_id"],
            "aboutProduct": answers.get("aboutProduct"),
            "prominence": answers.get("prominence"),
            "disclosed": answers.get("disclosed"),
            "format": answers.get("format"),
            "claim": answers.get("claim"),
            "language": answers.get("language"),
            "latencyMs": result.get("latencyMs"),
            "costUsd": result.get("costUsd"),
            "scoredAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        with self.write_lock:
            self.scores_fh.write(json.dumps(row, ensure_ascii=False) + "\n")
            self.scores_fh.flush()

    def record_failure(self, post: dict, reason: str) -> None:
        with self.write_lock:
            if self.failed_fh is None:
                self.failed_fh = open(FAILED_JSONL, "a", encoding="utf-8")
            self.failed_fh.write(
                json.dumps(
                    {
                        "post_id": post["post_id"],
                        "segment_id": post["segment_id"],
                        "reason": reason,
                        "at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
            self.failed_fh.flush()

    def progress(self, force: bool = False) -> None:
        n = self.done + self.failed
        if not force and (n == 0 or n // PROGRESS_EVERY == self.last_report):
            return
        self.last_report = n // PROGRESS_EVERY
        elapsed = max(0.001, time.time() - self.started)
        rate = n / elapsed
        left = max(0, self.total - n)
        eta = left / rate if rate > 0 else 0
        print(
            f"{n}/{self.total}  {rate:.2f}/s  limit {self.limit}  "
            f"throttles {self.throttles}  retries {self.retries}  "
            f"failed {self.failed}  ${self.cost:.4f}  "
            f"elapsed {fmt_dur(elapsed)}  eta {fmt_dur(eta)}",
            flush=True,
        )

    # -- pool ------------------------------------------------------------
    def worker(self) -> None:
        """Dumb: take a job, make the request, hand back whatever happened."""
        while True:
            job = self.work.get()
            if job is None:
                return
            err: HttpError | None = None
            result = None
            try:
                result = evaluate(self.endpoint, self.ctx, state_text(job["post"]))
            except HttpError as e:
                err = e
            except Exception as e:  # noqa: BLE001 - anything else is a retryable blip
                err = HttpError(0, repr(e))
            self.results.put((job, result, err))

    def handle(self, job: dict, result: dict | None, err: "HttpError | None") -> None:
        """Dispatcher-thread only: fold one finished request back into the pool."""
        post = job["post"]
        if result is not None and (result.get("answers") or {}).get("aboutProduct"):
            self.done += 1
            self.streak += 1
            self.consecutive_throttles = 0
            self.model_ms += int(result.get("latencyMs") or 0)
            try:
                self.cost += float(result.get("costUsd") or 0)
            except (TypeError, ValueError):
                pass
            if self.streak >= 4 and self.limit < MAX_CONCURRENCY:
                self.limit += 1
                self.streak = 0
            self.record(post, result)
            self.progress()
            return

        status = err.status if err else 0
        message = str(err) if err else "no answers in response"
        # A 502 that wraps an upstream 400 is the provider rejecting the
        # request itself; retrying it twelve times only wastes the budget.
        upstream_4xx = status == 502 and '"status":4' in message.replace(" ", "")
        retryable = status in (0, 429, 500, 502, 503, 504) and not upstream_4xx
        if retryable and job["attempt"] + 1 < MAX_ATTEMPTS and not self.stop:
            self.retries += 1
            self.streak = 0
            at = time.time() + 0.4 + random.random() * 0.6
            if status == 429:
                # A throttle is a shared budget, not this post's problem: hold
                # the whole pool back, for longer each consecutive time.
                self.throttles += 1
                self.consecutive_throttles += 1
                self.limit = max(MIN_CONCURRENCY, self.limit // 2)
                cooldown = min(20.0, 0.8 * 2 ** min(30, self.consecutive_throttles - 1)) + random.random() * 0.6
                self.pause_until = max(self.pause_until, time.time() + cooldown)
                at = self.pause_until
            job["attempt"] += 1
            job["at"] = at
            self.queue.append(job)
        else:
            self.failed += 1
            self.record_failure(post, message[:300])
            self.progress()

    def run(self) -> None:
        threads = [threading.Thread(target=self.worker, daemon=True) for _ in range(MAX_CONCURRENCY)]
        for t in threads:
            t.start()
        last_landed = time.time()
        try:
            while (self.queue or self.inflight) and not self.stop:
                now = time.time()
                # Dispatch whatever the limit and the cooldown allow.
                while self.inflight < self.limit and now >= self.pause_until:
                    idx = next((i for i, j in enumerate(self.queue) if j["at"] <= now), None)
                    if idx is None:
                        break
                    self.work.put(self.queue.pop(idx))
                    self.inflight += 1
                # Wake up for the earliest of: a result, the cooldown ending,
                # the next retry coming due.
                wake = 0.25
                if self.inflight >= self.limit:
                    wake = 1.0
                elif now < self.pause_until:
                    wake = min(1.0, self.pause_until - now)
                elif self.queue:
                    wake = max(0.05, min(1.0, min(j["at"] for j in self.queue) - now))
                try:
                    job, result, err = self.results.get(timeout=wake)
                except queue.Empty:
                    if time.time() - last_landed > 180:
                        print(
                            f"…nothing has landed for 3 min: {self.inflight} in flight, limit {self.limit}, "
                            f"{len(self.queue)} queued, cooldown {max(0.0, self.pause_until - time.time()):.1f}s",
                            flush=True,
                        )
                        last_landed = time.time()
                    continue
                self.inflight -= 1
                last_landed = time.time()
                self.handle(job, result, err)
        except KeyboardInterrupt:
            print("\ninterrupted — flushing", flush=True)
        finally:
            self.shutdown()
            for _ in threads:
                self.work.put(None)

    def shutdown(self) -> None:
        """Safe from any thread, and safe to call twice."""
        self.stop = True
        with self.write_lock:
            if self.scores_fh.closed:
                return
            try:
                self.scores_fh.flush()
                self.scores_fh.close()
            except Exception:
                pass
            if self.failed_fh is not None:
                try:
                    self.failed_fh.flush()
                    self.failed_fh.close()
                except Exception:
                    pass
                self.failed_fh = None


def fmt_dur(seconds: float) -> str:
    seconds = int(seconds)
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h}h{m:02d}m" if h else f"{m}m{s:02d}s"


# ------------------------------------------------------------------ scoring


def balanced_order(posts: list[dict], pending: list[dict], already: set[str]) -> list[dict]:
    """Order the work so that stopping early still leaves a usable dataset.

    The export is grouped by brand — 2,228 Estrid rows, then Veet, then
    Mercadona, then Venus — and within a brand it is roughly chronological. A
    run that gives up two thirds of the way through that order would have
    scored three brands and none of the other three, and the whole point of
    this view is comparing brands. So: shuffle each brand's posts with a fixed
    seed (kills the date bias) and then always take from whichever brand has
    the smallest share of its posts scored so far. Any prefix of the result is
    close to a uniform sample of every brand.
    """
    rng = random.Random(20260921)
    totals: dict[int, int] = {}
    for p in posts:
        totals[p["segment_id"]] = totals.get(p["segment_id"], 0) + 1
    scored: dict[int, int] = {b: 0 for b in totals}
    for p in posts:
        if p["key"] in already:
            scored[p["segment_id"]] += 1

    buckets: dict[int, list[dict]] = {b: [] for b in totals}
    for p in pending:
        buckets[p["segment_id"]].append(p)
    for b in buckets:
        rng.shuffle(buckets[b])

    out: list[dict] = []
    while any(buckets[b] for b in buckets):
        b = min((x for x in buckets if buckets[x]), key=lambda x: (scored[x] / totals[x], x))
        out.append(buckets[b].pop())
        scored[b] += 1
    return out


def cmd_score(args: argparse.Namespace) -> int:
    posts = read_posts()
    already = {f"{r.get('segment_id')}:{r.get('post_id')}" for r in read_jsonl(SCORES_JSONL)}
    pending = balanced_order(posts, [p for p in posts if p["key"] not in already], already)
    if args.limit:
        pending = pending[: args.limit]

    print(
        f"{len(posts)} posts in the export · {len(already)} already scored · "
        f"{len(pending)} to do in this run",
        flush=True,
    )
    if not pending:
        print("nothing to do", flush=True)
        return 0

    scorer = Scorer(args.endpoint, pending, len(pending))

    def on_term(_sig, _frm):  # pragma: no cover - signal path
        print("\nSIGTERM — flushing", flush=True)
        scorer.shutdown()
        sys.exit(1)

    signal.signal(signal.SIGTERM, on_term)
    scorer.run()
    scorer.progress(force=True)
    print(
        f"done: {scorer.done} scored, {scorer.failed} failed, {scorer.throttles} throttles, "
        f"${scorer.cost:.4f}, {fmt_dur(time.time() - scorer.started)} wall",
        flush=True,
    )
    return 0


def cmd_dry_run(args: argparse.Namespace) -> int:
    posts = read_posts()
    print(f"endpoint: {args.endpoint}")
    print(f"questions: {', '.join(QUESTIONS)}\n")
    for p in posts[:3]:
        s = state_text(p)
        print(f"--- {p['key']} ({len(s)} chars) ---")
        print(s)
        print()
    return 0


# --------------------------------------------------------------- aggregate


def _prob(answer, nd=2):
    if not isinstance(answer, dict):
        return None
    if "probability" in answer:
        return round(float(answer["probability"]), nd)
    if "score" in answer:
        return round(float(answer["score"]), nd)
    return None


def _choice(answer):
    if not isinstance(answer, dict):
        return None, None
    key = answer.get("choice")
    probs = answer.get("probabilities") or {}
    return key, (round(float(probs.get(key, 0)), 2) if key is not None else None)


def snippet_of(text: str, n: int = 140) -> str:
    s = " ".join((text or "").split())
    return s[:n]


def cmd_build(_args: argparse.Namespace) -> int:
    posts = read_posts()
    rows = read_jsonl(SCORES_JSONL)
    scores = {f"{r.get('segment_id')}:{r.get('post_id')}": r for r in rows}
    failed_keys = {f"{r.get('segment_id')}:{r.get('post_id')}" for r in read_jsonl(FAILED_JSONL)}
    failed_keys -= set(scores)

    out_posts = []
    cost = 0.0
    model_ms = 0
    stamps = []
    for p in posts:
        s = scores.get(p["key"])
        if not s:
            continue
        try:
            cost += float(s.get("costUsd") or 0)
        except (TypeError, ValueError):
            pass
        model_ms += int(s.get("latencyMs") or 0)
        if s.get("scoredAt"):
            stamps.append(s["scoredAt"])
        st = p["stats"]
        fmt_key, fmt_p = _choice(s.get("format"))
        claim_key, _ = _choice(s.get("claim"))
        lang_key, lang_p = _choice(s.get("language"))
        out_posts.append(
            {
                "id": p["post_id"],
                "brandId": p["segment_id"],
                "platform": p["platform"],
                "date": p["date"],
                "username": p["username"],
                "url": p["url"],
                "country": st.get("country"),
                "tier": st.get("tier"),
                "followers": st.get("followers") or 0,
                "emv": round(float(st.get("emv") or 0), 2),
                "paidFlag": bool(st.get("is_paid")),
                "bwLanguage": st.get("language") or "unknown",
                "snippet": snippet_of(p["text"]),
                "about": _prob(s.get("aboutProduct")),
                "prom": _prob(s.get("prominence")),
                "disclosed": _prob(s.get("disclosed")),
                "format": fmt_key,
                "formatP": fmt_p,
                "claim": claim_key,
                "lang": lang_key,
                "langP": lang_p,
            }
        )

    wall = 0
    if len(stamps) > 1:
        lo = datetime.strptime(min(stamps), "%Y-%m-%dT%H:%M:%SZ")
        hi = datetime.strptime(max(stamps), "%Y-%m-%dT%H:%M:%SZ")
        wall = int((hi - lo).total_seconds())

    doc = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "model": MODEL,
        "coverage": {"posts": len(posts), "scored": len(out_posts), "failed": len(failed_keys)},
        "spend": {"costUsd": round(cost, 4), "modelMs": model_ms, "wallSeconds": wall},
        "questions": QUESTIONS,
        "posts": out_posts,
    }
    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    with open(OUT_JSON, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, separators=(",", ":"))
    size = os.path.getsize(OUT_JSON)
    print(f"wrote {OUT_JSON} ({size / 1e6:.2f} MB)\n")
    sanity_report(doc)
    return 0


def sanity_report(doc: dict) -> None:
    posts = doc["posts"]
    cov = doc["coverage"]
    print("=" * 66)
    print("SANITY REPORT")
    print("=" * 66)
    print(
        f"coverage: {cov['scored']} of {cov['posts']} posts scored "
        f"({cov['scored'] / max(1, cov['posts']):.1%}), {cov['failed']} failed"
    )
    print(
        f"spend: ${doc['spend']['costUsd']:.4f} · model time "
        f"{doc['spend']['modelMs'] / 1000:.0f} s · wall {fmt_dur(doc['spend']['wallSeconds'])}"
    )
    print()

    def emv(rs):
        return sum(r["emv"] for r in rs)

    off = [r for r in posts if (r["about"] or 0) < 0.5]
    print("OFF-TOPIC (about < 0.5)")
    print(f"{'brand':<12}{'posts':>8}{'off':>8}{'off %':>9}{'EMV':>14}{'off EMV':>14}{'off EMV %':>11}")
    for bid in BRAND_ORDER + ["all"]:
        rs = posts if bid == "all" else [r for r in posts if r["brandId"] == bid]
        if not rs:
            continue
        o = [r for r in rs if (r["about"] or 0) < 0.5]
        name = "ALL" if bid == "all" else SHORT_NAME.get(bid, str(bid))
        print(
            f"{name:<12}{len(rs):>8}{len(o):>8}{len(o) / len(rs):>8.1%}"
            f"{emv(rs):>14,.0f}{emv(o):>14,.0f}{(emv(o) / emv(rs) if emv(rs) else 0):>10.1%}"
        )
    print()
    strict = sum(r["emv"] for r in posts if (r["about"] or 0) >= 0.5)
    weighted = sum(r["emv"] * (r["prom"] or 0) / 3 for r in posts)
    print(
        f"reported EMV ${emv(posts):,.0f} · real strict ${strict:,.0f} "
        f"({strict / emv(posts):.1%}) · real weighted ${weighted:,.0f} ({weighted / emv(posts):.1%})"
    )
    unc = [r for r in posts if 0.35 <= (r["about"] or 0) <= 0.65]
    print(f"uncertain (0.35 ≤ about ≤ 0.65): {len(unc)} posts ({len(unc) / max(1, len(posts)):.1%})")
    print()

    print("DISCLOSURE 2×2 (Jev disclosed ≥ 0.5 × Brandwatch paid flag)")
    cells = {(True, True): 0, (True, False): 0, (False, True): 0, (False, False): 0}
    for r in posts:
        cells[((r["disclosed"] or 0) >= 0.5, r["paidFlag"])] += 1
    print(f"{'':<22}{'flagged paid':>16}{'not flagged':>16}")
    print(f"{'Jev: disclosed':<22}{cells[(True, True)]:>16}{cells[(True, False)]:>16}")
    print(f"{'Jev: no disclosure':<22}{cells[(False, True)]:>16}{cells[(False, False)]:>16}")
    print(
        f"  → flagged but undisclosed (the exposure): {cells[(False, True)]} posts, "
        f"${emv([r for r in posts if r['paidFlag'] and (r['disclosed'] or 0) < 0.5]):,.0f} EMV"
    )
    print(
        f"  → disclosed but unflagged: {cells[(True, False)]} posts, "
        f"${emv([r for r in posts if not r['paidFlag'] and (r['disclosed'] or 0) >= 0.5]):,.0f} EMV"
    )
    print()

    print("LANGUAGES")
    unknown = [r for r in posts if r["bwLanguage"] == "unknown"]
    resolved = [r for r in unknown if r["lang"] and r["lang"] != "other"]
    print(
        f"Brandwatch 'unknown': {len(unknown)} posts ({len(unknown) / max(1, len(posts)):.1%}); "
        f"Jev names a specific language for {len(resolved)} of them ({len(resolved) / max(1, len(unknown)):.1%})"
    )
    counts: dict[str, int] = {}
    for r in unknown:
        counts[r["lang"] or "?"] = counts.get(r["lang"] or "?", 0) + 1
    print(
        "  of those unknowns: "
        + ", ".join(f"{k} {v}" for k, v in sorted(counts.items(), key=lambda kv: -kv[1]))
    )
    print()

    print("REPORTED VS REAL BY BRAND (strict)")
    ranked_reported = sorted(
        [(b, emv([r for r in posts if r["brandId"] == b])) for b in BRAND_ORDER],
        key=lambda x: -x[1],
    )
    ranked_real = sorted(
        [
            (b, sum(r["emv"] for r in posts if r["brandId"] == b and (r["about"] or 0) >= 0.5))
            for b in BRAND_ORDER
        ],
        key=lambda x: -x[1],
    )
    print(f"{'rank':<6}{'reported':<22}{'real (strict)':<22}")
    for i in range(len(ranked_reported)):
        a = f"{SHORT_NAME.get(ranked_reported[i][0])} ${ranked_reported[i][1]:,.0f}"
        b = f"{SHORT_NAME.get(ranked_real[i][0])} ${ranked_real[i][1]:,.0f}"
        print(f"{i + 1:<6}{a:<22}{b:<22}")
    changed = [x[0] for x in ranked_reported] != [x[0] for x in ranked_real]
    print(f"ranking changed: {'YES' if changed else 'no'}")
    print("=" * 66)


# ------------------------------------------------------------------- main


def main() -> int:
    ap = argparse.ArgumentParser(description="Score creator posts with Jev, offline.")
    ap.add_argument("--endpoint", default=DEFAULT_ENDPOINT, help="deployed /api/evaluate URL")
    ap.add_argument("--limit", type=int, default=0, help="score only the first N unscored posts")
    ap.add_argument("--dry-run", action="store_true", help="print the state for three posts and exit")
    ap.add_argument("--build", action="store_true", help="aggregate the JSONL into src/data/posts_scored.json")
    args = ap.parse_args()

    if args.build:
        return cmd_build(args)
    if args.dry_run:
        return cmd_dry_run(args)
    return cmd_score(args)


if __name__ == "__main__":
    sys.exit(main())
