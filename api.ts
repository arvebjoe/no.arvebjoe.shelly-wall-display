'use strict';

/**
 * Web API endpoints for the app, callable from the settings page via
 * Homey.api(). Routes are declared in the "api" section of app.json.
 */

module.exports = {
  async getEditorUrl({ homey }: { homey: any }): Promise<string> {
    return homey.app.getEditorUrl();
  },
};
