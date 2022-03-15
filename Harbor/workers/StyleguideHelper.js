import { outdent } from 'outdent';
import camelcase from 'camelcase';
import fs from 'fs';
import glob from 'glob';
import mkdirp from 'mkdirp';
import path from 'path';

import Worker from './Worker.js';

class StyleguideHelper extends Worker {
  constructor(services) {
    super(services);

    // Keep track of the subscribed titles to prevent duplicate entries.
    this.titles = new Map();

    // Should contain the custom configured alias entries defined from the
    // StyleguideCompiler plugin.
    this.alias = {};
  }

  async init() {
    if (this.services && this.services.ConfigPublisher) {
      this.alias = this.services.ConfigPublisher.getOption('StyleguideCompiler', 'alias');
    }

    await Promise.all(this.entry.map((entry) => this.setupInitialStories(entry)));

    super.resolve();
  }

  /**
   * Creates initial styleguide entry files.
   *
   * @param {String[]} entry Creates the styleguide entry files from the defined
   * entry sources.
   */
  setupInitialStories(entry) {
    return new Promise((done) => {
      if (!entry.length) {
        done();
        return;
      }

      let destinationDirectory = '';
      if (this.config.options && this.config.options.destinationDirectory) {
        destinationDirectory = path.resolve(
          this.environment.THEME_SRC,
          this.config.options.destinationDirectory
        );

        mkdirp.sync(destinationDirectory);

        this.Console.info(`Destination directory created: ${destinationDirectory}`);
      }

      const queue = [];
      entry.forEach((source) => {
        const extname = path.extname(source);
        const story = source.replace(extname, `.stories.${this.config.options.extname}`);

        const template = this.defineInitialTemplate(source);
        let destination = story;

        // Write the entry file to the configured destination directory.
        if (destinationDirectory) {
          const relativeSource = path
            .resolve(source)
            .replace(path.resolve(this.environment.THEME_SRC), '');
          const dirs = relativeSource
            .split(path.sep)
            .filter((s) => s.length && path.basename(source) !== s);

          mkdirp.sync(path.resolve(destinationDirectory, ...dirs));

          destination = path.resolve(destinationDirectory, ...dirs, path.basename(story));
        }

        if (this.config.options && !this.config.options.ignoreInitial) {
          if (fs.existsSync(destination)) {
            this.Console.log(`Skipping existing styleguide story: ${destination}`);
            return;
          }
        }

        queue.push([destination, template]);
      });

      Promise.all(
        queue.map(
          ([destination, template]) =>
            new Promise((callback) => {
              try {
                fs.writeFile(destination, template, (exception) => {
                  if (exception) {
                    this.Console.warning(exception);
                  }

                  this.Console.log(`Styleguide entry template created: ${destination}`);

                  callback();
                });
              } catch (exception) {
                this.Console.warning(exception);
              }
            })
        )
      )
        .catch((exception) => {
          this.Console.error(exception);
          return super.reject();
        })
        .then(() => {
          this.Console.info(
            `Created ${queue.length} initial styleguide entries: ${destinationDirectory}`
          );

          done();
        });
    });
  }

  /**
   * Creates the initial styleguide template from the defined
   *
   * @param {String} source Defines the initial metadata for the styleguide
   * entry.
   * @param {String} destination The destination path for the new styleguide
   * entry file.
   */
  defineInitialTemplate(source) {
    const basename = path.basename(source, path.extname(source));
    const moduleName = camelcase(basename, { pascalCase: true });
    const variantQueue = this.loadVariants(source);

    const template = outdent`
      ${this.useAssets(moduleName, source)}

      export default {
        title: '${this.useTitle(source)}',
        loaders: [
          async ({ args }) => ({
            ${moduleName}: await ${moduleName}(args),
          }),
        ],
      };

      export const ${this.useDefaultModule()} = (args, { loaded }) => loaded.${moduleName};
      ${this.useDefaultModule()}.args = ${moduleName}Configuration;
      ${this.useVariants(moduleName, variantQueue)}
    `;

    return template;
  }

  /**
   * Includes additional module exports from the default module. This is based
   * from the matched modifers.
   *
   * @param {String} moduleName The name of the module that has the actual
   * variants.
   * @param {Object} variants The object with variants that are defined from the
   * variant configuration option.
   */
  useVariants(moduleName, variants) {
    if (!(variants instanceof Object)) {
      return '';
    }

    const queue = {};

    Object.entries(variants).forEach(([option, variant]) => {
      this.Console.log(`Variant found: ${moduleName} - ${option};`);
      const { map, transform } = variant;

      if (!map.length) {
        return;
      }

      map.forEach((v) => {
        const variantName = camelcase(v, { pascalCase: true });
        if (!queue[variantName]) {
          queue[variantName] = {};
        }

        queue[variantName][option] = typeof transform === 'function' ? transform(v) : v;
      });
    });

    const output = [];
    Object.entries(queue).forEach(([variantName, options]) => {
      const variantOptions = JSON.stringify(options);

      output.push(`export const ${variantName} = (args, { loaded }) => loaded.${moduleName};`);
      output.push(outdent`
        ${variantName}.args = {
          ${variantOptions
            .substring(1, variantOptions.length - 1)
            .split('":"')
            .join('" : "')
            .split('","')
            .join('",\n  "')},
          ...${moduleName}Configuration,
        };`);

      output.push('');
    });

    return output.join('\n');
  }

  /**
   * Inserts the required module imports and exports for the current template.
   *
   * @param {String} moduleName The module name that will be used as export.
   * @param {String} source The actual path for the module import.
   */
  useAssets(moduleName, source) {
    const assets = [];

    const configurationExtensions = super.getOption('configurationExtensions', ['yaml', 'json']);
    const includeStylesheets = super.getOption('includeStylesheets', []);
    const includeScripts = super.getOption('includeScripts', []);

    const config = super.flatten(
      configurationExtensions
        .map((extension) => glob.sync(`${path.dirname(source)}/**/*.${extension}`))
        .filter((e) => e && e.length)
    );

    // Include optional stylesheets.
    if (includeStylesheets.length) {
      includeStylesheets.forEach((stylesheet) => {
        assets.push(`import '${this.useAlias(stylesheet)}';`);
      });
      assets.push('');
    }

    // Include optional scripts.
    if (includeScripts.length) {
      includeScripts.forEach((script) => assets.push(`import '${this.useAlias(script)}';`));
      assets.push('');
    }

    // Setup the initial import
    assets.push(`import ${moduleName} from '${this.useAlias(source)}';`);
    assets.push('');

    // Define the default template configuration.
    if (config.length) {
      assets.push(`import ${moduleName}Configuration from '${this.useAlias(config[0], true)}';`);
    } else {
      assets.push(`const ${moduleName}Configuration = {};`);
    }

    return assets.join('\n');
  }

  /**
   * Includes the proposed alias within the new entry template. A relative
   * source will be returned instead of the alias option is disabled.
   *
   * @param {String} source The initial source that will be paired with the
   * alias.
   * @param {Boolean} force Forces the function to use the initial alias.
   */
  useAlias(source, force) {
    if ((!force, this.config.options && this.config.options.disableAlias)) {
      return `./${path.basename(source)}`;
    }

    const proposal = Object.values(this.alias)
      .filter((value) => path.resolve(source).indexOf(value) >= 0)
      .sort((a, b) => {
        const aa = a.split(path.sep);
        const bb = b.split(path.sep);

        return aa[0] - bb[0] || aa[1] - bb[1] || aa[2] - bb[2];
      });

    const approvedAlias = Object.keys(this.alias).filter(
      (name) => this.alias[name] === proposal[proposal.length - 1]
    );

    return path.join(
      approvedAlias[0] || '@theme',
      path.resolve(source).replace(this.alias[approvedAlias], '')
    );
  }

  /**
   * Returns the default name for initial styleguide entry module.
   */
  useDefaultModule() {
    if (this.config.options && this.config.options.defaultModuleName) {
      return this.config.options.defaultModuleName;
    }

    return 'Default';
  }

  /**
   * Defines the styleguide entry Title with optional structure prefixes.
   *
   * @param {String} source Uses the source as entry title for the initial
   * template.
   */
  useTitle(source) {
    const moduleName = camelcase(path.basename(source, path.extname(source)), { pascalCase: true });

    const relativeSource = path
      .resolve(source)
      .replace(path.resolve(this.environment.THEME_SRC), '');

    const dirs = relativeSource
      .split(path.sep)
      .filter((s) => s.length && path.basename(source).indexOf(s))
      .map((s) => camelcase(s, { pascalCase: true }));

    let result = moduleName;
    if (dirs.length && this.config.options && this.config.options.structuredTitle) {
      result = `${dirs.join(this.config.options.sep || ' / ')}${
        this.config.options.sep || ' / '
      }${moduleName}`;
    }

    if (!this.titles.has(result)) {
      this.titles.set(result, 1);
    } else {
      this.titles.set(result, this.titles.get(result) + 1);
      result += `__${String(this.titles.get(result))}`;

      this.Console.warning(
        `Duplicate title encoutered for ${source} a suffix will be added: ${result}`
      );
    }

    return result;
  }

  /**
   * Includes optional template variants that is matched with the variant query.
   * @param {*} source
   */
  loadVariants(source) {
    const variants = super.getOption('variants', {});
    const queue = {};

    // Implements the template modifier variants that are based from the
    // relative stylesheet
    if (variants instanceof Object) {
      Object.entries(variants).forEach(([variant, options]) => {
        const { from, transform, query } = options;

        if (!from || !query) {
          this.Console.log(`Skipping variant: ${variant}`);
          return;
        }

        const externalStylesheet = source.replace(
          path.extname(source),
          `.${from.replace('.', '')}`
        );

        if (fs.existsSync(externalStylesheet)) {
          const data = fs.readFileSync(externalStylesheet).toString();
          if (!data) {
            return;
          }

          const matches = data.matchAll(query);

          queue[variant] = {
            map: [...matches].map(([value]) => value),
            transform,
          };
          queue[variant].map = queue[variant].map
            .filter((v, i) => queue[variant].map.indexOf(v) === i)
            .map((v) => v.split(' ').join(''));
        }
      });
    }

    return queue;
  }
}

export default StyleguideHelper;
