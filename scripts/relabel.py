#!/usr/bin/env python3
"""
relabel.py

Relabels tracks in the Ostalgie music catalog to their geographic regional hubs.

Responsibilities:
1. Loads track catalog and geographic hub definitions from public/locations.json.
2. Resolves track geographic location using:
   - Explicit clusterId assigned to the track (if valid)
   - Artist-specific overrides
   - Parenthetical title metadata (e.g., "(Soviet synth-pop, Estonia 1983)")
   - Full video title pattern matching
   - Default fallback: "unknown" (Antarctica / South Pole)
3. Updates track hub attributes: city, country, clusterId, hubLat, hubLng.
4. Cleans up legacy/dead schema keys.
5. Emits normalized tracks to public/tracks.json and public/tracks_data.js
   (and dist/ mirrors if present).
"""

import json
import os
import re
from dataclasses import dataclass
from typing import Dict, List, Tuple

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
PUBLIC_DIR = os.path.join(PROJECT_DIR, 'public')
DIST_DIR = os.path.join(PROJECT_DIR, 'dist')

DEAD_KEYS = ('flag', 'bloc', 'clusterCount', 'source', 'account', 'url', 'ytUrl')

@dataclass(frozen=True)
class HubLocation:
    cluster_id: str
    city: str
    country: str
    lat: float
    lng: float
    patterns: Tuple[str, ...]

ARTIST_OVERRIDES: List[Tuple[re.Pattern, str]] = [
    (re.compile(r'나훈아|유현주'), 'south_korea'),
    (re.compile(r'藤井輝子'), 'japan'),
    (re.compile(r'michael nano', re.IGNORECASE), 'iraq'),
    (re.compile(r'georgie reworks', re.IGNORECASE), 'uk'),
]

def resolve_track_geo(t: dict, hubs_by_id: Dict[str, HubLocation], compiled_patterns: List[Tuple[re.Pattern, HubLocation]]) -> HubLocation:
    # 0. Explicit clusterId assigned to the track
    cid = t.get('clusterId')
    if cid and cid in hubs_by_id:
        return hubs_by_id[cid]

    raw = t.get('rawTitle', '')
    raw_l = raw.lower()

    # 1. Artist overrides
    for pattern, hub_id in ARTIST_OVERRIDES:
        if pattern.search(raw):
            return hubs_by_id[hub_id]

    # 2. Metadata inside parentheses
    m = re.findall(r'\(([^)]+)\)', raw)
    meta = m[-1].lower() if m else ''
    if meta:
        for pattern, hub in compiled_patterns:
            if pattern.search(meta):
                return hub

    # 3. Whole rawTitle fallback (excluding generic catch-alls)
    for pattern, hub in compiled_patterns:
        if hub.cluster_id in ('russia', 'uk'):
            continue
        if pattern.search(raw_l):
            return hub

    # 4. Default fallback: Unknown location at South Pole
    return hubs_by_id.get('unknown', hubs_by_id.get('russia'))

def main():
    tracks_path = os.path.join(PUBLIC_DIR, 'tracks.json')
    locations_path = os.path.join(PUBLIC_DIR, 'locations.json')

    print(f"Loading locations and tracks from {PUBLIC_DIR}...")
    with open(locations_path, 'r', encoding='utf-8') as f:
        locations_data = json.load(f)

    with open(tracks_path, 'r', encoding='utf-8') as f:
        tracks_raw = json.load(f)
    tracks = tracks_raw if isinstance(tracks_raw, list) else tracks_raw.get('tracks', [])

    geo_hubs: List[HubLocation] = [
        HubLocation(
            cluster_id=loc['id'],
            city=loc['city'],
            country=loc['country'],
            lat=loc['lat'],
            lng=loc['lng'],
            patterns=tuple(loc.get('patterns', []))
        )
        for loc in locations_data
    ]
    hubs_by_id: Dict[str, HubLocation] = {hub.cluster_id: hub for hub in geo_hubs}

    compiled_patterns: List[Tuple[re.Pattern, HubLocation]] = []
    for hub in geo_hubs:
        for pattern_str in hub.patterns:
            compiled_patterns.append((re.compile(pattern_str, re.IGNORECASE), hub))

    cluster_counts: Dict[str, int] = {}
    reassigned_count = 0

    for t in tracks:
        old_cid = t.get('clusterId')
        hub = resolve_track_geo(t, hubs_by_id, compiled_patterns)

        if old_cid != hub.cluster_id:
            reassigned_count += 1

        t['city'] = hub.city
        t['country'] = hub.country
        t['hubLat'] = hub.lat
        t['hubLng'] = hub.lng
        t['clusterId'] = hub.cluster_id

        # Clean legacy keys
        for dead_key in DEAD_KEYS:
            t.pop(dead_key, None)

        cluster_counts[hub.cluster_id] = cluster_counts.get(hub.cluster_id, 0) + 1

    print(f"Relabeled {len(tracks)} tracks across {len(cluster_counts)} regional clusters ({reassigned_count} reassigned).")

    # Write output files
    with open(tracks_path, 'w', encoding='utf-8') as f:
        json.dump(tracks, f, ensure_ascii=False, indent=2)

    tracks_data_js_path = os.path.join(PUBLIC_DIR, 'tracks_data.js')
    with open(tracks_data_js_path, 'w', encoding='utf-8') as f:
        f.write(f"window.TRACKS_DATA = {json.dumps(tracks, ensure_ascii=False)};\n")

    if os.path.exists(DIST_DIR):
        with open(os.path.join(DIST_DIR, 'tracks.json'), 'w', encoding='utf-8') as f:
            json.dump(tracks, f, ensure_ascii=False, indent=2)
        with open(os.path.join(DIST_DIR, 'tracks_data.js'), 'w', encoding='utf-8') as f:
            f.write(f"window.TRACKS_DATA = {json.dumps(tracks, ensure_ascii=False)};\n")
        print(f"Synced dist/ copies in {DIST_DIR}")

    print(f"\n✓ Saved relabeled tracks to:")
    print(f"  - {tracks_path}")
    print(f"  - {tracks_data_js_path}")

if __name__ == '__main__':
    main()
