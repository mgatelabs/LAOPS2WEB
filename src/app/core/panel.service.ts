import { Injectable, signal } from '@angular/core';

export type PanelId = 'properties' | 'layers' | 'library';

const STORAGE_KEY = 'laops.panels';

interface PanelState {
  [id: string]: { open: boolean; width: number; height: number; minimized: boolean };
}

const DEFAULTS: PanelState = {
  properties: { open: true, width: 280, height: 0, minimized: false },
  layers: { open: true, width: 280, height: 0, minimized: false },
  library: { open: true, width: 0, height: 220, minimized: false }
};

interface PanelStateSig {
  open: boolean;
  width: number;
  height: number;
  minimized: boolean;
}

@Injectable({ providedIn: 'root' })
export class PanelService {
  private readonly state: Record<PanelId, PanelStateSig> = {
    properties: { ...DEFAULTS.properties },
    layers: { ...DEFAULTS.layers },
    library: { ...DEFAULTS.library }
  };

  versions = signal(0);

  constructor() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<Record<PanelId, Partial<PanelStateSig>>>;
        for (const key of Object.keys(saved) as PanelId[]) {
          if (this.state[key]) {
            this.state[key] = { ...this.state[key], ...saved[key] };
          }
        }
      }
    } catch {
      // ignore corrupt localStorage
    }
  }

  get(id: PanelId): PanelStateSig {
    return this.state[id];
  }

  set(id: PanelId, patch: Partial<PanelStateSig>): void {
    this.state[id] = { ...this.state[id], ...patch };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // storage full/unavailable
    }
    this.versions.update(v => v + 1);
  }

  toggle(id: PanelId): void {
    this.set(id, { open: !this.state[id].open });
  }

  toggleMinimize(id: PanelId): void {
    this.set(id, { minimized: !this.state[id].minimized });
  }
}
