import json
import re
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
PUBLIC_DIR = os.path.join(PROJECT_DIR, 'public')
SERVER_DATA_DIR = os.path.join(PROJECT_DIR, 'server', 'data')
DIST_DIR = os.path.join(PROJECT_DIR, 'dist')

def main():
    tracks_json_path = os.path.join(PUBLIC_DIR, 'tracks.json')
    stations_json_path = os.path.join(PUBLIC_DIR, 'stations.json')
    with open(tracks_json_path, 'r', encoding='utf-8') as f:
        tracks_raw = json.load(f)
    all_tracks = tracks_raw if isinstance(tracks_raw, list) else tracks_raw.get('tracks', [])

    all_station = {
        "id": "all",
        "genre": "All Tracks",
        "isDefault": True,
        "trackIds": [t['id'] for t in all_tracks]
    }

    def is_pop(t):
        raw = t.get('rawTitle', '')
        g = t.get('genre', '')
        return bool(re.search(r'\bpop\b', raw, re.I)) or g in ['Retro Pop', 'Synth-pop', 'Jazz-Pop']

    def is_synth_pop(t):
        raw = t.get('rawTitle', '')
        g = t.get('genre', '')
        if g in ['Synth-pop', 'Disco / Synth']:
            return True
        return bool(re.search(r'\b(synth|synthesizer|minimal\s*synth|electro|electronic|wave|new\s*wave|hi-nrg|hi\s*nrg|italo)\b', raw, re.I))

    def is_citypop_cantopop(t):
        raw = t.get('rawTitle', '')
        c = t.get('country', '').lower()
        if c in ['japan', 'hong kong', 'taiwan']:
            return True
        return bool(re.search(r'\b(city\s*pop|canto\s*pop|mandopop|mando\s*pop|canton|cantonese|chinese\s*pop|chinese\s*funk|chinese\s*synth|mandarin\s*disco)\b', raw, re.I))

    def is_rock(t):
        raw = t.get('rawTitle', '')
        if re.search(r'\b(euro\s*beat|new\s*beat)\b', raw, re.I):
            return False
        if re.search(r'\b(rock|prog|punk|post-punk|garage|metal|darkwave|coldwave|new wave)\b', raw, re.I):
            return True
        if re.search(r'\b(psych beat|garage beat|beat pop|garage pop)\b', raw, re.I):
            return True
        if t.get('genre') == 'New Wave':
            return True
        return False

    def is_disco(t):
        raw = t.get('rawTitle', '')
        g = t.get('genre', '')
        if g in ['Disco', 'Disco / Synth', 'Folk-Disco']:
            return True
        return bool(re.search(r'\b(disco|space\s*disco|euro\s*disco|italo\s*disco|cosmic\s*disco)\b', raw, re.I))

    def is_eurodance(t):
        raw = t.get('rawTitle', '')
        g = t.get('genre', '')
        if g == 'Eurodance':
            return True
        if re.search(r'\b(eurodance|euro\s*dance|euro\s*beat|new\s*beat)\b', raw, re.I):
            return True
        if t.get('year', 0) >= 1990 and re.search(r'\b(dance\s*pop|dance-pop|hi\s*nrg|hi-nrg|rave|techno)\b', raw, re.I):
            return True
        return False

    def is_funk(t):
        raw = t.get('rawTitle', '')
        g = t.get('genre', '')
        if g == 'Funk':
            return True
        return bool(re.search(r'\b(funk|funky|groove|breaks|soul|moog\s*funk)\b', raw, re.I))

    def is_folk(t):
        raw = t.get('rawTitle', '')
        g = t.get('genre', '')
        if g in ['Folk-Disco', 'Chanson']:
            return True
        return bool(re.search(r'\b(folk|ethno|traditional|roots|luk\s*thung|dangdut|morlam|kabyle|chanson)\b', raw, re.I))

    def is_psychedelic(t):
        raw = t.get('rawTitle', '')
        g = t.get('genre', '')
        if g == 'Psychedelic':
            return True
        return bool(re.search(r'\b(psych|psychedelic|fuzz|acid)\b', raw, re.I))

    genre_configs = [
        ('pop', 'Pop', is_pop),
        ('synth-pop', 'Synth-pop', is_synth_pop),
        ('citypop-cantopop', 'Citypop / Cantopop', is_citypop_cantopop),
        ('rock', 'Rock', is_rock),
        ('disco', 'Disco', is_disco),
        ('eurodance', 'Eurodance', is_eurodance),
        ('funk', 'Funk', is_funk),
        ('folk', 'Folk', is_folk),
        ('psychedelic', 'Psychedelic', is_psychedelic),
    ]

    new_stations = [all_station]

    for gid, genre, filter_fn in genre_configs:
        st_tracks = [t for t in all_tracks if filter_fn(t)]
        artists = set(t['artist'].lower() for t in st_tracks)
        station_obj = {
            "id": gid,
            "genre": genre,
            "trackIds": [t['id'] for t in st_tracks]
        }
        new_stations.append(station_obj)
        print(f"Added station '{genre}' ({gid}): {len(st_tracks)} tracks, {len(artists)} artists")

    # 1. Update public/stations.json
    with open(stations_json_path, 'w', encoding='utf-8') as f:
        json.dump(new_stations, f, ensure_ascii=False, indent=2)
    print(f"Written: {stations_json_path}")

    # 2. Update public/stations_data.js
    stations_data_js_path = os.path.join(PUBLIC_DIR, 'stations_data.js')
    with open(stations_data_js_path, 'w', encoding='utf-8') as f:
        f.write(f"window.STATIONS_DATA = {json.dumps(new_stations, ensure_ascii=False)};\n")
    print(f"Written: {stations_data_js_path}")

    # 3. Update server/data/stations.json
    server_stations_path = os.path.join(SERVER_DATA_DIR, 'stations.json')
    if os.path.exists(SERVER_DATA_DIR):
        with open(server_stations_path, 'w', encoding='utf-8') as f:
            json.dump(new_stations, f, ensure_ascii=False, indent=2)
        print(f"Written: {server_stations_path}")

    # 4. Update dist/ files if dist exists
    dist_stations_path = os.path.join(DIST_DIR, 'stations.json')
    if os.path.exists(DIST_DIR):
        with open(dist_stations_path, 'w', encoding='utf-8') as f:
            json.dump(new_stations, f, ensure_ascii=False, indent=2)
        dist_stations_data_js_path = os.path.join(DIST_DIR, 'stations_data.js')
        with open(dist_stations_data_js_path, 'w', encoding='utf-8') as f:
            f.write(f"window.STATIONS_DATA = {json.dumps(new_stations, ensure_ascii=False)};\n")
        print(f"Written dist stations files in: {DIST_DIR}")

if __name__ == '__main__':
    main()
