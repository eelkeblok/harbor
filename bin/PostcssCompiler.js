const { statSync, readFileSync, writeFileSync } = require('fs');
const { sync } = require('glob');
const { dirname, join } = require('path');
const mkdirp = require('mkdirp');
const { load } = require('module-config-loader');
const postcss = require('postcss');
const Logger = require('./common/Logger');

class PostcssCompiler {
  init(config) {
    return new Promise(cb => {
      this.config = config;

      this.cwd = {
        main: sync(`${this.config.THEME_SRC}/main/stylesheets/*.css`),
        modules: sync(`${this.config.THEME_SRC}/modules/*/*/*.css`),
      };

      const baseDirectories = Object.keys(this.cwd);

      this.postcssConfig = load('postcss.config.js');

      let queue = 0;

      baseDirectories.forEach(async directory => {
        const cwd = this.cwd[directory];

        if (cwd.length === 0) {
          Logger.warning(`Cannot find any stylesheet witin ${join(this.config.THEME_SRC, directory)}`);
        } else {
          Logger.info(`Compiling stylesheets within: ${join(this.config.THEME_SRC, directory)}`);
          await this.processCwd(directory);
        }

        queue += 1;

        if (queue >= baseDirectories.length) {
          cb();

          // Only ouput a success message if any files have been processed.
          if (cwd.length > 0) {
            Logger.success(`Done compiling within ${join(this.config.THEME_SRC, directory)}`);
          }
        }
      });
    });
  }

  /**
   * Process all stylesheets within the defined baseDirectory asynchronously.
   *
   * @param {String} directory Key name of the defined cwd Array.
   */
  processCwd(directory) {
    return new Promise(cb => {
      const cwd = this.cwd[directory];

      // Keep track of the actual processing queue.
      let queue = 0;

      cwd.forEach(async entry => {
        if (!statSync(entry).size) {
          Logger.warning(`Skipping empty file: ${entry}`);
          queue += 1;
        } else {
          await this.processFile(entry);
          queue += 1;
        }

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
    return new Promise(cb => {
      const destination = entry.replace(this.config.THEME_SRC, this.config.THEME_DIST);
      const source = readFileSync(entry);

      Logger.info(`Compiling: ${entry}`);

      postcss(this.postcssConfig.plugins)
        .process(source, {
          from: entry,
        })
        .then(result => {
          result.warnings().forEach(warning => {
            Logger.warning(warning.toString());
          });

          mkdirp(dirname(destination), async error => {
            if (error) {
              Logger.error(error);
            }

            // Write the actual css to the filesystem.
            await writeFileSync(destination, result.css);

            Logger.success(`Successfully compiled: ${destination}`);

            cb();
          });
        });
    });
  }
}

module.exports = PostcssCompiler;
