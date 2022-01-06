import { exec } from 'child_process';
import { fileURLToPath } from 'url';
import fs from 'fs';
import glob from 'glob';
import mkdirp from 'mkdirp';
import outdent from 'outdent';
import path from 'path';
import { snakeCase } from 'snake-case';

import Plugin from './Plugin.js';

/**
 * Create a new Styleguide with the compiled assets from the destination
 * directory.
 */
class StyleguideCompiler extends Plugin {
  constructor(services, options, workers) {
    super(services, options, workers);

    // @TODO can be removed since we can dynamically define this.
    // Contains the value storage for the template variables.
    this.renderContext = {};
  }

  /**
   * The initial handler that will be called by the Harbor TaskManager.
   */
  async init() {
    const bin =
      this.environment.THEME_ENVIRONMENT === 'production' ? 'build-storybook' : 'start-storybook';

    const script = fs.existsSync(path.resolve(`node_modules/.bin/${bin}`))
      ? path.resolve(`node_modules/.bin/${bin}`)
      : path.resolve(`../../.bin/${bin}`);

    const config = path.resolve(StyleguideCompiler.configPath());
    const { staticDirectory } = this.config.options;

    // Define the Storybook builder configuration as CommonJS module since Storybook
    // currently doesn't support the implementation of ESM.
    this.setupBuilder();

    // Define the Storybook configuration as CommonJS module since Storybook
    // currently doesn't support the implementation of ESM.
    this.setupMain(config);

    // Extends the Storybook instance with the optional custom configuration.
    if (this.config.options.configDirectory) {
      const customConfigurations = glob
        .sync(path.join(this.config.options.configDirectory, '/**'))
        .filter(
          (configuration) =>
            [
              path.basename(this.config.options.configDirectory),
              'index.ejs',
              'main.js',
              'main.cjs',
            ].includes(path.basename(configuration)) === false
        );

      if (customConfigurations.length) {
        this.Console.info(
          `Using storybook configuration from: ${this.config.options.configDirectory}`
        );

        customConfigurations.forEach((configuration) => {
          this.Console.log(`Extending configuration: ${configuration}`);

          const destination = path.join(
            StyleguideCompiler.configPath(),
            path.basename(configuration)
          );

          if (destination !== configuration) {
            if (fs.existsSync(destination)) {
              fs.unlinkSync(destination);
            }

            if (fs.existsSync(configuration)) {
              fs.copyFileSync(configuration, destination);
            }
          }
        });
      }
    }

    let command;

    if (this.environment.THEME_ENVIRONMENT === 'production') {
      const staticBuildPath = path.join(this.environment.THEME_DIST, staticDirectory);

      const previousBuild = glob.sync(`${staticBuildPath}/**/*`);

      if (previousBuild.length === 0) {
        this.Console.info(`Clearing previous styleguide build...`);
        previousBuild.forEach((file) => fs.unlinkSync(file));
      }
      command = `node ${script} -c ${config} -o ${staticBuildPath}`;
    } else {
      command = `node ${script} -c ${config} -p ${this.environment.THEME_PORT}`;
    }

    const shell = exec(command);

    shell.stdout.on('data', (data) => {
      process.stdout.write(data);
    });

    shell.stderr.on('data', (data) => {
      process.stdout.write(data);
    });

    shell.on('error', (data) => {
      process.stdout.write(data);

      if (this.environment.THEME_ENVIRONMENT === 'production') {
        super.reject();
      }
    });

    shell.on('exit', () => {
      // Ensure the processed assets are available for the static build.
      if (this.environment.THEME_ENVIRONMENT === 'production') {
        this.synchronizeAssets().then(() => {
          super.resolve();
        });
      } else {
        super.resolve();
      }
    });
  }

  /**
   * Prepares the configuration for the Styleguide loader that should render the
   * defined Twig templates.
   */
  setupBuilder() {
    const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../builders/Twing');

    const destination = path.resolve(StyleguideCompiler.configPath(), 'twing.cjs');

    const queryEntry = (entry, query) => glob.sync(path.join(entry, query));

    const initialFilters = ['_date', '_escape'];
    const defaultFilters = queryEntry(cwd, 'filters/**.cjs').filter(
      (m) => !initialFilters.includes(path.basename(m, '.cjs'))
    );

    const customFilters = this.config.options.builderDirectory
      ? queryEntry(this.config.options.builderDirectory, 'filters/**.cjs')
      : [];

    const initialFunctions = ['dump'];
    const defaultFunctions = queryEntry(cwd, 'functions/**.cjs').filter(
      (m) => !initialFunctions.includes(path.basename(m, '.cjs'))
    );

    const customFunctions = this.config.options.builderDirectory
      ? queryEntry(this.config.options.builderDirectory, 'functions/**.cjs')
      : [];

    const definedFilters = this.extendBuilder(defaultFilters, customFilters);
    const definedFunctions = this.extendBuilder(defaultFunctions, customFunctions);

    const template = outdent`
      const path = require('path');
      const { TwingEnvironment, TwingLoaderFilesystem, TwingFilter, TwingFunction } = require('twing');

      // Should contain the default & custom Twing filters to extend.
      const filters = {};
      ${definedFilters
        .map(
          (definedFilter) => outdent`
            try {
              filters['${StyleguideCompiler.defineBuilderExtensionName(
                definedFilter
              )}'] = require('${definedFilter}');
            } catch (exception) {
              throw Error(exception);
            }`
        )
        .join('\n\n')}

      // Should contain the default & custom Twing functions to extend.
      const functions = {};
      ${definedFunctions
        .map(
          (definedFunction) => outdent`
            try {
              functions['${StyleguideCompiler.defineBuilderExtensionName(
                definedFunction
              )}'] = require('${definedFunction}');
            } catch (exception) {
              throw Error(exception);
            }`
        )
        .join('\n\n')}

      // Defines the absolute path to the theme specific packages.
      const theme = path.resolve('${process.cwd()}');

      // Use the resolved paths as base path for the Twing Filesystem.
      const loader = new TwingLoaderFilesystem([theme]);

      // In storybook we get this returned as an instance of
      // TWigLoaderNull, we need to avoid processing this.
      // Use namespace to maintain the exact include paths for both Drupal and
      // Storybook.
      if (typeof loader.addPath === 'function') {
        if (${this.config.options.alias !== undefined}) {
          try {
            const alias = ${JSON.stringify(this.config.options.alias)};

            if (alias) {
              Object.keys(alias).forEach((name) => {
                loader.addPath(path.resolve(process.cwd(), alias[name]), name.replace('@', ''));
              });
            }
          } catch (exception) {
            throw new Error(exception);
          }
        }
      }

      const environment = new TwingEnvironment(loader, { autoescape: false });

      if (Object.keys(filters).length) {
        Object.keys(filters).forEach((filter) => {
          try {
            environment.addFilter(new TwingFilter(filter, filters[filter]));
          } catch(error) {
            console.error(error);
          }
        });
      }

      if (Object.keys(functions).length) {
        Object.keys(functions).forEach((fn) => {
          try {
            const handler = (typeof functions[fn] === 'function') ? functions[fn] : (...args) => args;

            environment.addFunction(new TwingFunction(fn, handler));
          } catch(error) {
            console.error(error);
          }
        });
      }

      module.exports = environment;
    `;

    if (fs.existsSync(destination)) {
      fs.unlinkSync(destination);
    }

    mkdirp.sync(path.dirname(destination));

    fs.writeFileSync(destination, template);
  }

  /**
   * Defines the actual entry list from the given custom & default entries.
   *
   * @param {*} initial The default builder extensions that will be loaded.
   * @param {*} proposal The custom builder extensions where the non-exsiting
   * entry is merged.
   *
   * @returns {array} The entries to extend within the Builder instance.
   */
  extendBuilder(initial, proposal) {
    return [
      ...initial,
      ...proposal.filter((commit) => {
        const name = StyleguideCompiler.defineBuilderExtensionName(commit);

        if (
          !initial
            .map((initialItem) => StyleguideCompiler.defineBuilderExtensionName(initialItem))
            .includes(name)
        ) {
          return commit;
        }

        this.Console.warning(`Custom builder function '${name}' already exists.`);
        this.Console.warning(
          `Using ${
            initial.filter(
              (initialExtension) =>
                name === StyleguideCompiler.defineBuilderExtensionName(initialExtension)
            )[0]
          } instead of: ${commit}`
        );

        return null;
      }),
    ];
  }

  /**
   * Defines the actual name for the given Builder extension.
   *
   * @param {string} source Defines the name from the given source.
   */
  static defineBuilderExtensionName(source) {
    return snakeCase(path.basename(source, path.extname(source)));
  }

  /**
   * Creates the Twing Data Object that can be used within the templates.
   *
   * @param {string} name
   * @param {string} sourcePath
   * @param {boolean} initial
   * @returns
   */
  async setupDataEntry(name, sourcePath, context) {
    return new Promise((cb) => {
      if (!this.renderContext[name]) {
        this.renderContext[name] = {};
      }

      if (context) {
        if (!this.renderContext[name]['_context'] instanceof Object) {
          this.renderContext[name]['_context'] = {};
        }
      }

      if (['.js', '.cjs'].includes(path.extname(sourcePath))) {
        try {
          import(sourcePath).then((m) => {
            if (m && m.default) {
              this.Console.info(`Loading data for: ${name} from ${sourcePath}`);
              this.renderContext[name] = Object.assign(this.renderContext[name], m.default);

              if (this.config.options.globalMode) {
                Object.keys(m.default).forEach((option) => {
                  // @todo Validate sensitivity of errors for this option.
                  if (this.config.options.globalMode !== 'strict') {
                    this.renderContext[option] = `%${option}%`;
                  } else if (!this.renderContext[option]) {
                    this.renderContext[option] = `%${option}%`;
                  }
                });
              }

              return cb();
            }
          });
        } catch (exception) {
          this.Console.warning(exception);
        }
      } else {
        fs.readFile(sourcePath, (exception, result) => {
          try {
            const proposal = JSON.parse(result.toString());

            if (proposal) {
              this.renderContext[name] = Object.assign(this.renderContext[name], proposal);

              if (this.config.options.globalMode) {
                Object.keys(proposal).forEach((option) => {
                  // @todo Validate sensitivity of errors for this option.
                  if (this.config.options.globalMode !== 'strict') {
                    this.renderContext[option] = `%${option}%`;
                  } else if (!this.renderContext[option]) {
                    this.renderContext[option] = `%${option}%`;
                  }
                });
              }
            }
          } catch (exception) {
            this.Console.warning(exception);
          }

          return cb();
        });
      }
    });
  }

  /**
   * Generates the Storybook configuration with the defined Harbor configuration.
   * This ensures that the actual storybook instance is loaded as a CommonJS
   * module.
   */
  async setupMain(cwd) {
    if (!(this.config.entry instanceof Object)) {
      return;
    }

    // Lookup any stories within the defined THEME_SRC environment variable.
    // eslint-disable-next-line prefer-spread
    const stories = [].concat.apply(
      [],
      Object.values(this.config.entry).map((entry) =>
        glob.sync(path.join(this.environment.THEME_SRC, entry)).map((e) => path.resolve(e))
      )
    );

    let addons =
      this.config.options && this.config.options.addons ? this.config.options.addons || [] : [];

    // Restricts the following addons since they are included by the core
    // Storybook package.
    const restricedAddons = [
      '@storybook/addon-actions',
      '@storybook/addon-controls',
      '@storybook/addon-viewport',
    ];

    addons = addons.filter((addon) => !restricedAddons.includes(addon));

    const previewMainTemplate = path.resolve(cwd, 'index.ejs');
    const environmentModulePath = path.resolve(StyleguideCompiler.configPath(), 'twing.cjs');

    // Implements the render Context for each storybook story.
    if (stories.length) {
      await Promise.all(
        stories.map(
          (story) =>
            new Promise(async (cc) => {
              const dirname = path.dirname(story);
              let name = path.basename(story);
              name = name.substring(0, name.indexOf('.'));
              const sources = [
                ...glob.sync(path.join(dirname, `**/${name}.data.js`)),
                ...glob.sync(path.join(dirname, `**/${name}.data.json`)),
              ];

              if (!sources.length) {
                cc();
              }

              await Promise.all(
                sources.map((sourcePath, index) => this.setupDataEntry(name, sourcePath, index > 0))
              );

              cc();
            })
        )
      );
    }

    const template = outdent`
      const fs = require('fs');
      const glob = require('glob');
      const path = require('path');
      const webpack = require('webpack');
      const YAML = require('yaml');

      const addons = [${addons.map((p) => `'${p}'`).join(',')}]
      const stories = [${stories.map((p) => `'${p}'`).join(',')}]

      // Include the Drupal library context within the Storybook instance that
      // can be used for the Drupal related Twig extensions.
      const libraryPaths = [${glob
        .sync('*.libraries.yml')
        .map((p) => `'${p}'`)
        .join(',')}];
      const libraries = {};
      if (libraryPaths.length) {
        libraryPaths.forEach((l) => {
          const c = fs.readFileSync(l).toString();
          console.log('Reading library: ' + l);

          if (c && c.length) {
            try {
              libraries[path.basename(l)] = YAML.parse(c);
            } catch (exception) {
              console.log(exception);
            }
          }
        });
      }

      // Enable the sprite paths within the Styleguide as global context.
      const sprites = {};
      const enableSprites = ${!!(
        this.workers &&
        this.workers.SvgSpriteCompiler &&
        this.workers.SvgSpriteCompiler.config.entry
      )};
      if (enableSprites) {
        try {
          const entry = ${JSON.stringify(this.workers.SvgSpriteCompiler.config.entry)};

          Object.keys(entry).forEach((n) => {
            let p = path.normalize(path.dirname(entry[n])).replace('*', '');
            p = path.join('${this.environment.THEME_DIST}', p, n + '.svg');

            if (fs.existsSync(path.resolve(p))) {
              sprites[n] = p;
            }

          });
        } catch (exception) {
          console.log('Unable to expose compiled inline SVG sprites:' + exception);
        }
      }

      const webpackFinal = (config) => {
        // Include the Twig loader to enable support from Drupal templates.
        config.module.rules.push({
          test: /\.twig$/,
          loader: 'twing-loader',
          options: {
            environmentModulePath: '${environmentModulePath}',
          },
        });

        config.plugins.forEach((plugin, i) => {
          if (plugin.constructor.name === 'ProgressPlugin') {
            config.plugins.splice(i, 1);
          }
        });

        // Use the defined styleguide alias that should match with the template
        // alias.
        if (config.resolve && config.resolve.alias) {
          config.resolve.alias = Object.assign(${JSON.stringify(
            this.config.options.alias
          )}, config.resolve.alias);
        }

        // @TODO should be removed, is replaced by enforced process env overrides.
        config.plugins.push(
          new webpack.DefinePlugin({
            THEME_LIBRARIES: JSON.stringify(libraries),
            THEME_DIST: '"${path.normalize(this.environment.THEME_DIST)}/"',
            THEME_ENVIRONMENT: '"${this.environment.THEME_ENVIRONMENT}"',
            THEME_SPRITES: JSON.stringify(sprites),
            THEME_ALIAS: JSON.stringify(${JSON.stringify(this.config.options.alias)}),
            THEME_WEBSOCKET_PORT: '${this.environment.THEME_WEBSOCKET_PORT}',
          })
        );

        config.mode = ${
          this.environment.THEME_ENVIRONMENT !== 'development' ? '"production"' : 'config.mode'
        };

        config.optimization = ${
          this.environment.THEME_ENVIRONMENT !== 'development'
            ? JSON.stringify(this.config.options.optimization || {})
            : 'config.optimization || false'
        };

        process.env['THEME_ALIAS'] = JSON.stringify(${JSON.stringify(this.config.options.alias)});

        return config;
      }

      // Enforce the Harbor environment within the Webpack instance.
      // DefinePlugin does not give the desired result withing the Twing Builder.
      process.env.THEME_LIBRARIES = JSON.stringify(libraries);
      process.env.THEME_DIST = '"${path.normalize(this.environment.THEME_DIST)}/"';
      process.env.THEME_ENVIRONMENT = '"${this.environment.THEME_ENVIRONMENT}"';
      process.env.THEME_SPRITES = JSON.stringify(sprites);
      process.env.THEME_ALIAS = JSON.stringify(${JSON.stringify(this.config.options.alias)});
      process.env.THEME_WEBSOCKET_PORT = '${this.environment.THEME_WEBSOCKET_PORT}';

      module.exports = {
        stories,
        addons,
        staticDirs: [${
          this.environment.THEME_ENVIRONMENT !== 'production' && '"' + process.cwd() + '"'
        }],
        webpackFinal,
        previewMainTemplate: '${previewMainTemplate}',
      }
    `;

    const mainPath = path.resolve(StyleguideCompiler.configPath(), 'main.cjs');

    if (fs.existsSync(mainPath)) {
      fs.unlinkSync(mainPath);
    }

    mkdirp.sync(path.dirname(mainPath));
    fs.writeFileSync(mainPath, template);
  }

  /**
   * Synchronizes the processed assets to the static stylguide directory.
   */
  async synchronizeAssets() {
    const { staticDirectory } = this.config.options;
    const staticBuildPath = path.join(this.environment.THEME_DIST, staticDirectory);

    // Ensure the processed assets are also available for the static build.
    const assets = glob
      .sync(`${this.environment.THEME_DIST}/**/*`)
      .filter((asset) => asset.indexOf(staticBuildPath) < 0);

    await Promise.all(
      assets.map(
        (asset) =>
          new Promise((done) => {
            const alias = path.resolve(staticBuildPath, asset);

            mkdirp(path.dirname(alias)).then(() =>
              fs.copyFile(asset, alias, () => {
                this.Console.log(`Sycnronized static asset: ${alias}`);

                done();
              })
            );
          })
      )
    ).then(() => {
      this.Console.log(`Synchronized ${assets.length} static styleguide assets.`);
    });
  }

  /**
   * Returns the path of the styleguide configuration directory.
   */
  static configPath() {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.storybook');
  }
}

export default StyleguideCompiler;
