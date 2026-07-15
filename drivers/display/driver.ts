import Homey from 'homey';
import { KioskServer } from '../../server';

module.exports = class DisplayDriver extends Homey.Driver {

  private sceneSelectedTrigger!: Homey.FlowCardTriggerDevice;
  private lightLevelChangedTrigger!: Homey.FlowCardTriggerDevice;

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log('DisplayDriver has been initialized');

    this.sceneSelectedTrigger = this.homey.flow.getDeviceTriggerCard('scene-selected');
    this.lightLevelChangedTrigger = this.homey.flow.getDeviceTriggerCard('light-level-changed');

    // An empty slider name argument matches any slider on the display
    this.lightLevelChangedTrigger.registerRunListener(
      async (args, state) => !args.name || args.name === state.name,
    );

    const kioskServer = this.getKioskServer();
    if (!kioskServer) {
      this.error('KioskServer not found in app, Flow triggers will not fire');
    } else {
      // Trigger the Flow cards on the device the WebSocket message came from
      kioskServer.on('scene', (ip: string, name: string, active: boolean) => {
        const device = this.getDeviceByIp(ip);
        if (!device) {
          this.log(`Scene selected from unknown device ${ip}, ignoring`);
          return;
        }
        this.log(`Scene selected on ${ip}: ${name}, active: ${active}`);
        this.sceneSelectedTrigger.trigger(device, { name, active }).catch(this.error);
      });

      kioskServer.on('light', (ip: string, name: string, strength: number) => {
        const device = this.getDeviceByIp(ip);
        if (!device) {
          this.log(`Light level changed from unknown device ${ip}, ignoring`);
          return;
        }
        this.log(`Light level changed on ${ip}, slider ${name}: ${strength}`);
        this.lightLevelChangedTrigger.trigger(device, { name, strength }, { name }).catch(this.error);
      });
    }

    // Action cards target the display selected in the Flow (args.device)
    this.homey.flow.getActionCard('scene-complete')
      .registerRunListener(async (args) => {
        const ip = this.ipOf(args.device);
        this.log(`Scene complete action for ${ip}:`, args.name, args.active);
        this.getKioskServer()?.sceneComplete(ip, args.name, args.active);
        return true;
      });

    this.homey.flow.getActionCard('light-level-complete')
      .registerRunListener(async (args) => {
        const ip = this.ipOf(args.device);
        this.log(`Light level complete action for ${ip}, slider ${args.name || '(all)'}:`, args.strength);
        this.getKioskServer()?.lightLevelComplete(ip, args.name || undefined, args.strength);
        return true;
      });

    this.homey.flow.getActionCard('set-variable')
      .registerRunListener(async (args) => {
        const ip = this.ipOf(args.device);
        this.log(`Set variable action for ${ip}: ${args.name} = "${args.value ?? ''}"`);
        this.getKioskServer()?.setVariable(ip, args.name, args.value ?? '');
        return true;
      });
  }

  private getKioskServer(): KioskServer | undefined {
    return (this.homey.app as any).kioskServer;
  }

  private ipOf(device: Homey.Device): string {
    return device.getData().id || device.getStore().ip;
  }

  private getDeviceByIp(ip: string): Homey.Device | undefined {
    return this.getDevices().find((device) => this.ipOf(device) === ip);
  }

  /**
   * onPairListDevices is called when a user is adding a device and the 'list_devices' view is called.
   * This should return an array with the data of devices that are available for pairing.
   */
  async onPairListDevices() {
    this.log('onPairListDevices called');

    const kioskServer = this.getKioskServer();
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
