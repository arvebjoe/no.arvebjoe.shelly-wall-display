'use strict';

import Homey from 'homey';
import { KioskServer } from './src/server';

module.exports = class ShellyWallDisplayApp extends Homey.App {
  private kioskServer?: KioskServer;

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('ShellyWallDisplayApp has been initialized');
    
    try {
      // Get port from environment or use default
      const port = 8123;
      
      // Create and start the kiosk server
      this.kioskServer = new KioskServer(port);
      await this.kioskServer.start();
      
      this.log(`Kiosk server started on port ${port}`);
    } catch (error) {
      this.error('Failed to start kiosk server:', error);
    }
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
