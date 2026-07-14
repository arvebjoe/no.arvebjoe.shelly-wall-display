/**
 * Persists GUI layouts on disk.
 *
 * On a Homey Pro the only writable, persistent location for an app is
 * the /userdata/ folder (it survives app restarts and updates), so both
 * the JSON layout definition and the rendered HTML file are stored there:
 *
 *   /userdata/layouts/<device-key>.json  - editable data representation
 *   /userdata/layouts/<device-key>.html  - rendered file served to the display
 */

import fs from 'fs/promises';
import path from 'path';
import { GuiLayout } from './layout-types';
import { renderLayoutHtml } from './renderer';

export class LayoutStore {
  private readonly dir: string;

  constructor(baseDir: string = '/userdata') {
    this.dir = path.join(baseDir, 'layouts');
  }

  /** Turns a device IP into a safe file name, e.g. "192.168.1.7" -> "192-168-1-7". */
  private keyFor(deviceIp: string): string {
    const key = deviceIp.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!key) throw new Error(`Invalid device id: ${deviceIp}`);
    return key;
  }

  private jsonPath(deviceIp: string): string {
    return path.join(this.dir, `${this.keyFor(deviceIp)}.json`);
  }

  public htmlPath(deviceIp: string): string {
    return path.join(this.dir, `${this.keyFor(deviceIp)}.html`);
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  public async hasLayout(deviceIp: string): Promise<boolean> {
    try {
      await fs.access(this.htmlPath(deviceIp));
      return true;
    } catch {
      return false;
    }
  }

  public async loadLayout(deviceIp: string): Promise<GuiLayout | null> {
    try {
      const raw = await fs.readFile(this.jsonPath(deviceIp), 'utf-8');
      return JSON.parse(raw) as GuiLayout;
    } catch {
      return null;
    }
  }

  /**
   * Saves the layout JSON and the rendered single-file HTML for a device.
   * Writes to temp files first so a crash mid-write never corrupts the
   * layout currently being served.
   */
  public async saveLayout(deviceIp: string, layout: GuiLayout): Promise<void> {
    await this.ensureDir();
    layout.updatedAt = new Date().toISOString();

    const html = renderLayoutHtml(layout);
    const jsonFile = this.jsonPath(deviceIp);
    const htmlFile = this.htmlPath(deviceIp);

    await fs.writeFile(`${jsonFile}.tmp`, JSON.stringify(layout, null, 2), 'utf-8');
    await fs.writeFile(`${htmlFile}.tmp`, html, 'utf-8');
    await fs.rename(`${jsonFile}.tmp`, jsonFile);
    await fs.rename(`${htmlFile}.tmp`, htmlFile);
  }

  /**
   * Re-renders the stored HTML of every saved layout from its JSON.
   * Called on app startup so renderer changes reach displays whose
   * layout was saved with an older renderer version.
   */
  public async rerenderAll(): Promise<void> {
    let files: string[];
    try {
      files = await fs.readdir(this.dir);
    } catch {
      return; // no layouts saved yet
    }

    for (const file of files.filter((f) => f.endsWith('.json'))) {
      try {
        const raw = await fs.readFile(path.join(this.dir, file), 'utf-8');
        const layout = JSON.parse(raw) as GuiLayout;
        const htmlFile = path.join(this.dir, `${file.slice(0, -'.json'.length)}.html`);
        await fs.writeFile(`${htmlFile}.tmp`, renderLayoutHtml(layout), 'utf-8');
        await fs.rename(`${htmlFile}.tmp`, htmlFile);
      } catch (error) {
        console.error(`Failed to re-render layout ${file}:`, error);
      }
    }
  }

  public async deleteLayout(deviceIp: string): Promise<void> {
    await Promise.allSettled([
      fs.unlink(this.jsonPath(deviceIp)),
      fs.unlink(this.htmlPath(deviceIp)),
    ]);
  }
}
