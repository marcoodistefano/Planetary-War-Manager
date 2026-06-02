import json
with open('shared/assets/map/archs.json', encoding='utf-8') as f:
    d = json.load(f)
geoms = d['objects']['archs1']['geometries']
recent = geoms[-50:]
with open('temp.txt', 'w', encoding='utf-8') as out:
    for g in recent:
        out.write(f"{g.get('id')} - {g.get('properties',{}).get('city1')} to {g.get('properties',{}).get('city2')}\n")
