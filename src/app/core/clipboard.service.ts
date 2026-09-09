import { Injectable, signal } from '@angular/core';
import { Scene } from './models';

@Injectable({ providedIn: 'root' })
export class ClipboardService {
  scene = signal<Scene | null>(null);
  lastCopied = signal<string | null>(null);
  readonly busy = signal(false);

  copyScene(scene: Scene): void {
    this.scene.set(JSON.parse(JSON.stringify(scene)) as Scene);
    this.lastCopied.set('scene');
  }

  copyJson(scene: Scene): void {
    void this.writeText(JSON.stringify(scene, null, 2));
    this.lastCopied.set('scene');
  }

  copyNodeJson(nodeJson: string): void {
    void this.writeText(nodeJson);
    this.lastCopied.set('node');
  }

  async copyPngBlob(blob: Blob): Promise<boolean> {
    try {
      if (typeof ClipboardItem === 'undefined') return false;
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return true;
    } catch {
      return false;
    }
  }

  async writeText(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch {
        return false;
      }
    }
  }
}
