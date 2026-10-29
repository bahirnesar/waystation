import { ICON_EXTERNAL_LINK, ICON_MUSIC, ICON_BROADCAST, ICON_NOTE_SM, ICON_USER_SM, ICON_EDIT, ICON_TRASH } from './icons';
import { escapeHtml, standardizeCountry, getDisplayCountry, trackMap } from '../data/store';
import { getTrackRecommendations } from '../data/recommendations';
import { getTrackGenres } from '../data/genres';
import { sfx } from '../audio/sfx';
import { Track, Cluster, Station } from '../types/index';

export interface UIPanelsInitOptions {
  stations: () => Station[];
  currentStationId: () => string;
  isReadOnly?: () => boolean;
  onSelectStation?: (sid: string) => void;
  onCreateStation?: (name: string) => Promise<void> | void;
  onRenameStation?: (sid: string, newName: string) => Promise<void> | void;
  onDeleteStation?: (sid: string) => Promise<void> | void;
  onOpenImport?: (preselectedStationId?: string) => void;
  onSelectTrack?: (track: Track) => void;
  onSearchChange?: (query: string) => void;
  onToggleAutopilot?: () => boolean;
  onToggleBorders?: () => boolean;
  onToggleStarfield?: () => boolean;
  onToggleSounds?: () => boolean;
  onResetCam?: () => void;
}

class UIPanels {
  tooltipEl: HTMLElement | null = null;
  ttArt: HTMLImageElement | null = null;
  ttTitle: HTMLElement | null = null;
  ttSub: HTMLElement | null = null;

  detailPanel: HTMLElement | null = null;
  detailContent: HTMLElement | null = null;
  currentDetailTrackId: string | null = null;

  sectorBtn: HTMLElement | null = null;
  sectorPanel: HTMLElement | null = null;
  sectorList: HTMLElement | null = null;
  sectorSearchInput: HTMLInputElement | null = null;

  searchInput: HTMLInputElement | null = null;
  searchClear: HTMLElement | null = null;
  searchResults: HTMLElement | null = null;
  srBody: HTMLElement | null = null;
  srBrowseCount: HTMLElement | null = null;

  infoPanel: HTMLElement | null = null;
  checkAutopilot: HTMLElement | null = null;
  checkBorders: HTMLElement | null = null;
  checkStarfield: HTMLElement | null = null;
  checkSounds: HTMLElement | null = null;

  hudTracks: HTMLElement | null = null;
  hudArtists: HTMLElement | null = null;

  onSelectTrack: ((track: Track) => void) | null = null;
  onSelectStation: ((sid: string) => void) | null = null;
  onCreateStation?: (name: string) => Promise<void> | void;
  onRenameStation?: (sid: string, newName: string) => Promise<void> | void;
  onDeleteStation?: (sid: string) => Promise<void> | void;
  onOpenImport?: (preselectedStationId?: string) => void;
  isReadOnly?: () => boolean;
  onToggleAutopilot?: () => boolean;
  onToggleBorders?: () => boolean;
  onToggleStarfield?: () => boolean;
  onToggleSounds?: () => boolean;
  currentTooltipTrackId: string | null = null;

  init(options: UIPanelsInitOptions): void {
    this.onSelectTrack = options.onSelectTrack || null;
    this.onSelectStation = options.onSelectStation || null;
    this.onCreateStation = options.onCreateStation;
    this.onRenameStation = options.onRenameStation;
    this.onDeleteStation = options.onDeleteStation;
    this.onOpenImport = options.onOpenImport;
    this.isReadOnly = options.isReadOnly;

    const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

    this.tooltipEl = $('tooltip');
    this.ttArt = $('ttArt');
    this.ttTitle = $('ttTitle');
    this.ttSub = $('ttSub');

    this.detailPanel = $('detailPanel');
    this.detailContent = $('detailContent');

    this.sectorBtn = $('sectorBtn');
    this.sectorPanel = $('sectorPanel');
    this.sectorList = $('sectorList');
    this.sectorSearchInput = $('sectorSearchInput');

    this.searchInput = $('searchInput');
    this.searchClear = $('searchClear');
    this.searchResults = $('searchResults');
    this.srBody = $('srBody');
    this.srBrowseCount = $('srBrowseCount');

    this.infoPanel = $('infoPanel');
    this.checkAutopilot = $('checkAutopilot');
    this.checkBorders = $('checkBorders');
    this.checkStarfield = $('checkStarfield');
    this.checkSounds = $('checkSounds');

    this.hudTracks = $('hudTracks');
    this.hudArtists = $('hudArtists');

    this.bindEvents(options);
  }

  bindEvents(opts: UIPanelsInitOptions): void {
    const { stations, currentStationId, onSelectStation, onSearchChange, onToggleAutopilot, onToggleBorders, onToggleStarfield, onToggleSounds, onResetCam } = opts;
    this.onToggleAutopilot = onToggleAutopilot;
    this.onToggleBorders = onToggleBorders;
    this.onToggleStarfield = onToggleStarfield;
    this.onToggleSounds = onToggleSounds;

    document.getElementById('detailClose')?.addEventListener('click', () => this.closeDetailPanel());

    this.sectorBtn?.addEventListener('click', e => {
      e.stopPropagation();
      sfx.play('click');
      if (this.sectorPanel?.classList.toggle('open')) {
        this.detailPanel?.classList.remove('open');
        this.searchResults?.classList.remove('open');
        this.infoPanel?.classList.remove('open');
        this.renderStationList(stations(), this.sectorSearchInput?.value || '', currentStationId(), onSelectStation);
      }
    });

    this.sectorSearchInput?.addEventListener('input', e => {
      this.renderStationList(stations(), (e.target as HTMLInputElement).value, currentStationId(), onSelectStation);
    });

    document.getElementById('stationCreateBtn')?.addEventListener('click', async e => {
      e.stopPropagation();
      if (this.isReadOnly?.()) return;
      sfx.play('click');
      const name = window.prompt('Enter new station name:');
      if (name && name.trim()) {
        await this.onCreateStation?.(name.trim());
      }
    });

    document.getElementById('stationImportBtn')?.addEventListener('click', e => {
      e.stopPropagation();
      sfx.play('click');
      this.onOpenImport?.(currentStationId());
    });

    document.getElementById('importBtn')?.addEventListener('click', e => {
      e.stopPropagation();
      sfx.play('click');
      this.onOpenImport?.(currentStationId());
    });

    this.sectorList?.addEventListener('click', async e => {
      const target = e.target as HTMLElement;

      const renameBtn = target.closest<HTMLElement>('.station-op-btn.rename');
      if (renameBtn) {
        e.stopPropagation();
        if (this.isReadOnly?.()) return;
        const sid = renameBtn.dataset.sid;
        const currentName = renameBtn.dataset.sname || '';
        if (sid && sid !== 'all') {
          const newName = window.prompt(`Rename station '${currentName}':`, currentName);
          if (newName && newName.trim() && newName.trim() !== currentName) {
            await this.onRenameStation?.(sid, newName.trim());
          }
        }
        return;
      }

      const deleteBtn = target.closest<HTMLElement>('.station-op-btn.delete');
      if (deleteBtn) {
        e.stopPropagation();
        if (this.isReadOnly?.()) return;
        const sid = deleteBtn.dataset.sid;
        const currentName = deleteBtn.dataset.sname || '';
        if (sid && sid !== 'all') {
          if (window.confirm(`Delete station '${currentName}'? Tracks in other stations will be kept.`)) {
            await this.onDeleteStation?.(sid);
          }
        }
        return;
      }

      const sid = target.closest<HTMLElement>('.sector-item')?.dataset.sid;
      if (sid) {
        (this.onSelectStation || onSelectStation)?.(sid);
        this.sectorPanel?.classList.remove('open');
      }
    });

    this.searchInput?.addEventListener('focus', () => {
      this.sectorPanel?.classList.remove('open');
      this.detailPanel?.classList.remove('open');
    });

    this.searchInput?.addEventListener('input', e => {
      this.sectorPanel?.classList.remove('open');
      this.detailPanel?.classList.remove('open');
      const query = (e.target as HTMLInputElement).value.trim().toLowerCase();
      if (this.searchClear) this.searchClear.style.display = query ? 'flex' : 'none';
      if (!query) {
        this.searchResults?.classList.remove('open');
        onSearchChange?.('');
      } else {
        onSearchChange?.(query);
      }
    });

    this.searchClear?.addEventListener('click', () => {
      if (this.searchInput) this.searchInput.value = '';
      if (this.searchClear) this.searchClear.style.display = 'none';
      this.searchResults?.classList.remove('open');
      onSearchChange?.('');
    });

    this.srBody?.addEventListener('click', e => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('.detail-track-item')?.dataset.id;
      const track = id ? trackMap.get(id) : null;
      if (track) {
        sfx.play('click');
        this.onSelectTrack?.(track);
        this.searchResults?.classList.remove('open');
      }
    });

    this.detailContent?.addEventListener('click', e => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('.detail-track-item')?.dataset.id;
      const track = id ? trackMap.get(id) : null;
      if (track) {
        sfx.play('click');
        this.onSelectTrack?.(track);
      }
    });

    document.getElementById('infoBtn')?.addEventListener('click', () => {
      sfx.play('click');
      this.infoPanel?.classList.toggle('open');
    });

    document.getElementById('infoPanelClose')?.addEventListener('click', () => {
      this.infoPanel?.classList.remove('open');
    });

    document.getElementById('ctrlAutopilot')?.addEventListener('click', () => {
      sfx.play('switch');
      if (this.onToggleAutopilot && this.checkAutopilot) {
        this.checkAutopilot.classList.toggle('on', this.onToggleAutopilot());
      }
    });
    document.getElementById('ctrlBorders')?.addEventListener('click', () => {
      this.toggleBorders();
    });
    document.getElementById('ctrlStarfield')?.addEventListener('click', () => {
      this.toggleStarfield();
    });
    document.getElementById('ctrlSounds')?.addEventListener('click', () => {
      this.toggleSounds();
    });

    document.getElementById('ctrlResetCam')?.addEventListener('click', () => {
      sfx.play('transition');
      onResetCam?.();
    });
  }

  showTooltip(track: Track, screenX: number, screenY: number): void {
    if (!this.tooltipEl || !track) return;
    if (this.currentTooltipTrackId !== track.id) {
      this.currentTooltipTrackId = track.id;
      if (this.ttArt && track.thumbnail) {
        this.ttArt.src = track.thumbnail;
        this.ttArt.style.display = 'block';
      }
      if (this.ttTitle) this.ttTitle.textContent = track.title;
      if (this.ttSub) {
        this.ttSub.textContent = `${track.artist} (${track.year}) • ${getDisplayCountry(track) || standardizeCountry(track.country || track.city)}`;
      }
    }

    this.tooltipEl.style.left = `${screenX}px`;
    this.tooltipEl.style.top = `${screenY - 14}px`;
    this.tooltipEl.style.transform = 'translate(-50%, -100%)';
    this.tooltipEl.classList.add('visible');
  }

  hideTooltip(): void {
    this.currentTooltipTrackId = null;
    this.tooltipEl?.classList.remove('visible');
  }

  setAutopilot(active: boolean): void {
    this.checkAutopilot?.classList.toggle('on', active);
  }

  toggleBorders(): boolean {
    if (this.onToggleBorders && this.checkBorders) {
      sfx.play('switch');
      const state = this.onToggleBorders();
      this.checkBorders.classList.toggle('on', state);
      return state;
    }
    return false;
  }

  toggleStarfield(): boolean {
    if (this.onToggleStarfield && this.checkStarfield) {
      sfx.play('switch');
      const state = this.onToggleStarfield();
      this.checkStarfield.classList.toggle('on', state);
      return state;
    }
    return false;
  }

  toggleSounds(): boolean {
    if (this.onToggleSounds && this.checkSounds) {
      const state = this.onToggleSounds();
      this.checkSounds.classList.toggle('on', state);
      return state;
    }
    return false;
  }

  updateFilteredStats(visibleTracks: Track[]): void {
    const count = visibleTracks.length;
    const artistSet = new Set<string>();
    for (let i = 0; i < count; i++) {
      const t = visibleTracks[i];
      if (t.artist) artistSet.add(t.artist.toLowerCase());
    }

    if (this.hudTracks) this.hudTracks.textContent = count.toLocaleString();
    if (this.hudArtists) this.hudArtists.textContent = artistSet.size.toLocaleString();
  }

  renderStationList(
    stations: Station[],
    query = '',
    currentStationId: string,
    onSelectStation?: (sid: string) => void
  ): void {
    if (onSelectStation) this.onSelectStation = onSelectStation;
    if (!this.sectorList) return;
    const q = query.toLowerCase().trim();

    const isReadOnly = this.isReadOnly ? this.isReadOnly() : false;
    const createBtn = document.getElementById('stationCreateBtn');
    const importBtn = document.getElementById('stationImportBtn');
    if (createBtn) createBtn.style.display = isReadOnly ? 'none' : 'inline-flex';
    if (importBtn) importBtn.style.display = isReadOnly ? 'none' : 'inline-flex';

    const filtered = q ? stations.filter(s => s.name && s.name.toLowerCase().includes(q)) : stations;

    this.sectorList.innerHTML = filtered.map(s => {
      const tCount = s.tracks ? s.tracks.length : (s.trackCount || 0);
      const aCount = s.artistCount || (s.tracks ? new Set(s.tracks.map(t => t.artist.toLowerCase())).size : 0);
      const activeClass = s.id === currentStationId ? ' active' : '';
      const canManage = !isReadOnly && s.id !== 'all';
      const opsHtml = canManage
        ? `<div class="sector-item-ops">
            <button class="station-op-btn rename" data-sid="${s.id}" data-sname="${escapeHtml(s.name)}" title="Rename Station">${ICON_EDIT}</button>
            <button class="station-op-btn delete" data-sid="${s.id}" data-sname="${escapeHtml(s.name)}" title="Delete Station">${ICON_TRASH}</button>
           </div>`
        : '';

      return `
        <div class="sector-item${activeClass}" data-sid="${s.id}">
          <div class="sector-item-top">
            <div class="sector-item-icon">${ICON_BROADCAST}</div>
            <span class="sector-item-name">${escapeHtml(s.name)}</span>
            ${opsHtml}
          </div>
          <div class="sector-item-bottom">
            <div class="sector-item-badges">
              <span class="sector-item-count">${ICON_NOTE_SM}${tCount}</span>
              <span class="sector-item-count">${ICON_USER_SM}${aCount}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  renderSearchResults(matches: Track[]): void {
    if (!this.searchResults || !this.srBody || !this.srBrowseCount) return;
    this.srBrowseCount.textContent = `${matches.length} tracks`;

    this.srBody.innerHTML = matches.slice(0, 30).map(t => `
      <div class="detail-track-item" data-id="${t.id}" style="padding:8px 12px;">
        <img class="detail-track-thumb" src="${t.thumbnail}" alt="">
        <div style="flex:1;min-width:0;">
          <div style="color:var(--text-primary);font-size:11px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(t.title)}</div>
          <div style="color:var(--text-muted);font-size:10px;">${escapeHtml(t.artist)} (${escapeHtml(getDisplayCountry(t) || standardizeCountry(t.country || t.city))})</div>
        </div>
        <span class="detail-track-year">${t.year}</span>
      </div>
    `).join('');

    this.searchResults.classList.add('open');
  }

  closeSearchResults(): void {
    this.searchResults?.classList.remove('open');
  }

  renderDetailTrackItem(t: Track, showArtist = false): string {
    const thumb = t.thumbnail
      ? `<img class="detail-track-thumb" src="${t.thumbnail}" alt="">`
      : `<div class="detail-track-thumb" style="display:flex;align-items:center;justify-content:center;">${ICON_MUSIC}</div>`;
    const artistText = escapeHtml(t.artist || '');
    const titleText = escapeHtml(t.title || '');
    const labelHtml = showArtist && t.artist
      ? `<span style="color:var(--text-primary);font-weight:500;">${titleText}</span> <span style="color:var(--text-muted);margin:0 3px;">\u2014</span> <span style="color:var(--text-muted);">${artistText}</span>`
      : `<span style="color:var(--text-primary);font-weight:500;">${titleText}</span>`;
    const displayLoc = getDisplayCountry(t) || standardizeCountry(t.country || t.city) || '';
    const locSuffix = displayLoc ? ` (${displayLoc})` : '';
    const tooltip = showArtist && t.artist ? `${t.title} \u2014 ${t.artist}${locSuffix}` : `${t.title || ''}${locSuffix}`;

    return `
      <div class="detail-track-item" data-id="${t.id}">
        ${thumb}
        <div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-right:8px;" title="${escapeHtml(tooltip)}">
          ${labelHtml}
        </div>
        <span class="detail-track-year">${t.year || ''}</span>
      </div>
    `;
  }

  openDetailPanel(
    track: Track,
    allTracks: Track[],
    allClusters: Cluster[],
    onSelectTrack?: (track: Track) => void
  ): void {
    if (!this.detailPanel || !this.detailContent) return;
    if (onSelectTrack) this.onSelectTrack = onSelectTrack;
    this.currentDetailTrackId = track.id;

    const {
      countryName,
      artistTracks,
      genreSections,
      locationTracks
    } = getTrackRecommendations(track, allTracks, allClusters);

    const buildSection = (title: string, list: Track[], showArtist: boolean) => !list.length ? '' : `
      <div class="detail-divider"></div>
      <div class="detail-section-title">${title}</div>
      <div class="detail-tracks-list">${list.map(t => this.renderDetailTrackItem(t, showArtist)).join('')}</div>
    `;

    let recoSectionsHtml = buildSection(`More from ${escapeHtml(track.artist)}`, artistTracks, false);

    if (genreSections && genreSections.length > 0) {
      for (const sec of genreSections) {
        const genreTitle = `More ${escapeHtml(sec.genre)}`;
        recoSectionsHtml += buildSection(genreTitle, sec.tracks, true);
      }
    }

    if (locationTracks.length > 0) {
      recoSectionsHtml += buildSection('More Tracks', locationTracks, true);
    } else if (!artistTracks.length && (!genreSections || !genreSections.length)) {
      recoSectionsHtml += `
        <div class="detail-divider"></div>
        <div style="font-size:11px;color:var(--text-muted);padding:8px 0;text-align:center;">Sole archive track for this artist &amp; region</div>
      `;
    }

    const trackGenres = getTrackGenres(track);
    const genreBadgesHtml = trackGenres
      .map(g => `<span class="badge">${escapeHtml(g)}</span>`)
      .join('');

    const linkUrl = track.id ? `https://www.youtube.com/watch?v=${track.id}` : '#';

    this.detailContent.innerHTML = `
      <div class="detail-sticky-header">
        <div class="detail-header">
          <img class="detail-art" src="${track.thumbnail}" alt="">
          <div class="detail-header-info">
            <div class="detail-track-name">${escapeHtml(track.title)}</div>
            <div class="detail-artist-name">${escapeHtml(track.artist)}</div>
            <div class="detail-meta">
              <span class="badge badge--accent">${escapeHtml(countryName)}</span>
              <span class="badge">${track.year}</span>
              ${genreBadgesHtml}
            </div>
            <div style="display:flex;align-items:center;margin-top:6px;gap:6px;">
              <a class="detail-sc-link" href="${linkUrl}" target="_blank" rel="noopener">YouTube ${ICON_EXTERNAL_LINK}</a>
            </div>
          </div>
        </div>
      </div>
      <div class="detail-scroll-body">
        ${recoSectionsHtml}
      </div>
    `;

    this.detailPanel.classList.add('open');
  }

  openInfoPanel(): void {
    if (this.infoPanel) {
      this.infoPanel.classList.add('open');
    }
  }

  closeDetailPanel(): void {
    this.detailPanel?.classList.remove('open');
    this.currentDetailTrackId = null;
  }

  isDetailOpen(): boolean {
    return Boolean(this.detailPanel?.classList.contains('open'));
  }

  closeAllPanels(): void {
    this.closeDetailPanel();
    this.searchResults?.classList.remove('open');
    this.infoPanel?.classList.remove('open');
    this.sectorPanel?.classList.remove('open');
  }
}

export const panels = new UIPanels();
