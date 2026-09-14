import json
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
PUBLIC_DIR = os.path.join(PROJECT_DIR, 'public')
SERVER_DATA_DIR = os.path.join(PROJECT_DIR, 'server', 'data')
DIST_DIR = os.path.join(PROJECT_DIR, 'dist')

TOP_LEVEL_GENRES = [
    ('pop', 'Pop'),
    ('rock', 'Rock'),
    ('disco', 'Disco'),
    ('jazz', 'Jazz'),
    ('funk', 'Funk'),
    ('hip-hop', 'Hip-hop'),
    ('folk', 'Folk'),
    ('electronic', 'Electronic'),
]

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

    new_stations = [all_station]

    for gid, genre in TOP_LEVEL_GENRES:
        st_tracks = [t for t in all_tracks if genre in t.get('genres', [])]
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
