import 'dotenv/config';
import fs from 'fs';
import path from 'path';

/**
 * Exposes the environment variables that have been defined
 * within the optional dotenv (.env) file within the running working directory.
 *
 * Harbor will define these environment variables and will fall back
 * to the default values when missing.
 */
export class Environment {
  constructor() {
    this.defaults = {
      THEME_PORT: 8080,
      THEME_DEBUG: false,
      THEME_ENVIRONMENT: 'production',
      THEME_STATIC_DIRECTORY: '',
      THEME_TEST_PHASE: 'test',
      THEME_WEBSOCKET_PORT: 35729,
      THEME_AS_CLI: false,
    };

    this.config = {};
  }

  /**
   * Loads the environment configuration from the optional environment file.
   */
  async define() {
    const source = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(source)) {
      process.env.DOTENV_CONFIG_PATH = source;
      await new Promise((done) => {
        import('dotenv/config').then(() => {
          done(process.env);
        });
      });
    }

    const parsed = process.env || {};

    // Inherit any missing option from the defaults Object.
    Object.keys(this.defaults).forEach((defaultOption) => {
      if (!Object.prototype.hasOwnProperty.call(parsed, defaultOption)) {
        parsed[defaultOption] = parseInt(this.defaults[defaultOption], 10)
          ? parseInt(this.defaults[defaultOption], 10)
          : this.defaults[defaultOption];
      }

      if (
        typeof parsed[defaultOption] === 'string' &&
        ['false', '0'].includes(parsed[defaultOption].toLowerCase())
      ) {
        parsed[defaultOption] = false;
      }

      if (
        typeof parsed[defaultOption] === 'string' &&
        ['true', '1'].includes(parsed[defaultOption].toLowerCase())
      ) {
        parsed[defaultOption] = true;
      }
    });

    this.config = parsed;

    return parsed;
  }

  /**
   * Checks if the defined environment build destination is empty.
   *
   * @param {Object} config The environment configuration to use.
   * 
   * @todo Move elsewhere? This is now not even checking the environment
   *   variable.
   */
  static hasBuild(config) {
    if (!config || !config.destination) {
      return false;
    }

    if (!fs.existsSync(path.resolve(config.destination))) {
      return false;
    }

    return fs.readdirSync(path.resolve(config.destination)).length > 0;
  }
}
