import Homey from 'homey';
import { KioskServer } from '../../server';

module.exports = class DisplayDevice extends Homey.Device {

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.log('DisplayDevice has been initialized');

    // Register device with KioskServer on init (in case app was restarted)
    const deviceData = this.getData();
    const deviceStore = this.getStore();
    const ip = deviceData.id || deviceStore.ip;

    if (ip) {
      const app = this.homey.app as any;
      const kioskServer: KioskServer = app.kioskServer;

      if (kioskServer) {
        kioskServer.registerDevice(ip);
        this.log(`Device registered with IP: ${ip}`);
      }
    }
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.log('DisplayDevice has been added');

    // Register the device with the KioskServer
    const deviceData = this.getData();
    const deviceStore = this.getStore();
    const ip = deviceData.id || deviceStore.ip;

    this.log(`Registering device with IP: ${ip}`);

    const app = this.homey.app as any;
    const kioskServer: KioskServer = app.kioskServer;

    if (!kioskServer) {
      this.error('KioskServer not found in app');
      return;
    }

    const success = kioskServer.registerDevice(ip);
    if (success) {
      this.log(`Device ${ip} successfully registered`);
    } else {
      this.error(`Failed to register device ${ip}`);
    }
  }

  /**
   * onSettings is called when the user updates the device's settings.
   * @param {object} event the onSettings event data
   * @param {object} event.oldSettings The old settings object
   * @param {object} event.newSettings The new settings object
   * @param {string[]} event.changedKeys An array of keys changed since the previous version
   * @returns {Promise<string|void>} return a custom message that will be displayed
   */
  async onSettings({
    oldSettings,
    newSettings,
    changedKeys,
  }: {
    oldSettings: { [key: string]: boolean | string | number | undefined | null };
    newSettings: { [key: string]: boolean | string | number | undefined | null };
    changedKeys: string[];
  }): Promise<string | void> {
    this.log("DisplayDevice settings where changed");
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  async onRenamed(name: string) {
    this.log('DisplayDevice was renamed');
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted() {
    this.log('DisplayDevice has been deleted');

    // Unregister the device from KioskServer
    const deviceData = this.getData();
    const deviceStore = this.getStore();
    const ip = deviceData.id || deviceStore.ip;

    if (ip) {
      const app = this.homey.app as any;
      const kioskServer: KioskServer = app.kioskServer;

      if (kioskServer) {
        kioskServer.unregisterDevice(ip);
        this.log(`Device ${ip} unregistered from server`);
      }
    }
  }

};
