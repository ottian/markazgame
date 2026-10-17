"""يطلّع أماكن المستشفيات من بيانات OSM المقسّمة (data/osm) لملف واحد للمهمات."""
import glob, json, os

HERE = os.path.dirname(__file__)
OSM = os.path.join(HERE, '..', 'data', 'osm')
T_HOSP = 7
AR = {'Sharq Almadinah': 'مستشفى شرق المدينة', 'Mostafa Kamel': 'مستشفى مصطفى كامل العسكري'}
SKIP = ('معمل', 'معهد')

out, seen = [], set()
for f in sorted(glob.glob(os.path.join(OSM, 'c_*.json'))):
    d = json.load(open(f, encoding='utf-8'))
    for i, b in enumerate(d['b']):
        if b[2] != T_HOSP:
            continue
        name = AR.get(d['bn'].get(str(i), ''), d['bn'].get(str(i), ''))
        if not name or any(s in name for s in SKIP) or name in seen:
            continue
        seen.add(name)
        pts = b[3:]
        x = sum(pts[0::2]) / (len(pts) / 2) / 10
        z = sum(pts[1::2]) / (len(pts) / 2) / 10
        out.append({'name': name, 'x': round(x, 1), 'z': round(z, 1)})
json.dump({'hospitals': out}, open(os.path.join(OSM, 'pois.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(len(out), 'hospitals')
