import { RoomAdapter } from '../data/room-adapter';
import { getUserProfile } from '../data/identity';
import { saveLocalAudioBlob } from '../data/local-blobs';
import { sfx } from '../audio/sfx';
import { Station, Track } from '../types/index';
import { ICON_UPLOAD, escapeHtml } from './icons-helper';

export interface ImportModalInitOptions {
  getStations: () => Station[];
  getCurrentStationId: () => string;
  getActiveAdapter: () => RoomAdapter | null;
  onImportComplete: (targetStationId: string) => void;
}

interface UndoSnapshot {
  roomId: string;
  targetStationId?: string;
  stateBefore: {
    stations: Station[];
    tracks: Track[];
  };
  addedCount: number;
  mergedCount: number;
}

class ImportModal {
  private overlay: HTMLElement | null = null;
  private options: ImportModalInitOptions | null = null;
  private stagedFiles: File[] = [];
  private undoStack: UndoSnapshot[] = [];
  private toastTimer: number | null = null;
  private isImporting = false;

  init(options: ImportModalInitOptions): void {
    this.options = options;
    this.createDom();
    this.bindGlobalEvents();
  }

  private createDom(): void {
    const existing = document.getElementById('importModalOverlay');
    if (existing) existing.remove();

    this.overlay = document.createElement('div');
    this.overlay.id = 'importModalOverlay';
    this.overlay.className = 'landing-overlay';
    this.overlay.innerHTML = `
      <div class="landing-card import-card" role="dialog" aria-modal="true" aria-labelledby="importModalTitle">
        <div class="landing-header">
          <div class="landing-brand">
            <div class="landing-title" id="importModalTitle">IMPORT MUSIC</div>
            <div class="landing-subtitle">YouTube, Spotify, Bandcamp, SoundCloud, Apple Music, or Local Audio</div>
          </div>
          <button class="icon-close-btn" id="importModalClose" aria-label="Close modal"></button>
        </div>

        <!-- Target Station Selection -->
        <div>
          <div class="import-section-title">Destination Station</div>
          <div class="import-target-group">
            <select class="import-select" id="importTargetSelect">
              <option value="__auto__">Auto-create new station from playlist title</option>
              <option value="__current__">Add to current station</option>
              <option value="__custom__">+ Create new custom station...</option>
            </select>
            <input type="text" class="import-custom-station-input" id="importCustomStationName" placeholder="Enter custom station name..." style="display:none;">
          </div>
        </div>

        <!-- Import Sources Tabs -->
        <div>
          <div class="import-tabs">
            <button class="import-tab-btn active" id="tabUrlsBtn" type="button">Web URLs</button>
            <button class="import-tab-btn" id="tabLocalBtn" type="button">Local Audio Files</button>
          </div>

          <!-- URLs Tab View -->
          <div id="viewTabUrls" style="margin-top:10px;">
            <textarea
              class="import-textarea"
              id="importUrlsInput"
              placeholder="Paste playlist, album, or track URLs (one per line)...&#10;&#10;Supports:&#10;• YouTube playlists & videos&#10;• Spotify playlists, albums & tracks&#10;• Bandcamp albums & tracks&#10;• SoundCloud sets & tracks&#10;• Apple Music albums & tracks"
            ></textarea>
          </div>

          <!-- Local Files Tab View -->
          <div id="viewTabLocal" style="margin-top:10px;display:none;">
            <div class="import-dropzone" id="importDropzone">
              <div class="import-dropzone-icon">${ICON_UPLOAD}</div>
              <div class="import-dropzone-text">Drop audio files here or click to browse</div>
              <div class="import-dropzone-sub">Supports MP3, WAV, FLAC, OGG, M4A, AAC, WEBM</div>
              <input type="file" id="importFileInput" multiple accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a,.aac,.webm" style="display:none;">
            </div>
            <div class="import-files-list" id="importFilesList"></div>
          </div>
        </div>

        <!-- Progress & Status -->
        <div class="import-progress-container" id="importProgressContainer">
          <div class="import-progress-bar">
            <div class="import-progress-fill" id="importProgressFill"></div>
          </div>
          <div class="import-status-text" id="importStatusText">Ready to import</div>
        </div>

        <!-- Footer -->
        <div class="import-modal-footer">
          <button class="import-cancel-btn" id="importCancelBtn" type="button">Cancel</button>
          <button class="import-submit-btn" id="importSubmitBtn" type="button">Import Tracks</button>
        </div>
      </div>
    `;

    document.body.appendChild(this.overlay);

    // Create Toast Container
    let toast = document.getElementById('undoToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'undoToast';
      toast.className = 'undo-toast';
      toast.innerHTML = `
        <span id="undoToastText">Import complete</span>
        <button class="undo-toast-btn" id="undoToastBtn" type="button">Undo</button>
      `;
      document.body.appendChild(toast);
    }

    this.bindDomEvents();
  }

  private bindDomEvents(): void {
    if (!this.overlay) return;

    // Close buttons
    const closeBtn = this.overlay.querySelector('#importModalClose');
    const cancelBtn = this.overlay.querySelector('#importCancelBtn');
    closeBtn?.addEventListener('click', () => this.close());
    cancelBtn?.addEventListener('click', () => this.close());

    // Click outside card
    this.overlay.addEventListener('click', e => {
      if (e.target === this.overlay) this.close();
    });

    // Tab switching
    const tabUrlsBtn = this.overlay.querySelector('#tabUrlsBtn');
    const tabLocalBtn = this.overlay.querySelector('#tabLocalBtn');
    const viewTabUrls = this.overlay.querySelector('#viewTabUrls') as HTMLElement;
    const viewTabLocal = this.overlay.querySelector('#viewTabLocal') as HTMLElement;

    tabUrlsBtn?.addEventListener('click', () => {
      tabUrlsBtn.classList.add('active');
      tabLocalBtn?.classList.remove('active');
      if (viewTabUrls) viewTabUrls.style.display = 'block';
      if (viewTabLocal) viewTabLocal.style.display = 'none';
      sfx.play('click', 0.2);
    });

    tabLocalBtn?.addEventListener('click', () => {
      tabLocalBtn.classList.add('active');
      tabUrlsBtn?.classList.remove('active');
      if (viewTabUrls) viewTabUrls.style.display = 'none';
      if (viewTabLocal) viewTabLocal.style.display = 'block';
      sfx.play('click', 0.2);
    });

    // Destination selector
    const targetSelect = this.overlay.querySelector('#importTargetSelect') as unknown as HTMLSelectElement | null;
    const customNameInput = this.overlay.querySelector('#importCustomStationName') as HTMLInputElement | null;

    targetSelect?.addEventListener('change', () => {
      if (targetSelect.value === '__custom__') {
        if (customNameInput) {
          customNameInput.style.display = 'block';
          customNameInput.focus();
        }
      } else {
        if (customNameInput) {
          customNameInput.style.display = 'none';
        }
      }
    });

    // File dropzone
    const dropzone = this.overlay.querySelector('#importDropzone');
    const fileInput = this.overlay.querySelector('#importFileInput') as HTMLInputElement;

    dropzone?.addEventListener('click', () => fileInput?.click());

    dropzone?.addEventListener('dragover', e => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    dropzone?.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover');
    });

    dropzone?.addEventListener('drop', e => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      const files = (e as DragEvent).dataTransfer?.files;
      if (files && files.length > 0) {
        this.addStagedFiles(Array.from(files));
      }
    });

    fileInput?.addEventListener('change', () => {
      if (fileInput.files && fileInput.files.length > 0) {
        this.addStagedFiles(Array.from(fileInput.files));
      }
    });

    // Submit button
    const submitBtn = this.overlay.querySelector('#importSubmitBtn');
    submitBtn?.addEventListener('click', () => void this.handleImportSubmit());

    // Undo toast button
    const undoToastBtn = document.getElementById('undoToastBtn');
    undoToastBtn?.addEventListener('click', () => void this.undoLastImport());
  }

  private bindGlobalEvents(): void {
    // Keyboard shortcut Cmd+Z / Ctrl+Z for undo
    document.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        const tag = (document.activeElement as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        if (this.undoStack.length > 0) {
          e.preventDefault();
          void this.undoLastImport();
        }
      }
    });
  }

  private addStagedFiles(files: File[]): void {
    const audioFiles = files.filter(f =>
      f.type.startsWith('audio/') ||
      /\.(mp3|wav|flac|ogg|m4a|aac|webm)$/i.test(f.name)
    );

    if (audioFiles.length === 0) return;

    for (const f of audioFiles) {
      if (!this.stagedFiles.some(existing => existing.name === f.name && existing.size === f.size)) {
        this.stagedFiles.push(f);
      }
    }

    this.renderStagedFiles();
    sfx.play('click', 0.2);
  }

  private renderStagedFiles(): void {
    const list = document.getElementById('importFilesList');
    if (!list) return;

    list.innerHTML = this.stagedFiles.map((f, idx) => `
      <div class="import-file-chip">
        <span>${escapeHtml(f.name)} (${(f.size / 1024 / 1024).toFixed(1)}MB)</span>
        <button class="import-file-chip-remove" data-idx="${idx}" title="Remove file" type="button">×</button>
      </div>
    `).join('');

    list.querySelectorAll<HTMLButtonElement>('.import-file-chip-remove').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const idx = Number(btn.dataset.idx);
        this.stagedFiles.splice(idx, 1);
        this.renderStagedFiles();
      });
    });
  }

  open(preselectedStationId?: string): void {
    if (!this.overlay || !this.options) return;

    const adapter = this.options.getActiveAdapter();
    if (adapter?.isReadOnly) {
      window.alert('This room is read-only. Create a Shared Room or open your Local Waystation to import tracks.');
      return;
    }

    // Refresh Target Station dropdown
    const targetSelect = this.overlay.querySelector('#importTargetSelect') as unknown as HTMLSelectElement | null;
    const customNameInput = this.overlay.querySelector('#importCustomStationName') as HTMLInputElement | null;
    if (targetSelect) {
      const stations = this.options.getStations();
      const currentStationId = preselectedStationId || this.options.getCurrentStationId();
      const currentStation = stations.find(s => s.id === currentStationId);
      const currentName = currentStation ? currentStation.name : 'All Tracks';

      let optionsHtml = `
        <option value="__auto__">Auto-create new station from playlist title</option>
        <option value="__current__">Add to current station: ${escapeHtml(currentName)}</option>
        <option value="__custom__">+ Create new custom station...</option>
      `;

      for (const s of stations) {
        if (s.id === 'all') continue;
        const selected = s.id === currentStationId ? ' selected' : '';
        optionsHtml += `<option value="${s.id}"${selected}>Station: ${escapeHtml(s.name)}</option>`;
      }

      targetSelect.innerHTML = optionsHtml;
      if (preselectedStationId && preselectedStationId !== 'all') {
        targetSelect.value = preselectedStationId;
      } else {
        targetSelect.value = '__auto__';
      }
      if (customNameInput) {
        customNameInput.style.display = 'none';
      }
    }

    // Reset progress
    const progressContainer = document.getElementById('importProgressContainer');
    const progressFill = document.getElementById('importProgressFill');
    const statusText = document.getElementById('importStatusText');
    const submitBtn = document.getElementById('importSubmitBtn') as HTMLButtonElement;

    progressContainer?.classList.remove('active');
    if (progressFill) progressFill.style.width = '0%';
    if (statusText) statusText.textContent = 'Ready to import';
    if (submitBtn) submitBtn.disabled = false;

    this.overlay.classList.add('open');
    sfx.play('transition', 0.3);
  }

  close(): void {
    if (this.isImporting) return;
    this.overlay?.classList.remove('open');
  }

  isOpen(): boolean {
    return Boolean(this.overlay?.classList.contains('open'));
  }

  private parseFilenameMetadata(filename: string): { title: string; artist: string } {
    const base = filename.replace(/\.[^/.]+$/, '').trim();
    const sepIdx = base.indexOf(' - ');
    if (sepIdx > 0) {
      return {
        artist: base.slice(0, sepIdx).trim(),
        title: base.slice(sepIdx + 3).trim()
      };
    }
    return {
      title: base,
      artist: 'Local Artist'
    };
  }

  private async handleImportSubmit(): Promise<void> {
    if (!this.options || this.isImporting) return;
    const adapter = this.options.getActiveAdapter();
    if (!adapter) return;

    const urlsInput = document.getElementById('importUrlsInput') as HTMLTextAreaElement;
    const rawUrls = (urlsInput?.value || '').trim();
    const urlLines = rawUrls
      ? rawUrls.split('\n').map(l => l.trim()).filter(l => l.length > 0)
      : [];

    if (urlLines.length === 0 && this.stagedFiles.length === 0) {
      window.alert('Please paste at least one track/playlist URL or add local audio files.');
      return;
    }

    this.isImporting = true;
    const submitBtn = document.getElementById('importSubmitBtn') as HTMLButtonElement;
    const progressContainer = document.getElementById('importProgressContainer');
    const progressFill = document.getElementById('importProgressFill');
    const statusText = document.getElementById('importStatusText');

    if (submitBtn) submitBtn.disabled = true;
    progressContainer?.classList.add('active');

    // 1. Take undo snapshot of current state
    const currentState = adapter.getState();
    const stateBefore = {
      stations: JSON.parse(JSON.stringify(currentState.stations)) as Station[],
      tracks: JSON.parse(JSON.stringify(currentState.tracks)) as Track[]
    };

    const targetSelect = document.getElementById('importTargetSelect') as HTMLSelectElement | null;
    const customNameInput = document.getElementById('importCustomStationName') as HTMLInputElement | null;
    const targetMode = targetSelect?.value || '__auto__';

    let targetStationId: string | null = null;

    if (targetMode === '__current__') {
      targetStationId = this.options.getCurrentStationId();
    } else if (targetMode === '__custom__') {
      const customName = (customNameInput?.value || '').trim() || 'Imported Station';
      const created = await adapter.createStation(customName);
      targetStationId = created.id;
    } else if (targetMode !== '__auto__') {
      targetStationId = targetMode;
    }

    const allTracksToAdd: Track[] = [];
    const totalSteps = urlLines.length + (this.stagedFiles.length > 0 ? 1 : 0);
    let completedSteps = 0;

    const user = getUserProfile();

    try {
      // 2. Process URLs
      for (let i = 0; i < urlLines.length; i++) {
        const url = urlLines[i];
        if (statusText) statusText.textContent = `Fetching ${i + 1}/${urlLines.length}: ${url.slice(0, 50)}...`;

        try {
          const resp = await fetch(`/api/import?url=${encodeURIComponent(url)}`);
          if (!resp.ok) {
            const errData = await resp.json().catch(() => ({}));
            console.warn(`Import failed for ${url}:`, errData);
            continue;
          }

          const data = (await resp.json()) as {
            ok: boolean;
            source: any;
            playlistTitle?: string;
            tracks?: any[];
          };

          if (data.ok && Array.isArray(data.tracks) && data.tracks.length > 0) {
            // If target station was set to auto-create and hasn't been created yet, create it now
            if (!targetStationId) {
              const stationName = data.playlistTitle || 'Imported Station';
              const created = await adapter.createStation(stationName);
              targetStationId = created.id;
            }

            for (const t of data.tracks) {
              allTracksToAdd.push({
                id: t.id || `imp-${data.source}-${Math.random().toString(36).slice(2, 10)}`,
                title: t.title || 'Unknown Title',
                artist: t.artist || 'Unknown Artist',
                year: t.year || new Date().getFullYear(),
                genre: 'Imported',
                city: '',
                country: '',
                lat: 0,
                lng: 0,
                thumbnail: t.thumbnail || t.artworkUrl,
                importSource: t.importSource,
                ytId: t.ytId,
                scUrl: t.scUrl,
                bcUrl: t.bcUrl,
                tralbumId: t.tralbumId,
                tralbumType: t.tralbumType,
                spotifyUrl: t.spotifyUrl,
                appleMusicUrl: t.appleMusicUrl,
                stationIds: [targetStationId],
                addedByUserIds: [user.id],
                addedAt: Date.now()
              });
            }
          }
        } catch (e: any) {
          console.error('URL import network error:', e);
        }

        completedSteps++;
        if (progressFill) progressFill.style.width = `${Math.round((completedSteps / totalSteps) * 80)}%`;
      }

      // 3. Process Local Audio Files
      if (this.stagedFiles.length > 0) {
        if (!targetStationId) {
          const created = await adapter.createStation('Local Music');
          targetStationId = created.id;
        }

        for (let j = 0; j < this.stagedFiles.length; j++) {
          const file = this.stagedFiles[j];
          if (statusText) statusText.textContent = `Saving audio ${j + 1}/${this.stagedFiles.length}: ${file.name}...`;

          const blobKey = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          await saveLocalAudioBlob(blobKey, file);

          const { title, artist } = this.parseFilenameMetadata(file.name);

          allTracksToAdd.push({
            id: `imp-loc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            title,
            artist,
            year: new Date().getFullYear(),
            genre: 'Local',
            city: 'Local',
            country: 'Local',
            lat: 0,
            lng: 0,
            importSource: 'local',
            localBlobKey: blobKey,
            stationIds: [targetStationId],
            addedByUserIds: [user.id],
            addedAt: Date.now()
          });
        }

        completedSteps++;
        if (progressFill) progressFill.style.width = '85%';
      }

      if (allTracksToAdd.length === 0) {
        if (statusText) statusText.textContent = 'No playable tracks found to import.';
        if (submitBtn) submitBtn.disabled = false;
        this.isImporting = false;
        return;
      }

      // 4. Deduplication & Overlap Merge
      if (statusText) statusText.textContent = `Merging ${allTracksToAdd.length} tracks into station...`;

      // Check duplicates against existing room tracks
      const existingRoomTracks = adapter.getState().tracks;
      const existingKeys = new Set<string>();

      for (const t of existingRoomTracks) {
        if (t.ytId) existingKeys.add(`yt:${t.ytId}`);
        if (t.scUrl) existingKeys.add(`sc:${t.scUrl.split('?')[0].toLowerCase().replace(/\/$/, '')}`);
        if (t.bcUrl) existingKeys.add(`bc:${t.bcUrl.split('?')[0].toLowerCase().replace(/\/$/, '')}`);
        if (t.spotifyUrl) existingKeys.add(`sp:${t.spotifyUrl.split('?')[0].toLowerCase().replace(/\/$/, '')}`);
        if (t.appleMusicUrl) existingKeys.add(`am:${t.appleMusicUrl.split('?')[0].toLowerCase().replace(/\/$/, '')}`);
        if (t.localBlobKey) existingKeys.add(`local:${t.localBlobKey}`);
        if (t.artist && t.title) {
          existingKeys.add(`meta:${t.artist.trim().toLowerCase()}|||${t.title.trim().toLowerCase()}`);
        }
      }

      let mergedCount = 0;
      let newCount = 0;

      for (const t of allTracksToAdd) {
        let isDup = false;
        if (t.ytId && existingKeys.has(`yt:${t.ytId}`)) isDup = true;
        if (t.scUrl && existingKeys.has(`sc:${t.scUrl.split('?')[0].toLowerCase().replace(/\/$/, '')}`)) isDup = true;
        if (t.bcUrl && existingKeys.has(`bc:${t.bcUrl.split('?')[0].toLowerCase().replace(/\/$/, '')}`)) isDup = true;
        if (t.spotifyUrl && existingKeys.has(`sp:${t.spotifyUrl.split('?')[0].toLowerCase().replace(/\/$/, '')}`)) isDup = true;
        if (t.appleMusicUrl && existingKeys.has(`am:${t.appleMusicUrl.split('?')[0].toLowerCase().replace(/\/$/, '')}`)) isDup = true;
        if (t.localBlobKey && existingKeys.has(`local:${t.localBlobKey}`)) isDup = true;
        if (t.artist && t.title && existingKeys.has(`meta:${t.artist.trim().toLowerCase()}|||${t.title.trim().toLowerCase()}`)) isDup = true;

        if (isDup) {
          mergedCount++;
        } else {
          newCount++;
        }
      }

      // Add to adapter
      await adapter.addTracksToStation(targetStationId || 'all', allTracksToAdd);

      // Save to undo stack
      this.undoStack.push({
        roomId: adapter.roomId,
        targetStationId: targetStationId || undefined,
        stateBefore,
        addedCount: newCount,
        mergedCount
      });
      if (this.undoStack.length > 15) this.undoStack.shift();

      if (progressFill) progressFill.style.width = '100%';
      const summaryMsg = `Done! ${newCount} added, ${mergedCount} duplicates merged.`;
      if (statusText) statusText.textContent = summaryMsg;

      sfx.play('transition', 0.4);

      // Reset form fields
      if (urlsInput) urlsInput.value = '';
      this.stagedFiles = [];
      this.renderStagedFiles();

      // Show floating undo toast
      this.showUndoToast(`Imported ${newCount} tracks${mergedCount > 0 ? ` (${mergedCount} merged)` : ''}. Press Cmd+Z to undo.`);

      // Notify callback to switch to target station
      if (targetStationId) {
        this.options.onImportComplete(targetStationId);
      }

      // Auto close after brief delay
      setTimeout(() => {
        this.isImporting = false;
        this.close();
      }, 1200);

    } catch (e: any) {
      console.error('Import process failed:', e);
      if (statusText) statusText.textContent = `Error: ${e.message}`;
      if (submitBtn) submitBtn.disabled = false;
      this.isImporting = false;
    }
  }

  async undoLastImport(): Promise<void> {
    if (this.undoStack.length === 0 || !this.options) return;
    const adapter = this.options.getActiveAdapter();
    if (!adapter) return;

    const snap = this.undoStack.pop();
    if (!snap) return;

    try {
      await adapter.restoreSnapshot(snap.stateBefore);
      sfx.play('transition', 0.3);
      this.showUndoToast('Import undone');
    } catch (e: any) {
      console.error('Failed to undo import:', e);
      this.showUndoToast('Could not undo import');
    }
  }

  private showUndoToast(msg: string): void {
    const toast = document.getElementById('undoToast');
    const toastText = document.getElementById('undoToastText');
    if (!toast || !toastText) return;

    toastText.textContent = msg;
    toast.classList.add('visible');

    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      toast.classList.remove('visible');
    }, 4500);
  }
}

export const importModal = new ImportModal();
