#!/usr/bin/env python3
"""Turn the raw Brandwatch/IMAI social-listening exports into compact JSON for the site.

Inputs (not committed, see README):
  data/raw/segments.csv        brandwatch_query_segments export (one row per brand segment)
  data/raw/posts.csv           influencer posts export (one row per post/segment link), optional
Outputs:
  src/data/category.json       index of brands with headline metrics + weekly series
  src/data/brands/<id>.json    full insight payload per brand
  src/data/posts/<id>.json     top posts per brand (when posts.csv is present)
"""
import csv, json, os, re, sys, collections
csv.field_size_limit(1 << 30)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'data', 'raw')
OUT = os.path.join(ROOT, 'src', 'data')

def fix_text(s):
    """Repair UTF-8 text that was decoded as latin-1 (mojibake like 'ð' emoji runs)."""
    if not s: return s
    def repair(m):
        try: return m.group().encode('latin-1').decode('utf-8')
        except Exception: return m.group()
    return re.sub(r'[\u00c2-\u00f4][\u0080-\u00bf]{1,3}', repair, s)

def load_json(s, default=None):
    if not s: return default
    try: return json.loads(s)
    except Exception: return default

def strip_html(s):
    return re.sub(r'<[^>]+>', '', s or '')

def slug(name):
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')

MAX_ITEMS = 12
MAX_QUOTES = 6
# Only these dimensions' items are read by the site (Compare + Ask them next); the rest keep summary + quotes only.
ITEM_KEYS = {
    'purchase_intent': ('blocker', 'score', 'intent_type'),
    'objections': ('category', 'verbatim_phrase'),
    'faq_gaps': ('topic', 'representative_phrasing'),
    'safety_complaints': ('complaint_type', 'severity'),
    'feature_requests': ('specific_request', 'request_type'),
    'competitor_mentions': ('competitor_name', 'favored_side'),
    'loyalty_signals': ('verbatim_phrase', 'loyalty_type'),
}

def compact_dimension(name, dim):
    if not isinstance(dim, dict): return None
    out = {
        'count': dim.get('count', 0),
        'summary': fix_text(dim.get('summary', '')),
        'top_quotes': [{'text': fix_text(q.get('text', ''))} for q in (dim.get('top_quotes') or [])[:MAX_QUOTES] if q.get('text')],
        'items': [],
    }
    keys = ITEM_KEYS.get(name)
    if keys:
        for it in (dim.get('items') or [])[:MAX_ITEMS]:
            if isinstance(it, dict):
                out['items'].append({k: (fix_text(v) if isinstance(v, str) else v) for k, v in it.items() if k in keys and v not in (None, '')})
    return out

def compact_synthesis(syn):
    if not isinstance(syn, dict): return None
    return {
        'summary': fix_text(syn.get('summary', '')),
        'findings': [{
            'title': fix_text(f.get('title', '')),
            'business_implication': fix_text(f.get('business_implication', '')),
            'recommended_action_area': fix_text(f.get('recommended_action_area', '')),
            'supporting_dimensions': f.get('supporting_dimensions', []),
        } for f in (syn.get('findings') or [])],
    }

def main():
    os.makedirs(os.path.join(OUT, 'brands'), exist_ok=True)
    os.makedirs(os.path.join(OUT, 'posts'), exist_ok=True)
    segs = list(csv.DictReader(open(os.path.join(RAW, 'segments.csv'), encoding='utf-8')))
    index = []
    for r in segs:
        sid = int(r['id']); name = r['name']
        agg = load_json(r['aggregated_stats'], {}) or {}
        st = agg.get('stats', {})
        ai = load_json(r['ai_insights'], {}) or {}
        ci = (load_json(r['comment_insights'], {}) or {}).get('platforms', {})
        plat = {p: st.get(p, {}).get('totalPosts', 0) for p in ('tiktok', 'instagram', 'youtube')}
        sent = st.get('sentimentBreakdown', {}).get('combined', {})
        tiers = {k: st.get(k + 'Influencers', 0) for k in ('nano', 'micro', 'midTier', 'macro', 'mega')}
        weekly = [{'label': w['label'], 'avgBudget': w.get('averageBudget', 0), 'followers': w.get('totalFollowers', 0), 'influencers': w.get('uniqueInfluencers', 0)} for w in st.get('investedBudgetBreakdown', [])]
        langs = [{'language': l['language'], 'count': l['count'], 'emv': round(l.get('emv', 0))} for l in st.get('topLanguages', [])[:8]]
        ai_all = ai.get('platforms', {}).get('all', {})
        metrics = {
            'posts': sum(plat.values()), 'byPlatform': plat,
            'influencers': st.get('totalUniqueInfluencers', 0),
            'paidInfluencers': st.get('totalPaidInfluencers', 0),
            'emv': round(st.get('totalEmv', 0)),
            'engagement': st.get('totalEngagement', 0),
            'impressions': round(st.get('estimatedImpressions', 0)),
            'followers': st.get('totalFollowers', 0),
            'budgetMin': st.get('investedBudgetMin', 0), 'budgetMax': st.get('investedBudgetMax', 0),
            'sentiment': {k: {'count': sent.get(k, {}).get('count', 0), 'pct': sent.get(k, {}).get('percentage', 0)} for k in ('positive', 'neutral', 'negative')},
            'tiers': tiers,
            'firstPost': (st.get('firstPostDate') or '')[:10], 'lastPost': (st.get('lastPostDate') or '')[:10],
        }
        # comment insight dimension totals across platforms for the index
        dim_totals = collections.Counter()
        for p, block in ci.items():
            for dname, dim in (block.get('payload') or {}).items():
                if isinstance(dim, dict) and 'count' in dim: dim_totals[dname] += dim['count']
        entry = {
            'id': sid, 'slug': slug(name), 'name': name,
            'headline': fix_text(ai_all.get('headline', '')),
            'framing': ai_all.get('framing', ''),
            'metrics': metrics, 'weekly': weekly, 'languages': langs,
            'dimensionTotals': dict(dim_totals),
            'scanStart': r['scan_start_date'][:10], 'analyzedAt': (ai.get('generatedAt') or '')[:10],
        }
        index.append(entry)
        # Core file holds only what category.json does not already carry; the app merges the two.
        brand = {'id': sid, 'slug': entry['slug'], 'name': name}
        brand['ai'] = {p: {k: fix_text(v) for k, v in blk.items()} for p, blk in ai.get('platforms', {}).items()}
        brand['aiMeta'] = {k: ai.get(k) for k in ('sampleSize', 'itemsAnalyzed', 'generatedAt', 'analysisType')}
        brand['comments'] = {}
        for p, block in ci.items():
            payload = block.get('payload') or {}
            brand['comments'][p] = {
                'sampleSize': block.get('sampleSize'), 'model': block.get('model'), 'generatedAt': block.get('generatedAt'),
                'synthesis': compact_synthesis(payload.get('synthesis')),
                'dimensions': {d: compact_dimension(d, v) for d, v in payload.items() if d != 'synthesis'},
            }
        comments = brand.pop('comments')
        json.dump(brand, open(os.path.join(OUT, 'brands', f'{sid}.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
        json.dump(comments, open(os.path.join(OUT, 'brands', f'{sid}.comments.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    index.sort(key=lambda b: -b['metrics']['emv'])
    json.dump({'brands': index, 'category': 'Female hair removal — EU', 'generatedFrom': 'brandwatch_query_segments_202609072014'}, open(os.path.join(OUT, 'category.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    print('brands:', [(b['id'], b['name']) for b in index])

    posts_path = os.path.join(RAW, 'posts.csv')
    if os.path.exists(posts_path):
        by_seg = collections.defaultdict(list)
        for r in csv.DictReader(open(posts_path, encoding='utf-8')):
            cs = load_json(r.get('computed_stats'), {}) or {}
            raw = load_json(r.get('rawData'), {}) or {}
            def num(k):
                try: return int(float(r.get(k) or 0))
                except Exception: return 0
            by_seg[int(r['segment_id'])].append({
                'id': r['post_id'], 'username': r['username'], 'platform': r['platform'], 'type': r['type'], 'url': r['url'],
                'text': fix_text((r.get('text') or r.get('title') or '')[:280]), 'publishedAt': (r.get('publishedAt') or '')[:10],
                'likes': num('likeCount'), 'comments': num('commentCount'), 'shares': num('shareCount'), 'views': num('viewCount'),
                'emv': round(cs.get('emv') or 0, 1), 'tier': cs.get('tier'), 'country': cs.get('country'), 'followers': cs.get('followers') or 0,
                'sentiment': (raw.get('sentiment') or cs.get('sentiment') or 'neutral'), 'paid': bool(cs.get('is_paid')),
            })
        for sid, posts in by_seg.items():
            posts.sort(key=lambda p: -(p['likes'] + p['comments'] * 3 + p['shares'] * 2))
            json.dump({'segment': sid, 'total': len(posts), 'posts': posts[:40]}, open(os.path.join(OUT, 'posts', f'{sid}.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
            print('posts', sid, len(posts))

if __name__ == '__main__':
    main()
