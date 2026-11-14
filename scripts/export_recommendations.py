"""Export the site's recommendation data from the real model, read-only.

The visitor picks attributes of the seed artifact (its own triples) as interests. In the
model that is para_sim conditioning: score = (1 - para_sim) * cos(seed, item)
+ para_sim * mean over chosen (relation, tail) of compute_condition_similarity(item, r, t),
the same as recommend_top_n with comma-separated relation_id / tail_id.

Writes into --output:
  recommendations.json      catalog + the no-interest top 6 per seed (original functions).
  recommendation-pool.json  per seed: its attribute chips and a candidate pool (union of the
                            top --pool by seed similarity and by each single-chip score) with
                            the seed similarity and every chip's condition similarity, so the
                            browser recomputes the model score for any chip combination; plus
                            every pooled artifact's attributes and raw CAFE edge scores s_k.

temperature 0 (default) = the original use_sampling=False ranking (stable descending sort).
With --verify, every single chip, every pair of chips and every whole attribute group is run
through the original recommend_top_n and compared with the browser computation.

  /path/online-learning/2026-09-05/.venv-report/bin/python scripts/export_recommendations.py \
      --project /path/online-learning/2026-09-05 --output /tmp/rec-export --verify
No checkpoint, model, or source file is written; the checkpoint hash is verified unchanged.
"""
from argparse import ArgumentParser, Namespace
from datetime import datetime, timezone
from itertools import combinations
from pathlib import Path
import hashlib
import json
import sys

parser = ArgumentParser()
parser.add_argument('--project', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--temperature', type=float, default=0.0)
parser.add_argument('--pool', type=int, default=150)
parser.add_argument('--seed', type=int, default=7)
parser.add_argument('--verify', action='store_true')
cli = parser.parse_args()
root = cli.project.resolve()
sys.path.insert(0, str(root))

import pandas as pd  # noqa: E402
import torch  # noqa: E402
import torch.nn.functional as F  # noqa: E402
from config.advanced import RECOMMENDATION  # noqa: E402
from config.settings import load_settings  # noqa: E402
from src.update import load_state, load_model  # noqa: E402
from src.recommend import recommend_top_n  # noqa: E402
from src.importance import compute_importance  # noqa: E402
from utils.preprocess import RELATIONS  # noqa: E402

torch.set_num_threads(2)
checkpoint = root / 'runtime/model.pt'
before_hash = hashlib.sha256(checkpoint.read_bytes()).hexdigest()
state = load_state(checkpoint)
model = load_model(state).cpu().eval()
settings = load_settings(root / 'config/settings.json')
frame = pd.read_excel(root / settings['paths']['excel'], sheet_name='sheet1').fillna('')
rows = {(str(r['소장기관']).strip(), str(r['소장품번호']).strip()): r for r in frame.to_dict('records')}
entities = state['entities']
node_ids = {name: i for i, name in enumerate(entities)}
rel_ids = {name: i for i, name in enumerate(RELATIONS)}
exclude_edges = set(RECOMMENDATION['exclude_edges'])
exclude_nodes = set(settings['recommendation'].get('exclude_nodes', []))
para_sim = float(RECOMMENDATION['para_sim'])
attr_by_node = {}
for head, rel, tail in state['triples'].tolist():
    attr_by_node.setdefault(head, set()).add((RELATIONS[rel], entities[tail]))
BASE_IDS = ['신수14621', '동원1347', '동원285', '신수11349', '신수10147']
GROUPS = [['시대'], ['재질 1', '재질 2'], ['문양'], ['유물분류 4'], ['유물분류 2', '유물분류 3'], ['국적', '출토지', '출토지_상세']]


def compact_item(head_key, describe=500):
    item = state['items'][head_key]
    row = rows.get((item.institution, item.heritage_id), {})
    attrs = sorted(attr_by_node.get(node_ids[head_key], ()))
    return {
        'id': item.heritage_id, 'headKey': head_key, 'name': row.get('유물') or item.heritage_id,
        'institution': item.institution, 'era': row.get('시대', ''),
        'material': row.get('재질 1', ''), 'materialDetail': row.get('재질 2', ''),
        'hall': item.exhibit_path or '', 'description': (item.description or '')[:describe],
        'attributes': [{'relation': r, 'value': t} for r, t in attrs if r not in exclude_edges],
    }


def make_args(heritage_id, chips, count):
    args = Namespace(**{**RECOMMENDATION, **settings['recommendation']})
    args.mode_2 = 'v1'
    args.use_sampling = cli.temperature > 0
    if cli.temperature > 0:
        args.temperature = cli.temperature
    args.num_of_recommend = count
    args.heri_id = heritage_id
    args.institution = '국립중앙박물관'
    args.head_key = ''
    args.robot_route_code = None
    args.target_exhibition = None
    args.relation_id = ','.join(r for r, _ in chips)
    args.tail_id = ','.join(t for _, t in chips)
    return args


items_meta = state['items']
item_ids = torch.tensor(sorted(node_ids[h] for h in items_meta), dtype=torch.long)
emb = model.entity_embed.weight
remb = model.relation_embed.weight
with torch.no_grad():
    heri = emb.index_select(0, item_ids)

catalog, seeds_out, scenarios, pooled = {}, {}, {}, set()
for heritage_id in BASE_IDS:
    base = next(i for i in items_meta.values() if i.heritage_id == heritage_id and i.institution == '국립중앙박물관')
    catalog[heritage_id] = compact_item(base.head_key)
    pooled.add(base.head_key)
    nh = node_ids[base.head_key]
    chips = sorted((r, t) for r, t in attr_by_node[nh] if r not in exclude_edges and t not in exclude_nodes)
    with torch.no_grad():
        sim_h = F.cosine_similarity(emb[nh].unsqueeze(0), heri)
        conds = [model.compute_condition_similarity(heri, remb[rel_ids[r]].unsqueeze(0), emb[node_ids[t]].unsqueeze(0)) for r, t in chips]
    keep = item_ids != nh
    cand = set()
    for score in [sim_h] + [(1 - para_sim) * sim_h + para_sim * c for c in conds]:
        s = score.clone(); s[~keep] = -9
        cand.update(item_ids[torch.argsort(s, descending=True, stable=True)[:cli.pool]].tolist())
    cand = sorted(cand)
    pos = {int(e): i for i, e in enumerate(item_ids.tolist())}
    head_of = {node_ids[h]: h for h in items_meta}
    seeds_out[heritage_id] = {
        'headKey': base.head_key,
        'chips': [[r, t] for r, t in chips],
        'candidates': [[head_of[e], e, round(float(sim_h[pos[e]]), 7), [round(float(c[pos[e]]), 7) for c in conds]] for e in cand],
    }
    pooled.update(head_of[e] for e in cand)
    # No-interest top 6 with the original functions (fallback and story scene).
    args = make_args(heritage_id, [], 6)
    torch.manual_seed(cli.seed)
    top, _, nodes, relations, triples = recommend_top_n(args, state=state, model=model)
    edges, weights = compute_importance(args, top, model, nodes, relations, triples)
    recs = []
    for rec in top.to_dict('records'):
        info = compact_item(rec['head_key'])
        catalog.setdefault(info['id'], info)
        recs.append({**{k: info[k] for k in ('id', 'headKey', 'name', 'institution', 'hall', 'era', 'material', 'materialDetail')},
                     'score': float(rec['embedding_score']),
                     'explanationEdges': [{'relation': r['relation'], 'value': r['tail_key'], 'weight': float(r['edge_weight'])}
                                          for r in edges[edges['head_key'] == rec['head_key']].to_dict('records')]})
    scenarios[f'{heritage_id}|all'] = {'recommendations': recs}
    print(heritage_id, len(chips), 'chips,', len(cand), 'candidates', flush=True)

excl_node_ids = {node_ids[n] for n in exclude_nodes if n in node_ids}
excl_rel_ids = {rel_ids[n] for n in exclude_edges if n in rel_ids}
pooled_ids = {node_ids[h] for h in pooled}
triples = sorted((h, r, t) for h, r, t in map(tuple, state['triples'].tolist())
                 if h in pooled_ids and t not in excl_node_ids and r not in excl_rel_ids)
h, r, t = (list(c) for c in zip(*triples))
with torch.no_grad():
    s_k = (-model.calc_kg_distance(*torch.tensor([h, r, t]))).numpy().tolist()
edges_by_head = {}
for (hh, rr, tt), sc in zip(triples, s_k):
    edges_by_head.setdefault(entities[hh], []).append([rr, entities[tt], round(sc, 6)])
items = {}
for hk in sorted(pooled):
    info = compact_item(hk, describe=280)
    items[hk] = {'id': info['id'], 'name': info['name'], 'era': info['era'], 'material': info['material'],
                 'materialDetail': info['materialDetail'], 'description': info['description'],
                 'attributes': [[a['relation'], a['value']] for a in info['attributes']], 'edges': edges_by_head.get(hk, [])}


def browser_top6(seed, sel):
    out = []
    for hk, eid, sh, cs in seed['candidates']:
        score = sh if not sel else (1 - para_sim) * sh + para_sim * sum(cs[i] for i in sel) / len(sel)
        out.append((-score, eid, hk))
    return [hk for _, _, hk in sorted(out)[:6]]


if cli.verify and cli.temperature == 0:
    total = same = 0
    for heritage_id, seed in seeds_out.items():
        chips = [tuple(c) for c in seed['chips']]
        subsets = [(i,) for i in range(len(chips))] + list(combinations(range(len(chips)), 2))
        for grp in GROUPS:
            g = tuple(i for i, c in enumerate(chips) if c[0] in grp)
            if len(g) > 1 and g not in subsets:
                subsets.append(g)
        for sel in subsets:
            args = make_args(heritage_id, [chips[i] for i in sel], 6)
            torch.manual_seed(cli.seed)
            top = recommend_top_n(args, state=state, model=model)[0]
            total += 1
            if top['head_key'].tolist() == browser_top6(seed, sel):
                same += 1
            else:
                print('MISMATCH', heritage_id, [chips[i] for i in sel], flush=True)
    print(f'verify: browser top 6 == original recommend_top_n in {same}/{total} chip combinations')

assert hashlib.sha256(checkpoint.read_bytes()).hexdigest() == before_hash
metadata = {
    'generatedAt': datetime.now(timezone.utc).isoformat(), 'kind': 'precomputed-actual-model-inference',
    'inference': 'CPU PyTorch; original recommend_top_n, compute_condition_similarity and compute_importance',
    'modelFile': 'runtime/model.pt', 'modelSha256': before_hash, 'snapshotId': state['snapshot_id'],
    'artifactCount': len(items_meta), 'entityCount': len(entities), 'tripleCount': len(state['triples']),
    'seed': cli.seed, 'temperature': cli.temperature, 'mode': 'v1', 'poolPerScore': cli.pool,
    'scoring': {'currentArtifactWeight': 1 - para_sim, 'interestWeight': para_sim,
                'interestExplanationBoost': RECOMMENDATION['interest_boost'], 'gamma': RECOMMENDATION['gamma']},
    'excludeNodes': sorted(exclude_nodes), 'excludeEdges': sorted(exclude_edges),
    'notes': ['Chips are the seed artifact\'s own (relation, tail) triples; choosing chips = para_sim interest conditions (mean of condition similarities).',
              'temperature 0 = original deterministic ranking (use_sampling=False).',
              'Scores are embedding similarity scores, not probabilities or accuracy.',
              'CAFE weights are normalized across the six shown artifacts.'],
}
cli.output.mkdir(parents=True, exist_ok=True)
(cli.output / 'recommendations.json').write_text(json.dumps(
    {'metadata': metadata, 'baseArtifactIds': BASE_IDS, 'catalog': catalog, 'scenarios': scenarios},
    ensure_ascii=False, indent=2), encoding='utf-8')
(cli.output / 'recommendation-pool.json').write_text(json.dumps(
    {'metadata': metadata, 'relations': list(RELATIONS), 'seeds': seeds_out, 'items': items},
    ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print('DONE', len(items), 'pooled artifacts', len(triples), 'edges')
