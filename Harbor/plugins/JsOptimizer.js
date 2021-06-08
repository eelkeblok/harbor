import fs from 'fs';
import { minify } from 'uglify-js';

import Plugin from './Plugin.js';

/**
 * Minifies the defined js entries within the THEME_DIST directory
 */
export default class JsOptimizer extends Plugin {
  constructor(services, options) {
    super(services, options);
  }

  /**
   * The initial handler that will be called by the Harbor TaskManager.
   */
  async init() {
    if (!this.entry || !this.entry.length) {
      return super.resolve();
    }

    await Promise.all(
      this.entry.map((name) => new Promise((cb) => this.optimizeCwd(name).then(cb)))
    );

    super.resolve();
  }

  /**
   * Optimizes the sources from the defined entry glob.
   */
  async optimizeCwd(cwd) {
    await Promise.all(
      cwd.map(
        (path) =>
          new Promise((done) => {
            this.Console.log(`Optimizing: ${path}`);

            fs.readFile(path, (exception, data) => {
              if (exception) {
                this.Console.error(exception);
              }

              if (!data) {
                return super.resolve();
              }

              const result = minify(data.toString(), this.config.options || {});

              if (!result.code || result.error) {
                if (result.error) {
                  this.Console.error(`Minify exception encountered for ${path}: ${result.error}`);
                  this.Console.info(`The original state for ${path} will be used instead.`);
                }
              }

              this.write(path, result.error ? data.toString() : result.code)
                .then(done)
                .catch((exception) => {
                  this.Console.error(exception);

                  super.reject();
                });
            });
          })
      )
    );
  }

  /**
   * Writes the optimized file to the filesystem.
   */
  write(path, blob) {
    if (!path) {
      this.Console.error(`Unable to optimize script, no path has been defined.`);

      return super.reject();
    }

    if (!blob) {
      this.Console.error(`Unable to optimize script, no data has been defined for ${path}.`);

      return super.reject();
    }

    return new Promise((cb) => {
      fs.writeFile(path, blob, () => {
        this.Console.log(`File optimized: ${path}`);

        cb();
      });
    });
  }
}
