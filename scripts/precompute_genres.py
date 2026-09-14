#!/usr/bin/env python3
"""
precompute_genres.py

Precomputes up to 3 genres for all tracks in the Ostalgie catalog:
1. Detects strong genre indicators from parenthetical metadata and rawTitle.
2. Ensures subgenres always include their top-level parent genre:
   Top-level genres: Pop, Rock, Disco, Jazz, Funk, Hip-hop, Folk, Electronic.
3. Limits to 3 genres max per track. If no strong indication, genres is empty [].
4. Saves precomputed genres to public/tracks.json, public/tracks_data.js,
   and dist/ mirrors.
"""

import json
import os
import re

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
PUBLIC_DIR = os.path.join(PROJECT_DIR, 'public')
DIST_DIR = os.path.join(PROJECT_DIR, 'dist')

TOP_LEVEL_GENRES = [
    'Pop',
    'Rock',
    'Disco',
    'Jazz',
    'Funk',
    'Hip-hop',
    'Folk',
    'Electronic',
]

SUBGENRE_PARENTS = {
    'Citypop': 'Pop',
    'Cantopop': 'Pop',
    'Synth-pop': 'Electronic',
    'Eurodance': 'Electronic',
    'Psychedelic': 'Rock',
    'New Wave': 'Rock',
    'Post-Punk': 'Rock',
    'Punk': 'Rock',
    'Chanson': 'Folk',
    'Soul': 'Funk',
}

def resolve_hierarchy(genres):
    result = []
    for g in genres:
        if len(result) >= 3:
            break
        if g in result:
            continue
        parent = SUBGENRE_PARENTS.get(g)
        if parent:
            parent_already = parent in result
            slots_needed = 1 if parent_already else 2
            if len(result) + slots_needed <= 3:
                result.append(g)
                if not parent_already:
                    result.append(parent)
        else:
            if len(result) + 1 <= 3:
                result.append(g)
    return result[:3]

def detect_genres(raw_title):
    raw = raw_title or ''
    m = re.findall(r'\(([^)]+)\)', raw)
    meta = m[-1] if m else ''
    text = f"{meta} | {raw}".lower()

    detected = []

    def add(g):
        if g not in detected:
            detected.append(g)

    # Subgenres
    if re.search(r'\b(city\s*pop)\b', text, re.I):
        add('Citypop')
    if re.search(r'\b(canto\s*pop|cantonese\s*pop)\b', text, re.I):
        add('Cantopop')
    if re.search(r'\b(synth-pop|synth\s*pop|synthesizer\s*pop|electro\s*pop)\b', text, re.I):
        add('Synth-pop')
    elif re.search(r'\b(synth\s*disco|disco\s*synth|synth\s*funk|synth\s*folk|synth\s*chanson|minimal\s*synth)\b', text, re.I):
        add('Synth-pop')
    elif re.search(r'\b(synth|synthesizer)\b', meta, re.I):
        add('Synth-pop')

    if re.search(r'\b(eurodance|euro\s*dance)\b', text, re.I):
        add('Eurodance')
    if re.search(r'\b(psych|psychedelic|fuzz|acid\s*rock)\b', text, re.I):
        add('Psychedelic')
    if re.search(r'\b(new\s*wave)\b', text, re.I):
        add('New Wave')
    if re.search(r'\b(post-punk|post\s*punk)\b', text, re.I):
        add('Post-Punk')
    elif re.search(r'\b(punk)\b', text, re.I):
        add('Punk')
    if re.search(r'\b(chanson)\b', text, re.I):
        add('Chanson')
    if re.search(r'\b(soul)\b', text, re.I):
        add('Soul')

    # Top-Level Genres
    if re.search(r'\b(electronic|electro|techno|house|trance|ambient|hi-nrg|hi\s*nrg|italo|new\s*beat|euro\s*beat|rave)\b', text, re.I):
        add('Electronic')
    if re.search(r'\b(disco|space\s*disco|euro\s*disco|cosmic\s*disco|italo\s*disco)\b', text, re.I):
        add('Disco')
    if re.search(r'\b(funk|funky|groove|breaks|moog\s*funk)\b', text, re.I):
        add('Funk')
    if re.search(r'\b(rock|prog\s*rock|garage|metal|coldwave|darkwave)\b', text, re.I):
        add('Rock')
    if re.search(r'\b(folk|ethno|traditional|roots|luk\s*thung|dangdut|morlam|kabyle)\b', text, re.I):
        add('Folk')
    if re.search(r'\b(jazz)\b', text, re.I):
        add('Jazz')
    if re.search(r'\b(hip\s*hop|hip-hop|rap|rapper)\b', text, re.I):
        add('Hip-hop')
    if re.search(r'\b(pop|dance-pop|dance\s*pop|europop|euro-pop)\b', text, re.I):
        add('Pop')

    if not detected:
        return []

    return resolve_hierarchy(detected)

def main():
    tracks_path = os.path.join(PUBLIC_DIR, 'tracks.json')
    with open(tracks_path, 'r', encoding='utf-8') as f:
        tracks = json.load(f)

    genre_counts = {}
    with_genres = 0

    for t in tracks:
        genres = detect_genres(t.get('rawTitle', ''))
        t['genres'] = genres
        # Also sync single genre property for backward compatibility with primary genre
        t['genre'] = genres[0] if genres else ''
        if genres:
            with_genres += 1
            for g in genres:
                genre_counts[g] = genre_counts.get(g, 0) + 1

    print(f"Precomputed genres for {len(tracks)} tracks ({with_genres} with at least 1 genre).")
    print("\nGenre distribution:")
    for g, count in sorted(genre_counts.items(), key=lambda x: -x[1]):
        print(f"  {g:15}: {count} tracks")

    # 1. Update public/tracks.json
    with open(tracks_path, 'w', encoding='utf-8') as f:
        json.dump(tracks, f, ensure_ascii=False, indent=2)

    # 2. Update public/tracks_data.js
    tracks_data_path = os.path.join(PUBLIC_DIR, 'tracks_data.js')
    with open(tracks_data_path, 'w', encoding='utf-8') as f:
        f.write(f"window.TRACKS_DATA = {json.dumps(tracks, ensure_ascii=False)};\n")

    # 3. Update dist/ mirrors if present
    if os.path.exists(DIST_DIR):
        with open(os.path.join(DIST_DIR, 'tracks.json'), 'w', encoding='utf-8') as f:
            json.dump(tracks, f, ensure_ascii=False, indent=2)
        with open(os.path.join(DIST_DIR, 'tracks_data.js'), 'w', encoding='utf-8') as f:
            f.write(f"window.TRACKS_DATA = {json.dumps(tracks, ensure_ascii=False)};\n")
        print(f"\nSynced dist/ tracks files.")

    print(f"\n✓ Saved precomputed tracks to:")
    print(f"  - {tracks_path}")
    print(f"  - {tracks_data_path}")

if __name__ == '__main__':
    main()
