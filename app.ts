'use strict';

import Homey from 'homey';
import { KioskServer } from './server';
import { LayoutStore } from './src/layout-store';

const SERVER_PORT = 8123;

module.exports = class ShellyWallDisplayApp extends Homey.App {
  public kioskServer!: KioskServer;
  private layoutStore!: LayoutStore;

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('ShellyWallDisplayApp has been initialized');

    try {
      // Layouts (JSON + rendered HTML) are persisted in /userdata,
      // the only writable folder on a Homey Pro.
      this.layoutStore = new LayoutStore();

      // Create and start the kiosk server
      this.kioskServer = new KioskServer(SERVER_PORT, this.layoutStore);
      await this.kioskServer.start();

      this.log(`Kiosk server started on port ${SERVER_PORT}`);
      this.getEditorUrl()
        .then((url) => this.log(`GUI editor available at ${url}`))
        .catch(() => { /* address not available yet */ });
    } catch (error) {
      this.error('Failed to start kiosk server:', error);
      return;
    }

    // Flow cards are device-level and registered in drivers/display/driver.ts
  }

  /**
   * Returns the LAN URL of the GUI editor, shown in the app's settings
   * page. Uses Homey's local IP address so the link works for any browser
   * on the same network.
   */
  async getEditorUrl(): Promise<string> {
    // getLocalAddress() returns e.g. "192.168.1.100:80"
    const address = await this.homey.cloud.getLocalAddress();
    const host = address.split(':')[0];
    return `http://${host}:${SERVER_PORT}/editor`;
  }

  /**
   * onUninit is called when the app is destroyed.
   */
  async onUninit() {
    this.log('ShellyWallDisplayApp is being destroyed');

    if (this.kioskServer && this.kioskServer.isRunning()) {
      try {
        await this.kioskServer.stop();
        this.log('Kiosk server stopped');
      } catch (error) {
        this.error('Failed to stop kiosk server:', error);
      }
    }
  }
}
