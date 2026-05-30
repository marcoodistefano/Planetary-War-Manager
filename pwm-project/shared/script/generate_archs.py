#!/usr/bin/env python3

"""Generate adjacency and routed graph files from the shared map assets.

Inputs:
- cities.json: city nodes
- regions.json: province polygons used to infer adjacency
- map.json: country polygons used as a land mask
- roads.json: road polylines used as an optional path fallback

Outputs written to shared/assets/map/:
- aqrchs.json: adjacency matrix
- archs.json: routed graph edges
"""

from __future__ import annotations

import argparse
import json
import math
import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


EARTH_RADIUS_METERS = 6_371_000.0


# ==============================================================================
# STRUTTURE DATI HARDWARE-LEVEL
# ==============================================================================

class UnionFind:
    """Struttura dati per il tracciamento dei cluster disgiunti (Kruskal MST)."""
    def __init__(self, size: int):
        self.parent = list(range(size))
        self.rank = [0] * size

    def find(self, i: int) -> int:
        if self.parent[i] == i:
            return i
        self.parent[i] = self.find(self.parent[i])
        return self.parent[i]

    def union(self, i: int, j: int) -> bool:
        root_i = self.find(i)
        root_j = self.find(j)
        if root_i != root_j:
            if self.rank[root_i] < self.rank[root_j]:
                self.parent[root_i] = root_j
            elif self.rank[root_i] > self.rank[root_j]:
                self.parent[root_j] = root_i
            else:
                self.parent[root_j] = root_i
                self.rank[root_i] += 1
            return True
        return False


@dataclass(frozen=True)
class CityNode:
    index: int
    name: str
    province: str
    country: str
    lon: float
    lat: float
    population: int


@dataclass(frozen=True)
class RegionNode:
    index: int
    name: str
    country: str
    polygons: list[list[list[tuple[float, float]]]]
    arc_ids: set[int]
    bbox: tuple[float, float, float, float]


# ==============================================================================
# FUNZIONI GEOMETRICHE E MATEMATICHE
# ==============================================================================

def normalize_text(value: str | None) -> str:
    if not value:
        return ""
    normalized = unicodedata.normalize("NFKD", value)
    stripped = "".join(char for char in normalized if not unicodedata.combining(char))
    return " ".join(stripped.casefold().split())


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


def interpolate_points(
    start: tuple[float, float], end: tuple[float, float], samples: int
) -> list[tuple[float, float]]:
    samples = max(1, samples)
    points: list[tuple[float, float]] = []
    for step in range(samples + 1):
        ratio = step / samples
        lon = start[0] + (end[0] - start[0]) * ratio
        lat = start[1] + (end[1] - start[1]) * ratio
        points.append((lon, lat))
    return points


def bbox_contains(bbox: tuple[float, float, float, float], lon: float, lat: float) -> bool:
    min_lon, min_lat, max_lon, max_lat = bbox
    return min_lon <= lon <= max_lon and min_lat <= lat <= max_lat


def compute_rings_bbox(rings: list[list[tuple[float, float]]]) -> tuple[float, float, float, float]:
    min_lon = math.inf
    min_lat = math.inf
    max_lon = -math.inf
    max_lat = -math.inf
    for ring in rings:
        for lon, lat in ring:
            min_lon = min(min_lon, lon)
            min_lat = min(min_lat, lat)
            max_lon = max(max_lon, lon)
            max_lat = max(max_lat, lat)
    return min_lon, min_lat, max_lon, max_lat


def point_in_ring(point: tuple[float, float], ring: list[tuple[float, float]]) -> bool:
    lon, lat = point
    inside = False
    if len(ring) < 3:
        return False
    for index in range(len(ring)):
        x1, y1 = ring[index]
        x2, y2 = ring[(index + 1) % len(ring)]
        intersects = (y1 > lat) != (y2 > lat)
        if intersects:
            x_intersection = (x2 - x1) * (lat - y1) / ((y2 - y1) or 1e-12) + x1
            if lon < x_intersection:
                inside = not inside
    return inside


def point_in_polygon(point: tuple[float, float], polygon: list[list[tuple[float, float]]]) -> bool:
    if not polygon:
        return False
    bbox = compute_rings_bbox(polygon)
    if not bbox_contains(bbox, point[0], point[1]):
        return False

    inside = False
    for ring in polygon:
        if point_in_ring(point, ring):
            inside = not inside
    return inside


# ==============================================================================
# DECODER TOPOLOGICO
# ==============================================================================

class TopologyDecoder:
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
        x = 0.0
        y = 0.0
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
# ESTRAZIONE NODI E RETI
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


def collect_arc_ids(arcs_structure: Any) -> set[int]:
    arc_ids: set[int] = set()
    if isinstance(arcs_structure, int):
        # PATCH HARDWARE 1: Operatore Bitwise NOT per TopoJSON, non ABS()
        val = arcs_structure
        arc_ids.add(val if val >= 0 else ~val)
    elif isinstance(arcs_structure, list):
        for item in arcs_structure:
            arc_ids.update(collect_arc_ids(item))
    return arc_ids


def decode_polygon_geometry(decoder: TopologyDecoder, geometry: dict[str, Any]) -> list[list[list[tuple[float, float]]]]:
    arcs_structure = geometry.get("arcs") or []
    if geometry.get("type") == "Polygon":
        return [[decoder.merge_arc_refs(ring) for ring in arcs_structure if ring]]
    if geometry.get("type") == "MultiPolygon":
        polygons: list[list[list[tuple[float, float]]]] = []
        for polygon in arcs_structure:
            polygons.append([decoder.merge_arc_refs(ring) for ring in polygon if ring])
        return polygons
    return []


def decode_line_geometry(decoder: TopologyDecoder, geometry: dict[str, Any]) -> list[list[tuple[float, float]]]:
    arcs_structure = geometry.get("arcs") or []
    if geometry.get("type") == "LineString":
        return [decoder.merge_arc_refs(arcs_structure)]
    if geometry.get("type") == "MultiLineString":
        return [decoder.merge_arc_refs(line) for line in arcs_structure if line]
    return []


def extract_city_nodes(cities_topology: dict[str, Any]) -> list[CityNode]:
    cities: list[CityNode] = []
    for geometry in iter_geometries(cities_topology.get("objects", {})):
        if geometry.get("type") != "Point":
            continue
        properties = geometry.get("properties") or {}
        coordinates = geometry.get("coordinates") or []
        if len(coordinates) != 2:
            continue
        cities.append(
            CityNode(
                index=len(cities),
                name=str(properties.get("NAME") or ""),
                province=str(properties.get("ADM1NAME") or ""),
                country=str(properties.get("ADM0NAME") or ""),
                lon=float(coordinates[0]),
                lat=float(coordinates[1]),
                population=int(properties.get("POP_MAX") or 0),
            )
        )
    return cities


def extract_region_nodes(regions_topology: dict[str, Any]) -> tuple[list[RegionNode], TopologyDecoder]:
    decoder = TopologyDecoder(regions_topology)
    regions: list[RegionNode] = []
    for geometry in iter_geometries(regions_topology.get("objects", {})):
        if geometry.get("type") not in {"Polygon", "MultiPolygon"}:
            continue
        properties = geometry.get("properties") or {}
        polygons = decode_polygon_geometry(decoder, geometry)
        if not polygons:
            continue
        regions.append(
            RegionNode(
                index=len(regions),
                name=str(properties.get("name") or ""),
                country=str(properties.get("admin") or ""),
                polygons=polygons,
                arc_ids=collect_arc_ids(geometry.get("arcs")),
                bbox=compute_polygons_bbox(polygons),
            )
        )
    return regions, decoder


def compute_polygons_bbox(polygons: list[list[list[tuple[float, float]]]]) -> tuple[float, float, float, float]:
    min_lon = math.inf
    min_lat = math.inf
    max_lon = -math.inf
    max_lat = -math.inf
    for polygon in polygons:
        for ring in polygon:
            for lon, lat in ring:
                min_lon = min(min_lon, lon)
                min_lat = min(min_lat, lat)
                max_lon = max(max_lon, lon)
                max_lat = max(max_lat, lat)
    return min_lon, min_lat, max_lon, max_lat


def build_region_adjacency(regions: list[RegionNode]) -> dict[int, set[int]]:
    arc_to_regions: dict[int, list[int]] = defaultdict(list)
    for region in regions:
        for arc_id in region.arc_ids:
            arc_to_regions[arc_id].append(region.index)

    adjacency: dict[int, set[int]] = defaultdict(set)
    for region_indices in arc_to_regions.values():
        unique_indices = sorted(set(region_indices))
        if len(unique_indices) < 2:
            continue
        for left_position, left_index in enumerate(unique_indices):
            for right_index in unique_indices[left_position + 1 :]:
                adjacency[left_index].add(right_index)
                adjacency[right_index].add(left_index)
    return adjacency


def assign_city_regions(cities: list[CityNode], regions: list[RegionNode]) -> dict[int, int]:
    city_to_region: dict[int, int] = {}
    for city in cities:
        point = (city.lon, city.lat)
        containing_regions: list[int] = []
        for region in regions:
            if not bbox_contains(region.bbox, city.lon, city.lat):
                continue
            for polygon in region.polygons:
                if point_in_polygon(point, polygon):
                    containing_regions.append(region.index)
                    break
            if containing_regions:
                break
        
        if containing_regions:
            city_to_region[city.index] = containing_regions[0]
            continue

        # PATCH HARDWARE 2: Fallback Anti-Deriva. Calcolo distanza dai bordi del BBox, non dal centro!
        def distance_to_bbox(bbox: tuple[float, float, float, float]) -> float:
            min_lon, min_lat, max_lon, max_lat = bbox
            cx = max(min_lon, min(city.lon, max_lon))
            cy = max(min_lat, min(city.lat, max_lat))
            return haversine_meters(city.lon, city.lat, cx, cy)

        closest_region_index = min(
            regions,
            key=lambda region: distance_to_bbox(region.bbox),
        ).index
        city_to_region[city.index] = closest_region_index
    return city_to_region


def build_region_city_map(city_to_region: dict[int, int]) -> dict[int, list[int]]:
    region_to_cities: dict[int, list[int]] = defaultdict(list)
    for city_index, region_index in city_to_region.items():
        region_to_cities[region_index].append(city_index)
    return region_to_cities


def collect_land_polygons(map_topology: dict[str, Any]) -> list[list[list[tuple[float, float]]]]:
    polygons: list[list[list[tuple[float, float]]]] = []
    decoder = TopologyDecoder(map_topology)
    for geometry in iter_geometries(map_topology.get("objects", {})):
        if geometry.get("type") not in {"Polygon", "MultiPolygon"}:
            continue
        polygons.extend(decode_polygon_geometry(decoder, geometry))
    return polygons


def build_polygon_index(
    polygons: list[list[list[tuple[float, float]]]]
) -> list[tuple[tuple[float, float, float, float], list[list[tuple[float, float]]]]]:
    return [(compute_rings_bbox(polygon), polygon) for polygon in polygons]


def point_on_land(
    point: tuple[float, float],
    polygon_index: list[tuple[tuple[float, float, float, float], list[list[tuple[float, float]]]]],
) -> bool:
    lon, lat = point
    for bbox, polygon in polygon_index:
        if bbox_contains(bbox, lon, lat) and point_in_polygon(point, polygon):
            return True
    return False


# ==============================================================================
# ALGORITMO DI ROUTING E PATHFINDING
# ==============================================================================

def route_is_valid(
    route: list[tuple[float, float]],
    polygon_index: list[tuple[tuple[float, float, float, float], list[list[tuple[float, float]]]]],
) -> bool:
    if len(route) < 2:
        return False
    for start, end in zip(route, route[1:]):
        segment_distance = haversine_meters(start[0], start[1], end[0], end[1])
        samples = max(2, int(segment_distance / 2_000.0) + 1)
        for sample in interpolate_points(start, end, samples):
            if not point_on_land(sample, polygon_index):
                return False
    return True


def shared_border_waypoint(
    region_a: RegionNode,
    region_b: RegionNode,
    region_decoder: TopologyDecoder,
) -> tuple[float, float] | None:
    shared_arcs = region_a.arc_ids & region_b.arc_ids
    if not shared_arcs:
        return None

    best_arc: list[tuple[float, float]] | None = None
    best_length = -1.0
    for arc_id in shared_arcs:
        arc = region_decoder.decode_arc(arc_id)
        if len(arc) < 2:
            continue
        arc_length = segment_length(arc)
        if arc_length > best_length:
            best_length = arc_length
            best_arc = arc

    if not best_arc:
        return None
    return best_arc[len(best_arc) // 2]


def orient_polyline(
    polyline: list[tuple[float, float]], city_a: CityNode, city_b: CityNode
) -> list[tuple[float, float]]:
    forward = haversine_meters(city_a.lon, city_a.lat, polyline[0][0], polyline[0][1])
    forward += haversine_meters(city_b.lon, city_b.lat, polyline[-1][0], polyline[-1][1])
    reverse = haversine_meters(city_a.lon, city_a.lat, polyline[-1][0], polyline[-1][1])
    reverse += haversine_meters(city_b.lon, city_b.lat, polyline[0][0], polyline[0][1])
    if reverse < forward:
        return list(reversed(polyline))
    return polyline


def road_route_waypoint(
    city_a: CityNode,
    city_b: CityNode,
    road_polylines: list[list[tuple[float, float]]],
) -> list[tuple[float, float]] | None:
    if not road_polylines:
        return None

    midpoint = ((city_a.lon + city_b.lon) / 2.0, (city_a.lat + city_b.lat) / 2.0)
    scored: list[tuple[float, list[tuple[float, float]]]] = []
    for polyline in road_polylines:
        if len(polyline) < 2:
            continue
        center = polyline[len(polyline) // 2]
        score = haversine_meters(midpoint[0], midpoint[1], center[0], center[1])
        score += haversine_meters(city_a.lon, city_a.lat, polyline[0][0], polyline[0][1])
        score += haversine_meters(city_b.lon, city_b.lat, polyline[-1][0], polyline[-1][1])
        scored.append((score, polyline))

    scored.sort(key=lambda item: item[0])
    for _, polyline in scored[:50]:
        oriented = orient_polyline(polyline, city_a, city_b)
        route = [(city_a.lon, city_a.lat), *oriented, (city_b.lon, city_b.lat)]
        return route
    return None


def city_candidates_for_region(
    city: CityNode,
    city_to_region: dict[int, int],
    region_to_cities: dict[int, list[int]],
    region_adjacency: dict[int, set[int]],
) -> list[int]:
    region_index = city_to_region.get(city.index)
    candidate_indices: list[int] = []
    seen: set[int] = set()

    def add_region_cities(target_region_index: int) -> None:
        for candidate_index in region_to_cities.get(target_region_index, []):
            if candidate_index == city.index or candidate_index in seen:
                continue
            seen.add(candidate_index)
            candidate_indices.append(candidate_index)

    if region_index is not None:
        add_region_cities(region_index)
        for neighbor_region_index in sorted(region_adjacency.get(region_index, set())):
            add_region_cities(neighbor_region_index)

    return candidate_indices


def build_route(
    city_a: CityNode,
    city_b: CityNode,
    region_a: RegionNode,
    region_b: RegionNode,
    region_decoder: TopologyDecoder,
    polygon_index: list[tuple[tuple[float, float, float, float], list[list[tuple[float, float]]]]],
    road_polylines: list[list[tuple[float, float]]],
) -> list[tuple[float, float]] | None:
    direct_route = [(city_a.lon, city_a.lat), (city_b.lon, city_b.lat)]
    if route_is_valid(direct_route, polygon_index):
        return direct_route

    if region_a.index != region_b.index:
        border_waypoint = shared_border_waypoint(region_a, region_b, region_decoder)
        if border_waypoint is not None:
            border_route = [(city_a.lon, city_a.lat), border_waypoint, (city_b.lon, city_b.lat)]
            if route_is_valid(border_route, polygon_index):
                return border_route

    road_route = road_route_waypoint(city_a, city_b, road_polylines)
    if road_route is not None and route_is_valid(road_route, polygon_index):
        return road_route

    return None


def select_edges(
    cities: list[CityNode],
    regions: list[RegionNode],
    region_adjacency: dict[int, set[int]],
    city_to_region: dict[int, int],
    region_decoder: TopologyDecoder,
    polygon_index: list[tuple[tuple[float, float, float, float], list[list[tuple[float, float]]]]],
    road_polylines: list[list[tuple[float, float]]],
) -> list[dict[str, Any]]:
    
    region_to_cities = build_region_city_map(city_to_region)
    MAX_DEGREE = 8
    candidate_edges = []
    
    for city in cities:
        candidate_indices = city_candidates_for_region(
            city,
            city_to_region,
            region_to_cities,
            region_adjacency,
        )
        
        for candidate_index in candidate_indices:
            candidate_city = cities[candidate_index]
            
            if city.index >= candidate_city.index:
                continue
            if normalize_text(city.name) == normalize_text(candidate_city.name):
                continue

            left_region_idx = city_to_region.get(city.index)
            right_region_idx = city_to_region.get(candidate_city.index)
            
            if left_region_idx is None or right_region_idx is None:
                continue

            # Check robusto di adiacenza 
            if left_region_idx != right_region_idx and right_region_idx not in region_adjacency.get(left_region_idx, set()):
                continue

            left_region = regions[left_region_idx]
            right_region = regions[right_region_idx]
            
            route = build_route(
                city, candidate_city, left_region, right_region,
                region_decoder, polygon_index, road_polylines
            )
            
            if route is not None:
                dist = segment_length(route)
                candidate_edges.append((dist, city.index, candidate_city.index, route))

    candidate_edges.sort(key=lambda x: x[0])

    edges: list[dict[str, Any]] = []
    degree = [0] * len(cities)
    edge_pairs: set[tuple[int, int]] = set()
    uf = UnionFind(len(cities))

    for dist, u, v, route in candidate_edges:
        if uf.union(u, v):
            edge_pairs.add((u, v))
            degree[u] += 1
            degree[v] += 1
            edges.append({
                "city1": cities[u].name,
                "city2": cities[v].name,
                "distance": int(round(dist)),
                "road_type": 1,
                "pendenza": 1,
                "arcs": [{"lon": lon, "lat": lat} for lon, lat in route],
            })

    for dist, u, v, route in candidate_edges:
        if (u, v) not in edge_pairs:
            if degree[u] < MAX_DEGREE and degree[v] < MAX_DEGREE:
                edge_pairs.add((u, v))
                degree[u] += 1
                degree[v] += 1
                edges.append({
                    "city1": cities[u].name,
                    "city2": cities[v].name,
                    "distance": int(round(dist)),
                    "road_type": 1,
                    "pendenza": 1,
                    "arcs": [{"lon": lon, "lat": lat} for lon, lat in route],
                })

    return edges


# ==============================================================================
# I/O E STARTUP
# ==============================================================================

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate archs.json and the adjacency matrix.")
    parser.add_argument("--map-dir", type=Path, default=None, help="Directory containing map JSONs.")
    parser.add_argument("--output-dir", type=Path, default=None, help="Directory for output.")
    parser.add_argument("--matrix-file", type=str, default="aqrchs.json", help="Adjacency matrix output.")
    parser.add_argument("--archs-file", type=str, default="archs.json", help="Routed graph output.")
    parser.add_argument("--use-roads-fallback", action="store_true", help="Use roads.json as fallback.")
    return parser.parse_args()


def repo_root_from_script() -> Path:
    return Path(__file__).resolve().parents[2]


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def build_geojson_archs_output(edges: list[dict[str, Any]]) -> dict[str, Any]:
    features: list[dict[str, Any]] = []
    for index, edge in enumerate(edges, start=1):
        route = edge.get("arcs") or []
        coordinates = [
            [float(point["lon"]), float(point["lat"])]
            for point in route
            if isinstance(point, dict)
            and point.get("lon") is not None
            and point.get("lat") is not None
        ]
        if len(coordinates) < 2:
            continue
        features.append(
            {
                "type": "Feature",
                "id": f"path{index}",
                "geometry": {"type": "LineString", "coordinates": coordinates},
                "properties": {
                    "id": f"path{index}",
                    "city1": edge.get("city1"),
                    "city2": edge.get("city2"),
                    "distance": edge.get("distance"),
                    "road_type": edge.get("road_type"),
                    "pendenza": edge.get("pendenza"),
                },
            }
        )
    return {"type": "FeatureCollection", "features": features}


def extract_road_polylines(roads_topology: dict[str, Any]) -> list[list[tuple[float, float]]]:
    decoder = TopologyDecoder(roads_topology)
    polylines: list[list[tuple[float, float]]] = []
    for geometry in iter_geometries(roads_topology.get("objects", {})):
        if geometry.get("type") not in {"LineString", "MultiLineString"}:
            continue
        polylines.extend(decode_line_geometry(decoder, geometry))
    return [polyline for polyline in polylines if len(polyline) >= 2]


def main() -> int:
    args = parse_args()
    repo_root = repo_root_from_script()
    map_dir = args.map_dir or (repo_root / "shared" / "assets" / "map")
    output_dir = args.output_dir or map_dir

    cities_topology = load_json(map_dir / "cities.json")
    regions_topology = load_json(map_dir / "regions.json")
    map_topology = load_json(map_dir / "map.json")

    cities = extract_city_nodes(cities_topology)
    regions, region_decoder = extract_region_nodes(regions_topology)
    region_adjacency = build_region_adjacency(regions)
    city_to_region = assign_city_regions(cities, regions)
    land_polygons = collect_land_polygons(map_topology)
    polygon_index = build_polygon_index(land_polygons)
    
    road_polylines: list[list[tuple[float, float]]] = []
    if args.use_roads_fallback:
        roads_topology = load_json(map_dir / "roads.json")
        road_polylines = extract_road_polylines(roads_topology)

    edges = select_edges(
        cities,
        regions,
        region_adjacency,
        city_to_region,
        region_decoder,
        polygon_index,
        road_polylines,
    )

    adjacency_matrix = [[0 for _ in range(len(cities))] for _ in range(len(cities))]
    city_by_name = {city.name: city for city in cities}
    for edge in edges:
        city_left = city_by_name.get(edge["city1"])
        city_right = city_by_name.get(edge["city2"])
        if city_left is None or city_right is None:
            continue
        adjacency_matrix[city_left.index][city_right.index] = 1
        adjacency_matrix[city_right.index][city_left.index] = 1

    matrix_output = {
        "nodes": [
            {
                "index": city.index,
                "name": city.name,
                "province": city.province,
                "country": city.country,
                "lon": city.lon,
                "lat": city.lat,
            }
            for city in cities
        ],
        "matrix": adjacency_matrix,
    }

    archs_output = build_geojson_archs_output(edges)

    output_dir.mkdir(parents=True, exist_ok=True)
    with (output_dir / args.matrix_file).open("w", encoding="utf-8") as handle:
        json.dump(matrix_output, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    with (output_dir / args.archs_file).open("w", encoding="utf-8") as handle:
        json.dump(archs_output, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    print(f"Wrote {(output_dir / args.matrix_file).resolve()}")
    print(f"Wrote {(output_dir / args.archs_file).resolve()}")
    print(f"Cities: {len(cities)} | Regions: {len(regions)} | Edges: {len(edges)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())