'use strict';

import Homey from 'homey';

module.exports = class ShellyWallDisplayApp extends Homey.App {

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('ShellyWallDisplayApp has been initialized');
  }

}
