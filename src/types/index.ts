export interface Track {
  id: string;
  title: string;
  artist: string;
  year: number;
  genre: string;
  genres?: string[];
  city: string;
  country: string;
  lat: number;
  lng: number;
  rawTitle?: string;
  clusterId?: string;
  thumbnail?: string;
  hubLat?: number;
  hubLng?: number;
  densityHeight?: number;
  displayCountry?: string;
}

export interface LocationHub {
  id: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  allowedBoundaryNames?: string[];
  patterns?: string[];
}

export interface Cluster extends LocationHub {
  tracks: Track[];
}

export interface Station {
  id: string;
  name: string;
  trackIds?: string[];
  trackCount?: number;
  artistCount?: number;
  tracks?: Track[];
}

export interface AppState {
  currentStationId: string;
  currentStationTracks: Track[];
  rangeYearL: number;
  rangeYearR: number;
  searchQuery: string;
  autoSpin: boolean;
}

export interface GenreRecommendationSection {
  genre: string;
  tracks: Track[];
}

export interface TrackRecommendations {
  countryName: string;
  artistTracks: Track[];
  genreSections: GenreRecommendationSection[];
  locationTracks: Track[];
}

export interface RangeChangeEvent {
  rangeYearL: number;
  rangeYearR: number;
}
