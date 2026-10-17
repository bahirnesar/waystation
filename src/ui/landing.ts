import {
  CURATED_ROOMS,
  CURATED_ROOM_IDS,
  sanitizeRoomSlug
} from '../data/curated-rooms';
import {
  USER_COLORS,
  generateRoomSlug,
  getSavedRooms,
  getUserProfile,
  removeRoomBookmark,
  saveUserProfile
} from '../data/identity';
import { escapeHtml } from '../data/store';
import { sfx } from '../audio/sfx';
import { RoomState } from '../types/index';

export interface LandingControllerOptions {
  onNavigate: (path: string) => void;
  onPublishLocalRoom: () => Promise<void>;
}

class LandingUI {
  private overlayEl: HTMLElement | null = null;
  private options: LandingControllerOptions | null = null;

  init(options: LandingControllerOptions): void {
    this.options = options;
    this.ensureDOM();

    document.getElementById('logoBtn')?.addEventListener('click', e => {
      e.stopPropagation();
      sfx.play('click');
      this.open();
    });
  }

  private ensureDOM(): void {
    if (!document.getElementById('landingOverlay')) {
      const overlay = document.createElement('div');
      overlay.className = 'landing-overlay';
      overlay.id = 'landingOverlay';
      document.body.appendChild(overlay);
      this.overlayEl = overlay;

      overlay.addEventListener('click', e => {
        if (e.target === overlay) this.close();
      });
    }
  }

  open(): void {
    this.ensureDOM();
    if (!this.overlayEl) return;
    this.renderModal();
    this.overlayEl.classList.add('open');
  }

  close(): void {
    this.overlayEl?.classList.remove('open');
  }

  isOpen(): boolean {
    return Boolean(this.overlayEl?.classList.contains('open'));
  }

  updateTopBarStatus(_room: RoomState): void {
    // Room status pill replaced by #roomViewBtn and #roomPanelBtn
  }

  private renderModal(): void {
    if (!this.overlayEl) return;
    const profile = getUserProfile();
    const savedRooms = getSavedRooms().filter(r => !CURATED_ROOM_IDS.has(r.id.toLowerCase()));

    const swatchesHtml = USER_COLORS.map(
      c =>
        `<div class="color-swatch ${c === profile.color ? 'active' : ''}" data-color="${c}" style="background:${c}"></div>`
    ).join('');

    const curatedHtml = CURATED_ROOMS.map(
      room => `
        <div class="featured-room-card" data-curated-id="${escapeHtml(room.id)}">
          <div class="featured-room-info">
            <div class="featured-room-tag">&#9733; ${escapeHtml(room.tag || 'Curated Room')} • /r/${escapeHtml(room.id)}</div>
            <div class="featured-room-title">${escapeHtml(room.name)}</div>
            <div class="featured-room-desc">${escapeHtml(room.subtitle)}</div>
          </div>
          <div class="featured-room-cta">Enter Room &rarr;</div>
        </div>
      `
    ).join('');

    const savedListHtml = savedRooms.length
      ? `
        <div class="landing-saved-section">
          <div class="landing-section-label">Saved Shared Rooms</div>
          <div class="saved-rooms-list">
            ${savedRooms
        .map(
          r => `
              <div class="saved-room-row" data-room="${escapeHtml(r.id)}">
                <div>
                  <div class="saved-room-name">/r/${escapeHtml(r.id)}</div>
                  <div class="saved-room-meta">${r.trackCount} tracks • ${r.stationCount} stations</div>
                </div>
                <button class="saved-room-remove" data-remove="${escapeHtml(r.id)}" title="Remove bookmark">&times;</button>
              </div>
            `
        )
        .join('')}
          </div>
        </div>
      `
      : '';

    this.overlayEl.innerHTML = `
      <div class="landing-card">
        <div class="landing-header">
          <div class="landing-brand">
            <div class="landing-title">Waystation</div>
          </div>
          <button class="icon-close-btn landing-close" id="landingCloseBtn" title="Close">&times;</button>
        </div>

        <!-- Identity Bar -->
        <div class="landing-identity">
          <div class="identity-orb" id="identityOrb" style="background:${profile.color}"></div>
          <input type="text" class="identity-input" id="identityNameInput" value="${escapeHtml(profile.username)}" placeholder="Choose a username..." maxlength="28">
          <div class="identity-colors" id="identitySwatches">${swatchesHtml}</div>
        </div>

        <!-- Private & Shared Sessions -->
        <div class="landing-actions-grid">
          <button class="landing-action-card" id="cardOpenLocal">
            <div class="landing-action-title">Private Session</div>
            <div class="landing-action-desc">Start a private session saved in your browser</div>
          </button>
          <button class="landing-action-card" id="cardCreateShared">
            <div class="landing-action-title">Shared Session</div>
            <div class="landing-action-desc">Start a shared session to build collaborative playlists</div>
          </button>
        </div>

        <!-- Join Shared Room by Code / URL -->
        <div class="landing-join-row">
          <input type="text" class="landing-join-input" id="joinRoomInput" placeholder="Join shared session...">
          <button class="landing-join-btn" id="joinRoomBtn">Join</button>
        </div>

        <!-- Featured Curated Rooms (Initially Ostalgie) -->
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${curatedHtml}
        </div>

        ${savedListHtml}
      </div>
    `;

    // Bind events
    document.getElementById('landingCloseBtn')?.addEventListener('click', () => {
      sfx.play('click');
      this.close();
    });

    const nameInput = document.getElementById('identityNameInput') as HTMLInputElement | null;
    nameInput?.addEventListener('change', () => {
      const updated = { ...getUserProfile(), username: nameInput.value.trim() };
      saveUserProfile(updated);
    });

    document.getElementById('identitySwatches')?.addEventListener('click', e => {
      const swatch = (e.target as HTMLElement).closest<HTMLElement>('.color-swatch');
      if (!swatch || !swatch.dataset.color) return;
      const color = swatch.dataset.color;
      const updated = { ...getUserProfile(), color };
      saveUserProfile(updated);
      this.renderModal();
    });

    document.getElementById('cardOpenLocal')?.addEventListener('click', () => {
      sfx.play('switch');
      this.close();
      this.options?.onNavigate('/local');
    });

    document.getElementById('cardCreateShared')?.addEventListener('click', () => {
      sfx.play('switch');
      const slug = generateRoomSlug();
      this.close();
      this.options?.onNavigate(`/r/${slug}`);
    });

    this.overlayEl.querySelectorAll<HTMLElement>('[data-curated-id]').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.curatedId;
        if (!id) return;
        sfx.play('switch');
        this.close();
        this.options?.onNavigate(`/r/${id}`);
      });
    });

    const joinInput = document.getElementById('joinRoomInput') as HTMLInputElement | null;
    const handleJoin = () => {
      const raw = (joinInput?.value || '').trim();
      if (!raw) return;
      let slug = raw;
      const match = raw.match(/\/r\/([^/?#]+)/i);
      if (match) slug = match[1];
      slug = sanitizeRoomSlug(slug);
      if (!slug) return;
      sfx.play('switch');
      this.close();
      this.options?.onNavigate(slug === 'local' ? '/local' : `/r/${slug}`);
    };

    document.getElementById('joinRoomBtn')?.addEventListener('click', handleJoin);
    joinInput?.addEventListener('keydown', e => {
      if (e.key === 'Enter') handleJoin();
    });

    this.overlayEl.querySelectorAll<HTMLElement>('.saved-room-row').forEach(row => {
      row.addEventListener('click', e => {
        const removeBtn = (e.target as HTMLElement).closest<HTMLElement>('.saved-room-remove');
        if (removeBtn && removeBtn.dataset.remove) {
          e.stopPropagation();
          removeRoomBookmark(removeBtn.dataset.remove);
          this.renderModal();
          return;
        }
        const roomId = row.dataset.room;
        if (roomId) {
          sfx.play('switch');
          this.close();
          this.options?.onNavigate(`/r/${roomId}`);
        }
      });
    });
  }
}

export const landing = new LandingUI();
