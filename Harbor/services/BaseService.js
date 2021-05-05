const { join, resolve } = require('path');
const { statSync } = require('fs');
const { sync } = require('glob');

const ConfigManager = require('../common/ConfigManager');

const Environment = require('../common/Environment');
const Logger = require('../common/Logger');

/**
 * Creates a new Harbor Service that will be registered to the TaskManager.
 * The defined Service configuration & plugin specific options will be loaded
 * during the construction of the instance.
 *
 * @param {Object} tooling Includes optional Harbor utilities for the current
 * service.
 *
 * @param {Object} options Defines the Harbor specific options for the current
 * service.
 */
class BaseService {
  constructor(tooling, options) {
    const environment = new Environment();

    this.name = this.constructor.name;

    this.environment = environment.define();
    this.Console = new Logger(this.environment);

    this.config = ConfigManager.load(this.name);
    this.tooling = {};

    this.defineOptions(options);

    const hook =
      this.config.hook && this.config.hook !== this.name
        ? [this.name, this.config.hook]
        : [this.name];

    if (tooling) {
      this.Console.log(
        `Assigning tool: ${Object.keys(tooling).join(', ')} from service: ${
          this.name
        } as ${hook.join(', ')}`
      );
      this.tooling = Object.assign(this.tooling, tooling);
    }

    this.subscribe(hook);
  }

  /**
   * The initial handler that will subscribed to the Harbor TaskManager.
   */
  init() {
    this.defineEntry();
  }

  /**
   * Resolves the subscribed Task Manager Service handler.
   */
  resolve(exit) {
    const { TaskManager } = this.tooling;

    if (TaskManager && TaskManager.resolve) {
      this.Console.log(`Resolving service: ${this.name}`);

      TaskManager.resolve(this.name, exit);
    } else {
      this.Console.warning(`Unable to resolve ${this.name}, unable to find the Task Manager.`);
    }
  }

  /**
   * Rejects the subscribed Task Manager Service handler.
   */
  reject() {
    this.resolve(true);
  }

  /**
   * Subscribes the init handler of the current Service to the Task Manager.
   *
   * @param {string[]} hook Defines the publish hooks to call to subscription.
   */
  subscribe(hook) {
    const { TaskManager } = this.tooling;

    if (TaskManager) {
      TaskManager.subscribe(
        this.name,
        hook,
        this.initIfAccepted()
          ? this.init.bind(this)
          : () => {
              this.Console.warning(
                `${
                  this.name
                } will not be launched since it is only accepted for the ${this.options.acceptedEnvironments.join(
                  ', '
                )} environments.`
              );

              return this.resolve();
            }
      );
    }
  }

  /**
   * Creates a collection of entry paths from the configured service entry
   * configuration.
   *
   * @param {boolean} useDestination Use the defined THEME_DIST as base path for
   * the current entry, instead of the default THEME_SRC value.
   */
  defineEntry(useDestination) {
    if (!this.config.entry || !this.config.entry instanceof Object) {
      return;
    }

    const entries = Object.keys(this.config.entry);

    if (!entries.length) {
      return;
    }

    this.entry = entries
      .map((name) => {
        const p = join(
          useDestination ? this.environment.THEME_DIST : this.environment.THEME_SRC,
          this.config.entry[name]
        );

        return sync(p).filter((e) => {
          if (!statSync(e).size) {
            this.Console.log(`Skipping empty entry: ${e}`);
          }

          return statSync(e).size > 0 ? e : null;
        });
      })
      .filter((entry) => entry.length);
  }

  /**
   * Defines the specific Harbor instance options.
   *
   * @param {Object} options The options that will be defined for the service.
   */
  defineOptions(options) {
    this.options = Object.assign(
      {
        acceptedEnvironments: [],
      },
      Object.assign(options || {}, {
        acceptedEnvironments: this.defineAcceptedEnvironments(options),
      })
    );
  }

  /**
   * Defines the accepted environment option that blocks the service if the
   * running environment is included within the defined option.
   *
   * @param {Object} options Defines the value from the given options.
   */
  defineAcceptedEnvironments(options) {
    if (!options) {
      return;
    }

    if (!options.acceptedEnvironments) {
      return;
    }

    return Array.isArray(options.acceptedEnvironments)
      ? options.acceptedEnvironments
      : [options.acceptedEnvironments];
  }

  /**
   * Prevents the service execution if the current environment is not included
   * within the acceptedEnvironments Harbor option.
   */
  initIfAccepted() {
    if (!this.options) {
      return true;
    }

    if (!this.options.acceptedEnvironments || !this.options.acceptedEnvironments.length) {
      return true;
    }

    if (this.options.acceptedEnvironments.includes(this.environment.THEME_ENVIRONMENT)) {
      return true;
    }

    return false;
  }
}

module.exports = BaseService;
