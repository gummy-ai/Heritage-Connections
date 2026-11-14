"""Export the site's recommendation data from the real model, read-only.

Writes two files into --output:
  recommendations.json      25 scenarios (5 seed artifacts x 5 interests): the top 6 and their
                            CAFE explanation weights, from the original recommend_top_n and
                            compute_importance. Same schema as before, plus metadata.temperature.
  recommendation-pool.json  For every scenario, the ranked candidate pool (top --pool by model
                            score) and, for every pooled artifact, its attributes and the raw
                            CAFE edge scores s_k = -RotatE distance(head, relation, tail).
                            The browser filters the pool and recomputes CAFE exactly
                            (softmaxes + interest boost + normalisation) for whatever six it shows.

temperature 0 (default) = the original use_sampling=False path: a stable descending sort,
so results are identical on every run. temperature > 0 = the original softmax(score / T)
sampling without replacement, seeded by --seed.

Run with the model project's environment, for example:
  /path/online-learning/2026-09-05/.venv-report/bin/python scripts/export_recommendations.py \
      --project /path/online-learning/2026-09-05 --output /tmp/rec-export
No checkpoint, model, or source file is written; the checkpoint hash is verified unchanged.
"""
from argparse import ArgumentParser, Namespace
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import sys

parser = ArgumentParser()
parser.add_argument('--project', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--temperature', type=float, default=0.0)
parser.add_argument('--pool', type=int, default=120)
parser.add_argument('--seed', type=int, default=7)
cli = parser.parse_args()
if cli.temperature < 0:
    parser.error('--temperature must be >= 0')
root = cli.project.resolve()
sys.path.insert(0, str(root))

import pandas as pd  # noqa: E402
import torch  # noqa: E402
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
attr_by_node = {}
for head, rel, tail in state['triples'].tolist():
    attr_by_node.setdefault(head, set()).add((RELATIONS[rel], entities[tail]))

BASE_IDS = ['신수14621', '동원1347', '동원285', '신수11349', '신수10147']
INTERESTS = [
    {'id': 'all', 'label': '관심사 없음', 'relation': '', 'value': ''},
    {'id': 'goryeo', 'label': '고려의 미감', 'relation': '시대', 'value': '고려'},
    {'id': 'joseon', 'label': '조선의 일상', 'relation': '시대', 'value': '조선'},
    {'id': 'celadon', 'label': '청자의 빛', 'relation': '재질 2', 'value': '청자'},
    {'id': 'metal', 'label': '금속의 공예', 'relation': '재질 1', 'value': '금속'},
]


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


def make_args(heritage_id, interest, count):
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
    args.relation_id = interest['relation']
    args.tail_id = interest['value']
    return args


scenarios, catalog, pools, pooled = {}, {}, {}, set()
for heritage_id in BASE_IDS:
    base = next(i for i in state['items'].values()
                if i.heritage_id == heritage_id and i.institution == '국립중앙박물관')
    catalog[heritage_id] = compact_item(base.head_key)
    pooled.add(base.head_key)
    base_attrs = attr_by_node[node_ids[base.head_key]]
    for interest in INTERESTS:
        args = make_args(heritage_id, interest, cli.pool)
        torch.manual_seed(cli.seed)
        ranked, _, nodes, relations, triples = recommend_top_n(args, state=state, model=model)
        top = ranked.iloc[:6].reset_index(drop=True)
        args.num_of_recommend = 6
        edges, weights = compute_importance(args, top, model, nodes, relations, triples)
        key = f'{heritage_id}|{interest["id"]}'
        pools[key] = [[r['head_key'], round(float(r['embedding_score']), 7)] for r in ranked.to_dict('records')]
        pooled.update(hk for hk, _ in pools[key])
        recs = []
        for rec in top.to_dict('records'):
            hk = rec['head_key']
            info = compact_item(hk)
            catalog.setdefault(info['id'], info)
            rec_attrs = attr_by_node[int(rec['entity_id'])]
            shared = [{'relation': r, 'value': t} for r, t in sorted(base_attrs & rec_attrs)
                      if r not in exclude_edges and t not in args.exclude_nodes]
            recs.append({
                'id': info['id'], 'headKey': hk, 'name': info['name'], 'institution': info['institution'],
                'score': float(rec['embedding_score']), 'hall': info['hall'], 'era': info['era'],
                'material': info['material'], 'materialDetail': info['materialDetail'],
                'sharedAttributes': shared,
                'interestMatched': bool(interest['relation'] and (interest['relation'], interest['value']) in rec_attrs),
                'explanationEdges': [{'relation': r['relation'], 'value': r['tail_key'], 'weight': float(r['edge_weight'])}
                                     for r in edges[edges['head_key'] == hk].to_dict('records')],
            })
        scenarios[key] = {
            'input': {'heritageId': heritage_id, 'institution': args.institution,
                      'relationId': args.relation_id, 'tailId': args.tail_id,
                      'viewTimeMinutes': 10, 'mode': 'v1', 'topK': 6},
            'recommendations': recs,
            'explanations': [{'relation': r['relation'], 'value': r['tail_key'], 'weight': float(r['final_rel_tail_weight'])}
                             for r in weights.to_dict('records')],
            'subgraphEdgeCount': len(edges),
        }
        print(key, [r['name'] for r in recs], flush=True)

# Raw CAFE edge scores for every pooled artifact, filtered exactly like compute_importance.
pooled_ids = {node_ids[hk] for hk in pooled}
excl_node_ids = {node_ids[n] for n in exclude_nodes if n in node_ids}
excl_rel_ids = {rel_ids[n] for n in exclude_edges if n in rel_ids}
triples = sorted((h, r, t) for h, r, t in map(tuple, state['triples'].tolist())
                 if h in pooled_ids and t not in excl_node_ids and r not in excl_rel_ids)
h, r, t = (list(col) for col in zip(*triples))
with torch.no_grad():
    s_k = (-model.calc_kg_distance(*torch.tensor([h, r, t]))).numpy().tolist()
edges_by_head = {}
for (hh, rr, tt), score in zip(triples, s_k):
    edges_by_head.setdefault(entities[hh], []).append([rr, entities[tt], round(score, 6)])

items = {}
for hk in sorted(pooled):
    info = compact_item(hk, describe=280)
    items[hk] = {
        'id': info['id'], 'name': info['name'], 'era': info['era'], 'material': info['material'],
        'materialDetail': info['materialDetail'], 'description': info['description'],
        'attributes': [[a['relation'], a['value']] for a in info['attributes']],
        'edges': edges_by_head.get(hk, []),
    }

assert hashlib.sha256(checkpoint.read_bytes()).hexdigest() == before_hash
metadata = {
    'generatedAt': datetime.now(timezone.utc).isoformat(),
    'kind': 'precomputed-actual-model-inference',
    'inference': 'CPU PyTorch; original recommend_top_n and compute_importance',
    'modelFile': 'runtime/model.pt', 'modelSha256': before_hash, 'snapshotId': state['snapshot_id'],
    'artifactCount': len(state['items']), 'entityCount': len(entities), 'tripleCount': len(state['triples']),
    'sourceFiles': ['src/recommend.py', 'src/importance.py', 'models/kgat.py', 'utils/preprocess.py',
                    'config/advanced.py', 'config/settings.json'],
    'seed': cli.seed,
    'temperature': cli.temperature,
    'demoOverrides': {'mode_2': 'v1', 'use_sampling': cli.temperature > 0, 'num_of_recommend': 6},
    'scoring': {'currentArtifactWeight': 1 - RECOMMENDATION['para_sim'], 'interestWeight': RECOMMENDATION['para_sim'],
                'interestExplanationBoost': RECOMMENDATION['interest_boost'], 'gamma': RECOMMENDATION['gamma']},
    'explanationMethod': 'CAFE: relation weight × conditional tail weight; then interest boost and normalization',
    'notes': [
        'Results are real measured model outputs, exported in advance for GitHub Pages.',
        'The browser does not execute live PyTorch inference.',
        'temperature 0 means the original deterministic ranking (use_sampling=False): identical on every run.',
        'The demonstration uses web mode V1: all current artifacts, without the V2 exhibition filter or V3 robot route filter.',
        'Scores are embedding similarity scores, not probabilities or percentages of recommendation accuracy.',
        'Explanatory edge weights are normalized across the complete recommended subgraph, not separately within each artifact.',
        'The raw checkpoint was read only and its SHA-256 was verified unchanged.',
    ],
}
pool_meta = {**metadata, 'poolSize': cli.pool, 'excludeNodes': sorted(exclude_nodes), 'excludeEdges': sorted(exclude_edges),
             'note': 'pools[scenario] = [[headKey, embedding score], ...] in model order; items[headKey].edges = '
                     '[[relationIndex, tail, s_k], ...] with s_k = -RotatE squared distance (compute_importance input).'}
cli.output.mkdir(parents=True, exist_ok=True)
(cli.output / 'recommendations.json').write_text(json.dumps(
    {'metadata': metadata, 'baseArtifactIds': BASE_IDS, 'interests': INTERESTS, 'catalog': catalog, 'scenarios': scenarios},
    ensure_ascii=False, indent=2), encoding='utf-8')
(cli.output / 'recommendation-pool.json').write_text(json.dumps(
    {'metadata': pool_meta, 'relations': list(RELATIONS), 'pools': pools, 'items': items},
    ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print('DONE', len(scenarios), 'scenarios', len(items), 'pooled artifacts', len(triples), 'edges')
