import Homey from 'homey';
import { KioskServer } from '../../server';

module.exports = class DisplayDriver extends Homey.Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log('DisplayDriver has been initialized');
  }

  /**
   * onPairListDevices is called when a user is adding a device and the 'list_devices' view is called.
   * This should return an array with the data of devices that are available for pairing.
   */
  async onPairListDevices() {
    this.log('onPairListDevices called');

    // Get the KioskServer instance from the app
    const app = this.homey.app as any;
    const kioskServer: KioskServer = app.kioskServer;

    if (!kioskServer) {
      this.error('KioskServer not found in app');
      return [];
    }

    // Get all pending (unregistered) devices
    const pendingDevices = kioskServer.getPendingDevices();
    this.log(`Found ${pendingDevices.length} pending device(s)`);

    // Convert to Homey device format
    return pendingDevices.map(device => {
      return {
        name: `${device.ip} - Shelly Wall Display`,
        data: {
          id: device.ip // Use IP as unique identifier
        },
        store: {
          ip: device.ip,
          registeredAt: new Date().toISOString()
        }
      };
    });
  }

};
