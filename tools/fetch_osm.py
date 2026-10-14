#!/usr/bin/env python3
"""ينزّل شوارع ومباني إسكندرية من OpenStreetMap (Overpass) ويحوّلها لملفات صغيرة للعبة.

الإخراج: data/osm/index.json + data/osm/c_<cx>_<cz>.json (قطع ٥٠٠×٥٠٠ متر)
الإحداثيات بالديسيمتر حوالين مكان المركز: x شرق، z جنوب.
البيانات © OpenStreetMap contributors — رخصة ODbL.
"""
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request

ORIGIN = (31.229128, 29.958118)  # المركز
BBOX = (31.170, 29.850, 31.300, 30.030)  # جنوب، غرب، شمال، شرق (من قايتباي للمنتزه)
CHUNK = 500  # متر
OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'osm')
MIRRORS = [
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass-api.de/api/interpreter',
]
CACHE = os.environ.get('OSM_CACHE', '')  # فولدر لحفظ كل مربع (عشان لو وقف نكمّل من مكانه)
ROAD_TYPES = {
    'motorway': 1, 'trunk': 1, 'primary': 2, 'secondary': 3, 'tertiary': 4,
    'motorway_link': 2, 'trunk_link': 2, 'primary_link': 3, 'secondary_link': 4, 'tertiary_link': 4,
    'unclassified': 5, 'residential': 5, 'living_street': 6, 'service': 6, 'pedestrian': 7,
}

STEP = 0.025  # درجة — مربعات صغيرة عشان سيرفرات Overpass متتقلش


def query(s, w, n, e):
    b = f'{s},{w},{n},{e}'
    return f"""
[out:json][timeout:180];
(
  way["building"]({b});
  way["highway"~"^({'|'.join(ROAD_TYPES)})$"]({b});
  way["natural"="coastline"]({b});
  way["leisure"~"^(park|garden)$"]({b});
);
out tags geom qt;
"""


def fetch_tile(s, w, n, e):
    cache = CACHE and os.path.join(CACHE, f'{s:.3f}_{w:.3f}.json')
    if cache and os.path.exists(cache):
        with open(cache) as f:
            return json.load(f)
    els = fetch_tile_net(s, w, n, e)
    if cache:
        os.makedirs(CACHE, exist_ok=True)
        with open(cache, 'w') as f:
            json.dump(els, f)
    return els


def fetch_tile_net(s, w, n, e):
    data = urllib.parse.urlencode({'data': query(s, w, n, e)}).encode()
    for attempt in range(4):
        for url in MIRRORS:
            try:
                req = urllib.request.Request(url, data=data, headers={'User-Agent': 'markazgame-osm/1.0'})
                with urllib.request.urlopen(req, timeout=300) as r:
                    return json.load(r)['elements']
            except Exception as e:  # noqa: BLE001
                print('  failed', url, e, file=sys.stderr)
                time.sleep(5)
        time.sleep(20 * (attempt + 1))
    sys.exit(f'all Overpass mirrors failed for tile {s},{w}')


def fetch(on_progress=None):
    seen, elements = set(), []
    lats = [BBOX[0] + i * STEP for i in range(math.ceil((BBOX[2] - BBOX[0]) / STEP))]
    lons = [BBOX[1] + i * STEP for i in range(math.ceil((BBOX[3] - BBOX[1]) / STEP))]
    # الأقرب للمركز الأول عشان اللعبة تشتغل حوالين المركز بدري
    tiles = sorted(((la, lo) for la in lats for lo in lons),
                   key=lambda t: (t[0] + STEP / 2 - ORIGIN[0]) ** 2 + ((t[1] + STEP / 2 - ORIGIN[1]) * 0.86) ** 2)
    total = len(tiles)
    k = 0
    for la, lo in tiles:
        if True:
            k += 1
            els = fetch_tile(la, lo, min(la + STEP, BBOX[2]), min(lo + STEP, BBOX[3]))
            new = [el for el in els if el['id'] not in seen]
            seen.update(el['id'] for el in new)
            elements.extend(new)
            print(f'tile {k}/{total}: +{len(new)} (total {len(elements)})', file=sys.stderr)
            if on_progress and (k <= 4 or k % 4 == 0):
                on_progress({'elements': elements}, k, total)
            time.sleep(1)
    return {'elements': elements}


def main():
    def progress(osm, k, total):
        write(osm, f'{k}/{total}')

    write(fetch(progress), 'complete')


def write(osm, status):
    lat0, lon0 = ORIGIN
    m_lon = 111320 * math.cos(math.radians(lat0))
    m_lat = 110574

    def local(p):
        return round((p['lon'] - lon0) * m_lon * 10), round(-(p['lat'] - lat0) * m_lat * 10)

    def height(tags):
        try:
            if 'height' in tags:
                return round(float(tags['height'].split()[0].replace(',', '.')) * 10)
            if 'building:levels' in tags:
                return round(float(tags['building:levels'].replace(',', '.')) * 32)
        except ValueError:
            pass
        return 0  # مش معروف → اللعبة بتقدّر

    chunks = {}

    def put(kind, pts, item):
        xs = pts[0::2]
        zs = pts[1::2]
        cx = math.floor(sum(xs) / len(xs) / 10 / CHUNK)
        cz = math.floor(sum(zs) / len(zs) / 10 / CHUNK)
        chunks.setdefault((cx, cz), {'b': [], 'r': [], 'c': [], 'p': []})[kind].append(item)

    counts = {'b': 0, 'r': 0, 'c': 0, 'p': 0}
    for el in osm.get('elements', []):
        geom = el.get('geometry')
        if not geom or len(geom) < 2:
            continue
        tags = el.get('tags', {})
        pts = []
        for p in geom:
            pts.extend(local(p))
        if 'building' in tags:
            if len(geom) < 4:
                continue
            pts = pts[:-2] if pts[:2] == pts[-2:] else pts  # من غير تكرار أول نقطة
            put('b', pts, [height(tags)] + pts)
            counts['b'] += 1
        elif 'highway' in tags:
            lanes = tags.get('lanes', '')
            lanes = int(lanes) if lanes.isdigit() else 0
            one = 1 if tags.get('oneway') in ('yes', '1', 'true') or tags.get('junction') == 'roundabout' else 0
            put('r', pts, [ROAD_TYPES[tags['highway']], lanes, one] + pts)
            counts['r'] += 1
        elif tags.get('natural') == 'coastline':
            put('c', pts, pts)
            counts['c'] += 1
        else:
            put('p', pts, pts)
            counts['p'] += 1

    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        if f.startswith('c_') and f.endswith('.json'):
            os.remove(os.path.join(OUT, f))
    for (cx, cz), c in chunks.items():
        with open(os.path.join(OUT, f'c_{cx}_{cz}.json'), 'w') as f:
            json.dump(c, f, separators=(',', ':'))
    index = {
        'origin': {'lat': lat0, 'lon': lon0},
        'bbox': BBOX,
        'chunk': CHUNK,
        'unit': 0.1,
        'chunks': sorted([[cx, cz] for cx, cz in chunks]),
        'counts': counts,
        'generated': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'status': status,
        'attribution': '© OpenStreetMap contributors (ODbL)',
        'roadTypes': ROAD_TYPES,
    }
    with open(os.path.join(OUT, 'index.json'), 'w') as f:
        json.dump(index, f, ensure_ascii=False, indent=1)
    print(json.dumps(counts), file=sys.stderr)


if __name__ == '__main__':
    main()
