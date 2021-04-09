const { readFileSync, statSync, writeFileSync } = require('fs');
const { sync } = require('glob');
const mkdirp = require('mkdirp');
const { load } = require('module-config-loader');
const { dirname } = require('path');
const postcss = require('postcss');

class PostCssCompiler {
  constructor() {
    super();

    this.styleLintError = false;
  }

  init(environment) {
    return new Promise((cb) => {
      this.environment = environment;

      if (!this.config.entry instanceof Object) {
        cb();
      }

      let queue = 0;

      const baseDirectories = Object.keys(this.config.entry);
      baseDirectories.forEach(async (name) => {
        const cwd = sync(join(this.environment.THEME_SRC, this.config.entry[name]));

        if (cwd.length > 0) {
          await this.processCwd(cwd);
        }

        queue += 1;

        if (queue >= baseDirectories.length) {
          cb();
        }
      });
    });
  }

  /**
   * Process all stylesheets within the defined cwd asynchronously.
   *
   * @param {Array} cwd The actual array to process.
   */
  processCwd(cwd) {
    return new Promise((cb) => {
      // Keep track of the actual processing queue.
      let queue = 0;

      cwd.forEach(async (entry) => {
        if (!statSync(entry).size) {
          this.Console.warning(`Skipping empty file: ${entry}`);
        } else {
          await this.processFile(entry);
        }

        queue += 1;

        /**
         * Only return the Promise Callback after each entry file has been
         * processed.
         */
        if (queue >= cwd.length) {
          cb();
        }
      });
    });
  }

  /**
   * Process the defined stylesheet asynchronously.
   *
   * @param {String} entry The sourcepath of the actual stylesheet.
   */
  processFile(entry) {
    return new Promise((cb) => {
      const destination = entry.replace(this.environment.THEME_SRC, this.environment.THEME_DIST);
      const source = readFileSync(entry);

      this.Console.info(`Compiling: ${entry}`);

      postcss(this.config.options.plugins)
        .process(source, {
          from: entry,
        })
        .then((result) => {
          result.warnings().forEach((warning) => {
            this.Console.warning(warning.toString());
          });

          mkdirp(dirname(destination)).then((dirPath, error) => {
            if (error) {
              this.Console.error(error);
            } else {
              // Write the actual css to the filesystem.
              writeFileSync(destination, result.css);

              this.Console.success(`Done compiling: ${destination}`);
            }

            cb();
          });
        });
    });
  }
}

module.exports = PostCssCompiler;
