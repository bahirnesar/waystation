#!/usr/bin/env python3
"""
distribute.py

Distributes track dots out from cluster locations and assigns density based randomised heights
"""

import json
import math
import os
import random
from typing import Dict, List, Set, Tuple

from shapely import STRtree
from shapely.geometry import Point, shape
from shapely.ops import unary_union
from shapely.validation import make_valid

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
PUBLIC_DIR = os.path.join(PROJECT_DIR, 'public')
DIST_DIR = os.path.join(PROJECT_DIR, 'dist')
SERVER_DATA_DIR = os.path.join(PROJECT_DIR, 'server', 'data')

def pseudo_random(seed_str: str) -> float:
    """Deterministic hash-based pseudo random generator returning [0.0, 1.0)."""
    h = 0
    for ch in seed_str:
        h = ((h << 5) - h) + ord(ch)
        h &= 0xFFFFFFFF
    if h >= 0x80000000:
        h -= 0x100000000
    return (abs(math.sin(h)) * 10000) % 1.0

def main():
    tracks_path = os.path.join(PUBLIC_DIR, 'tracks.json')
    locations_path = os.path.join(PUBLIC_DIR, 'locations.json')
    geojson_path = os.path.join(SERVER_DATA_DIR, 'countries.geojson')

    print(f"Loading data from {PUBLIC_DIR}...")
    with open(locations_path, 'r', encoding='utf-8') as f:
        locations_data = json.load(f)
    locations_by_id = {loc['id']: loc for loc in locations_data}

    with open(tracks_path, 'r', encoding='utf-8') as f:
        tracks_raw = json.load(f)
    all_tracks = tracks_raw if isinstance(tracks_raw, list) else tracks_raw.get('tracks', [])

    with open(geojson_path, 'r', encoding='utf-8') as f:
        geojson_data = json.load(f)

    print("Indexing geographic boundaries...")
    geo_shapes = [make_valid(shape(feat['geometry'])) for feat in geojson_data['features']]
    geo_names = [feat['properties'].get('name', '') for feat in geojson_data['features']]
    geo_name_to_idx = {name.lower(): i for i, name in enumerate(geo_names)}
    geo_tree = STRtree(geo_shapes)

    # Group tracks by their assigned clusterId
    clusters_dict: Dict[str, dict] = {}
    for t in all_tracks:
        cid = t.get('clusterId') or 'unknown'
        loc = locations_by_id.get(cid)

        if cid not in clusters_dict:
            hub_lat = loc['lat'] if loc else t.get('hubLat', t.get('lat', -90.0))
            hub_lng = loc['lng'] if loc else t.get('hubLng', t.get('lng', 0.0))
            city = loc['city'] if loc else t.get('city', 'Unknown')
            country = loc['country'] if loc else t.get('country', 'Unknown')
            boundary_names = tuple(loc.get('allowedBoundaryNames', [])) if loc else (country,)

            clusters_dict[cid] = {
                'id': cid,
                'city': city,
                'country': country,
                'lat': hub_lat,
                'lng': hub_lng,
                'allowed_boundary_names': boundary_names,
                'tracks': []
            }
        clusters_dict[cid]['tracks'].append(t)

    # Distribute tracks within cluster boundaries & randomise heights
    print(f"Distributing tracks and computing randomized heights across {len(clusters_dict)} clusters...")
    total_clusters = list(clusters_dict.values())
    max_cluster_tracks = max((len(c['tracks']) for c in total_clusters), default=127)

    all_flattened_tracks = []
    random.seed(4444)

    min_height_seen = float('inf')
    max_height_seen = float('-inf')

    for c in total_clusters:
        tracks = c['tracks']
        n = len(tracks)
        cLat = c['lat']
        cLng = c['lng']
        cosLat = math.cos(math.radians(cLat)) if abs(math.cos(math.radians(cLat))) > 0.1 else 0.6

        boundary_names = c.get('allowed_boundary_names') or (c['country'],)
        c_indices = set(geo_name_to_idx[b.lower()] for b in boundary_names if b.lower() in geo_name_to_idx)
        if not c_indices:
            c_indices = {0}

        c_shapes = [geo_shapes[idx] for idx in c_indices]
        c_union = unary_union(c_shapes) if len(c_shapes) > 1 else c_shapes[0]
        c_union = make_valid(c_union)
        c_buffered = c_union.buffer(0.12)

        placed = [(cLng, cLat, 0.0)]  # (lng, lat, norm_d)

        if n > 1:
            area_est = c_union.area
            base_d_min = max(0.015, min(0.35, math.sqrt(area_est / (n * 3))))
            d_min = base_d_min
            max_r = min(5.5, max(0.45, 0.45 + 0.42 * math.sqrt(n)))

            for idx in range(1, n):
                found = False
                attempts = 0
                cur_r_max = max_r
                is_polar = cLat <= -85.0

                while attempts < 3000 and not found:
                    attempts += 1
                    u = random.random()
                    theta = random.uniform(0, 2 * math.pi)

                    if is_polar:
                        r = cur_r_max * (u ** 1.1)
                        cand_lat = max(-90.0, min(-70.0, -90.0 + r))
                        cand_lng = ((theta * 180.0 / math.pi) + 180.0) % 360.0 - 180.0
                        norm_d = min(1.0, r / max_r)
                    else:
                        r = cur_r_max * (u ** 1.25)
                        cand_lat = max(-85.0, min(85.0, cLat + r * math.cos(theta)))
                        cand_lng = ((cLng + (r * math.sin(theta)) / cosLat + 180.0) % 360.0) - 180.0
                        norm_d = min(1.0, math.hypot(cand_lng - cLng, (cand_lat - cLat) * cosLat) / max_r)

                    pt = Point(cand_lng, cand_lat)

                    if not is_polar:
                        matches = geo_tree.query(pt, predicate='intersects')
                        # Strictly forbid any point on foreign land
                        if any(m not in c_indices for m in matches):
                            continue
                        # If point is over water, allow up to 0.12 deg coastline tolerance (~12km)
                        if not any(m in c_indices for m in matches) and not c_buffered.intersects(pt):
                            continue
                    elif not c_buffered.intersects(pt):
                        continue

                    # Check minimum spacing against already placed dots in this cluster
                    too_close = any(
                        math.hypot(px - cand_lng, py - cand_lat if is_polar else (py - cand_lat) * cosLat) < d_min
                        for px, py, _ in placed
                    )

                    if not too_close:
                        placed.append((cand_lng, cand_lat, norm_d))
                        found = True
                    elif attempts > 500:
                        d_min *= 0.985
                        cur_r_max = min(cur_r_max * 1.015, 12.0)

                if not found:
                    jitter_theta = idx * 2.399963229728653
                    if is_polar:
                        jitter_r = 0.05 + 0.05 * (idx % 20)
                        f_lat = max(-90.0, min(-70.0, -90.0 + jitter_r))
                        f_lng = ((jitter_theta * 180.0 / math.pi) + 180.0) % 360.0 - 180.0
                        norm_d = min(1.0, jitter_r / max_r)
                    else:
                        jitter_r = 0.05 + 0.02 * (idx % 12)
                        f_lat = max(-85.0, min(85.0, cLat + jitter_r * math.cos(jitter_theta)))
                        f_lng = ((cLng + (jitter_r * math.sin(jitter_theta)) / cosLat + 180.0) % 360.0) - 180.0
                        norm_d = min(1.0, math.hypot(f_lng - cLng, (f_lat - cLat) * cosLat) / max_r)
                    placed.append((f_lng, f_lat, norm_d))

        for i, t in enumerate(tracks):
            p_lng, p_lat, p_norm_d = placed[i]
            t['lat'] = round(p_lat, 5)
            t['lng'] = round(p_lng, 5)
            t['hubLat'] = cLat
            t['hubLng'] = cLng

            # Height formula:
            # Baseline h_min reduced to 0.1 so isolated dots & perimeters hug globe surface closely.
            # Dense centers elevate smoothly up to 3D wave peaks.
            density_ratio = math.log(n) / math.log(max_cluster_tracks) if (n > 1 and max_cluster_tracks > 1) else 0.0
            density_factor = density_ratio * (1.0 - 0.65 * p_norm_d)
            h_min = 0.1 + 1.2 * density_factor
            h_max = 0.35 + 8.5 * (density_factor ** 1.1)
            rnd = pseudo_random(t.get('id', '') or t.get('title', '') or str(i))
            static_height = round(h_min + rnd * (h_max - h_min), 3)

            t['densityHeight'] = static_height
            min_height_seen = min(min_height_seen, static_height)
            max_height_seen = max(max_height_seen, static_height)

            all_flattened_tracks.append(t)

    # Write output datasets
    print("Writing updated tracks data...")
    with open(tracks_path, 'w', encoding='utf-8') as f:
        json.dump(all_flattened_tracks, f, ensure_ascii=False, indent=2)

    tracks_data_js_path = os.path.join(PUBLIC_DIR, 'tracks_data.js')
    with open(tracks_data_js_path, 'w', encoding='utf-8') as f:
        f.write(f"window.TRACKS_DATA = {json.dumps(all_flattened_tracks, ensure_ascii=False)};\n")

    if os.path.exists(DIST_DIR):
        with open(os.path.join(DIST_DIR, 'tracks.json'), 'w', encoding='utf-8') as f:
            json.dump(all_flattened_tracks, f, ensure_ascii=False, indent=2)
        with open(os.path.join(DIST_DIR, 'tracks_data.js'), 'w', encoding='utf-8') as f:
            f.write(f"window.TRACKS_DATA = {json.dumps(all_flattened_tracks, ensure_ascii=False)};\n")
        print(f"Synced dist/ copies in {DIST_DIR}")

    print(f"\n✓ Successfully distributed {len(all_flattened_tracks)} tracks into {len(total_clusters)} clusters!")
    print(f"✓ Height range: min={min_height_seen}, max={max_height_seen}")
    print(f"✓ Output saved to:")
    print(f"  - {tracks_path}")
    print(f"  - {tracks_data_js_path}")

if __name__ == '__main__':
    main()
