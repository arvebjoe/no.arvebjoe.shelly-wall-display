'use strict';

import Homey from 'homey';
import { KioskServer } from './src/server';

module.exports = class ShellyWallDisplayApp extends Homey.App {
  private kioskServer!: KioskServer;
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
      // Get port from environment or use default
      const port = 8123;

      // Create and start the kiosk server
      this.kioskServer = new KioskServer(port);
      await this.kioskServer.start();

      this.log(`Kiosk server started on port ${port}`);
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
