'use strict';

import Homey from 'homey';
import { KioskServer } from './server';
import { LayoutStore } from './src/layout-store';

const SERVER_PORT = 8123;

module.exports = class ShellyWallDisplayApp extends Homey.App {
  public kioskServer!: KioskServer;
  private layoutStore!: LayoutStore;
  private sceneSelectionTrigger!: Homey.FlowCardTrigger;
  private lightLevelTrigger!: Homey.FlowCardTrigger;
  private sceneCompleteAction!: Homey.FlowCardAction;
  private lightLevelCompleteAction!: Homey.FlowCardAction;

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


    this.sceneSelectionTrigger = this.homey.flow.getTriggerCard('scene-selected');
    this.lightLevelTrigger = this.homey.flow.getTriggerCard('light-level-changed');
    this.sceneCompleteAction = this.homey.flow.getActionCard('scene-complete');
    this.lightLevelCompleteAction = this.homey.flow.getActionCard('light-level-complete');

    this.kioskServer.on('scene', (name: string, active: boolean) => {
      this.log(`Scene selected: ${name}, active: ${active}`);
      this.sceneSelectionTrigger.trigger({
        'name': name,
        'active': active
      });
    });

    this.kioskServer.on('light', (strength: number) => {
      this.log(`Light level changed: ${strength}`);
      this.lightLevelTrigger.trigger({
        'strength': (strength)
      });
    });


    this.sceneCompleteAction.registerRunListener(async (args) => {
      this.log('Scene complete action triggered with args:', args);
      // Here you can add any logic you want to execute when the action is triggered.
      this.kioskServer.sceneComplete(args.name, args.active);
      return Promise.resolve(true);
    });


    this.lightLevelCompleteAction.registerRunListener(async (args) => {
      this.log('Light level complete action triggered with args:', args);
      // Here you can add any logic you want to execute when the action is triggered.
      this.kioskServer.lightLevelComplete(args.strength);
      return Promise.resolve(true);
    });

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
