#!/usr/bin/env python3

"""
Sanitize manual edges in TopoJSON archs.json.
- Identifies features with missing metadata (city1, city2, distance = null).
- Decodes spatial arcs to physical coordinates.
- Matches endpoints to nearest cities in cities.json.
- Recalculates distance segment-by-segment using Haversine formula.
- Removes styling artifacts like "stroke-width".
"""

import json
import math
import argparse
from pathlib import Path
from dataclasses import dataclass
from typing import Any, Iterable

EARTH_RADIUS_METERS = 6_371_000.0


# ==============================================================================
# STRUTTURE DATI E GEOMETRIA
# ==============================================================================

@dataclass(frozen=True)
class CityNode:
    name: str
    lon: float
    lat: float

def haversine_meters(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    lon1_rad = math.radians(lon1)
    lat1_rad = math.radians(lat1)
    lon2_rad = math.radians(lon2)
    lat2_rad = math.radians(lat2)
    delta_lon = lon2_rad - lon1_rad
    delta_lat = lat2_rad - lat1_rad
    a = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon / 2) ** 2
    )
    return 2 * EARTH_RADIUS_METERS * math.asin(min(1.0, math.sqrt(a)))

def segment_length(points: list[tuple[float, float]]) -> float:
    total = 0.0
    for start, end in zip(points, points[1:]):
        total += haversine_meters(start[0], start[1], end[0], end[1])
    return total

class TopologyDecoder:
    """Decodifica le coordinate delta codificate del TopoJSON in veri float Lat/Lon."""
    def __init__(self, topology: dict[str, Any]):
        self.topology = topology
        self.transform = topology.get("transform") or {}
        self.arcs = topology.get("arcs", [])
        self.arc_cache: dict[int, list[tuple[float, float]]] = {}

    def decode_point(self, raw_x: float, raw_y: float) -> tuple[float, float]:
        scale = self.transform.get("scale")
        translate = self.transform.get("translate")
        if scale and translate:
            return (
                raw_x * scale[0] + translate[0],
                raw_y * scale[1] + translate[1],
            )
        return raw_x, raw_y

    def decode_arc(self, index: int) -> list[tuple[float, float]]:
        if index in self.arc_cache:
            return self.arc_cache[index]

        raw_arc = self.arcs[index]
        x, y = 0.0, 0.0
        coordinates: list[tuple[float, float]] = []
        for delta_x, delta_y in raw_arc:
            x += delta_x
            y += delta_y
            coordinates.append(self.decode_point(x, y))

        self.arc_cache[index] = coordinates
        return coordinates

    def decode_arc_ref(self, ref: int) -> list[tuple[float, float]]:
        if ref >= 0:
            return self.decode_arc(ref)
        return list(reversed(self.decode_arc(~ref)))

    def merge_arc_refs(self, refs: list[int]) -> list[tuple[float, float]]:
        merged: list[tuple[float, float]] = []
        for position, ref in enumerate(refs):
            arc = self.decode_arc_ref(ref)
            if position > 0 and merged and arc:
                merged.extend(arc[1:])
            else:
                merged.extend(arc)
        return merged


# ==============================================================================
# ALGORITMI DI RICERCA E PARSING
# ==============================================================================

def iter_geometries(node: Any) -> Iterable[dict[str, Any]]:
    if isinstance(node, dict):
        node_type = node.get("type")
        if node_type == "GeometryCollection":
            for geometry in node.get("geometries", []):
                yield from iter_geometries(geometry)
        elif node_type in {"Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon"}:
            yield node
        else:
            for value in node.values():
                yield from iter_geometries(value)
    elif isinstance(node, list):
        for item in node:
            yield from iter_geometries(item)


def extract_cities(cities_topology: dict[str, Any]) -> list[CityNode]:
    cities: list[CityNode] = []
    decoder = TopologyDecoder(cities_topology)
    for geometry in iter_geometries(cities_topology.get("objects", {})):
        if geometry.get("type") != "Point":
            continue
        properties = geometry.get("properties") or {}
        coordinates = geometry.get("coordinates") or []
        if len(coordinates) == 2:
            # I Points del cities.json potrebbero non necessitare del transform, ma usiamo il decoder per sicurezza
            lon, lat = decoder.decode_point(float(coordinates[0]), float(coordinates[1]))
            cities.append(
                CityNode(
                    name=str(properties.get("NAME") or properties.get("name") or ""),
                    lon=lon,
                    lat=lat
                )
            )
    return cities


def find_closest_city(lon: float, lat: float, cities: list[CityNode]) -> str:
    closest = min(cities, key=lambda c: haversine_meters(lon, lat, c.lon, c.lat))
    return closest.name


# ==============================================================================
# CORE LOGIC
# ==============================================================================

def main():
    parser = argparse.ArgumentParser(description="Sanitize manual archs in archs.json")
    parser.add_argument("--map-dir", type=Path, default=Path("shared/assets/map"), help="Map assets directory")
    args = parser.parse_args()

    cities_path = args.map_dir / "./cities.json"
    archs_path = args.map_dir / "./archs.json"

    print(f"Loading data from {args.map_dir.resolve()}...")
    
    with open(cities_path, "r", encoding="utf-8") as f:
        cities_topo = json.load(f)
    cities = extract_cities(cities_topo)

    with open(archs_path, "r", encoding="utf-8") as f:
        archs_topo = json.load(f)

    decoder = TopologyDecoder(archs_topo)

    # 1. Trova l'ID incrementale massimo già esistente per mantenere la coerenza
    max_id = 0
    for geom in iter_geometries(archs_topo.get("objects", {})):
        props = geom.get("properties", {})
        fid = props.get("id") or geom.get("id")
        if isinstance(fid, str) and fid.startswith("path"):
            try:
                num = int(fid[4:])
                max_id = max(max_id, num)
            except ValueError:
                pass

    print(f"Max existing valid path ID is: path{max_id}")

    # 2. Scansione e Sanitizzazione Globale
    modified_count = 0
    for geom in iter_geometries(archs_topo.get("objects", {})):
        if geom.get("type") in {"LineString", "MultiLineString"}:
            props = geom.get("properties", {})
            
            # --- PURGE GLOBALE: Rimuove gli artefatti grafici da tutti gli archi
            if "stroke-width" in props:
                del props["stroke-width"]

            # --- CORREZIONE RECORD BROKEN
            if props.get("id") is None or props.get("city1") is None or props.get("distance") is None:
                arc_refs = geom.get("arcs", [])
                if not arc_refs:
                    continue

                # MultiLineString ha un array in più di profondità, livelliamolo se necessario
                if geom.get("type") == "MultiLineString":
                    # Usiamo il primo segmento utile
                    arc_refs = arc_refs[0]

                # Traduciamo i delta del TopoJSON in coordinate reali (GSP) sulla mappa
                route_path = decoder.merge_arc_refs(arc_refs)
                if len(route_path) < 2:
                    continue

                # Il primo e l'ultimo nodo della linea spezzata
                start_pt = route_path[0]
                end_pt = route_path[-1]

                # Nearest-Neighbor Matching
                city1 = find_closest_city(start_pt[0], start_pt[1], cities)
                city2 = find_closest_city(end_pt[0], end_pt[1], cities)
                
                # Calcolo distanza totale seguendo le curve dell'arco
                dist = int(round(segment_length(route_path)))

                # Generazione ID coerente
                max_id += 1
                new_id = f"path{max_id}"

                # Iniezione Parametri Sanitizzati
                geom["id"] = new_id
                props["id"] = new_id
                props["city1"] = city1
                props["city2"] = city2
                props["distance"] = dist
                props["road_type"] = 1
                props["pendenza"] = 1

                geom["properties"] = props
                modified_count += 1
                print(f" -> Fixed {new_id}: Connette {city1} a {city2} | Distanza: {dist} m")

    # 3. Salvataggio
    if modified_count > 0:
        with open(archs_path, "w", encoding="utf-8") as f:
            json.dump(archs_topo, f, ensure_ascii=False, indent=2)
        print(f"\n✅ Operazione completata. {modified_count} archi corrotti sono stati sanati ed integrati!")
    else:
        print("\nNessun arco corrotto trovato. Il file è già pulito.")

if __name__ == "__main__":
    main()