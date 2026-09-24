// ─── TIMELINE SCRUBBER & DENSITY HISTOGRAM ───
import { Track, RangeChangeEvent } from '../types/index';

export interface TimelineInitOptions {
  onRangeChange?: (range: RangeChangeEvent) => void;
}

class Timeline {
  barsEl: HTMLElement | null = null;
  trackEl: HTMLElement | null = null;
  overlayLEl: HTMLElement | null = null;
  overlayREl: HTMLElement | null = null;
  handleLEl: HTMLElement | null = null;
  handleREl: HTMLElement | null = null;
  labelLEl: HTMLElement | null = null;
  labelREl: HTMLElement | null = null;

  yearMin = 1967;
  yearMax = 2005;
  yearSpan = 38;

  rangeLeft = 0;
  rangeRight = 1;
  rangeYearL = 1967;
  rangeYearR = 2005;

  tlDragging = false;
  tlDragTarget: 'left' | 'right' | null = null;
  onRangeChange: ((range: RangeChangeEvent) => void) | null = null;

  init({ onRangeChange }: TimelineInitOptions = {}): void {
    this.onRangeChange = onRangeChange || null;

    this.barsEl = document.getElementById('tlBars');
    this.trackEl = document.getElementById('tlTrack');
    this.overlayLEl = document.getElementById('tlOverlayL');
    this.overlayREl = document.getElementById('tlOverlayR');
    this.handleLEl = document.getElementById('tlHandleL');
    this.handleREl = document.getElementById('tlHandleR');
    this.labelLEl = document.getElementById('tlLabelL');
    this.labelREl = document.getElementById('tlLabelR');

    this.bindEvents();
  }

  rebuildTimelineBars(tracks: Track[]): void {
    if (!this.barsEl) return;
    this.barsEl.innerHTML = '';
    if (!tracks?.length) return;

    let yMin = Infinity, yMax = -Infinity;
    const counts: Record<number, number> = {};

    for (let i = 0; i < tracks.length; i++) {
      const y = tracks[i].year;
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
      counts[y] = (counts[y] || 0) + 1;
    }

    this.yearMin = yMin;
    this.yearMax = yMax;
    this.yearSpan = Math.max(1, yMax - yMin);

    let maxC = 1;
    for (let y = yMin; y <= yMax; y++) {
      if ((counts[y] || 0) > maxC) maxC = counts[y];
    }

    let barsHtml = '';
    for (let y = yMin; y <= yMax; y++) {
      const height = Math.max(12, ((counts[y] || 0) / maxC) * 100);
      barsHtml += `<div class="tl-bar in-range" data-year="${y}" style="height:${height}%"></div>`;
    }
    this.barsEl.innerHTML = barsHtml;
  }

  yearFromNorm(n: number): number {
    return this.yearMin + n * this.yearSpan;
  }

  normFromYear(y: number): number {
    return (y - this.yearMin) / this.yearSpan;
  }

  snapToYear(y: number): number {
    return Math.max(this.yearMin, Math.min(this.yearMax, Math.round(y)));
  }

  resetRange(): void {
    this.rangeLeft = 0;
    this.rangeRight = 1;
    this.rangeYearL = this.yearMin;
    this.rangeYearR = this.yearMax;
    this.updateRangeUI();
  }

  updateRangeUI(): void {
    const pctL = this.rangeLeft * 100;
    const pctR = this.rangeRight * 100;
    if (this.overlayLEl) this.overlayLEl.style.width = pctL + '%';
    if (this.overlayREl) this.overlayREl.style.width = (100 - pctR) + '%';
    if (this.handleLEl) this.handleLEl.style.left = pctL + '%';
    if (this.handleREl) this.handleREl.style.left = pctR + '%';
    if (this.labelLEl) this.labelLEl.textContent = String(this.rangeYearL);
    if (this.labelREl) this.labelREl.textContent = String(this.rangeYearR);

    if (this.barsEl) {
      const children = this.barsEl.children;
      for (let i = 0; i < children.length; i++) {
        const y = this.yearMin + i;
        children[i].classList.toggle('in-range', y >= this.rangeYearL && y <= this.rangeYearR);
      }
    }

    if (this.onRangeChange) {
      this.onRangeChange({
        rangeYearL: this.rangeYearL,
        rangeYearR: this.rangeYearR
      });
    }
  }

  tlNormFromEvent(e: MouseEvent | PointerEvent): number {
    if (!this.trackEl) return 0;
    const r = this.trackEl.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  }

  bindEvents(): void {
    const bindHandle = (handle: HTMLElement | null, target: 'left' | 'right') => {
      handle?.addEventListener('pointerdown', e => {
        e.preventDefault();
        e.stopPropagation();
        window.getSelection()?.removeAllRanges();
        document.body.classList.add('tl-dragging');
        this.tlDragging = true;
        this.tlDragTarget = target;
        handle.classList.add('active');
        handle.setPointerCapture(e.pointerId);
      });
    };

    bindHandle(this.handleLEl, 'left');
    bindHandle(this.handleREl, 'right');

    this.trackEl?.addEventListener('pointerdown', e => {
      if (this.tlDragging) return;
      e.preventDefault();
      window.getSelection()?.removeAllRanges();
      document.body.classList.add('tl-dragging');
      const n = this.tlNormFromEvent(e);
      const distL = Math.abs(n - this.rangeLeft);
      const distR = Math.abs(n - this.rangeRight);
      if (distL <= distR) {
        this.tlDragTarget = 'left';
        this.rangeLeft = n;
        this.rangeYearL = this.snapToYear(this.yearFromNorm(n));
        this.rangeLeft = this.normFromYear(this.rangeYearL);
      } else {
        this.tlDragTarget = 'right';
        this.rangeRight = n;
        this.rangeYearR = this.snapToYear(this.yearFromNorm(n));
        this.rangeRight = this.normFromYear(this.rangeYearR);
      }
      if (this.rangeLeft > this.rangeRight) {
        [this.rangeLeft, this.rangeRight] = [this.rangeRight, this.rangeLeft];
        [this.rangeYearL, this.rangeYearR] = [this.rangeYearR, this.rangeYearL];
        this.tlDragTarget = this.tlDragTarget === 'left' ? 'right' : 'left';
      }
      this.tlDragging = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      this.updateRangeUI();
    });

    document.addEventListener('pointermove', e => {
      if (!this.tlDragging || !this.tlDragTarget) return;
      e.preventDefault();
      const snapped = this.snapToYear(this.yearFromNorm(this.tlNormFromEvent(e)));
      if (this.tlDragTarget === 'left' && snapped <= this.rangeYearR) {
        this.rangeYearL = snapped;
        this.rangeLeft = this.normFromYear(snapped);
      } else if (this.tlDragTarget === 'right' && snapped >= this.rangeYearL) {
        this.rangeYearR = snapped;
        this.rangeRight = this.normFromYear(snapped);
      }
      this.updateRangeUI();
    });

    const endDrag = () => {
      if (this.tlDragging) {
        this.tlDragging = false;
        this.tlDragTarget = null;
        document.body.classList.remove('tl-dragging');
        this.handleLEl?.classList.remove('active');
        this.handleREl?.classList.remove('active');
      }
    };

    document.addEventListener('pointerup', endDrag);
    document.addEventListener('pointercancel', endDrag);
  }
}

export const timeline = new Timeline();
