// Avoid Browserifying these dependencies
let
  browserify,
  BufferStream,
  crypto,
  exorcist,
  fs,
  minifyStream,
  path,
  through;
if (module.require) {
  browserify = require('browserify');
  BufferStream = require('./lib/buffer-stream');
  crypto = require('crypto');
  exorcist = require('exorcist');
  fs = module.require('fs');
  minifyStream = require('minify-stream');
  path = require('path');
  through = require('through');
}


module.exports = function derbyBundler(app, options) {
  if (process.title === 'browser') {
    // not in server
    return;
  }
  const { derby } = app;
  const { App, util } = derby;

  const Backend = derby.Backend || derby.Store;

  Backend.prototype.bundle = function(file, options, cb) {
    if (typeof options === 'function') {
      cb = options;
      options = null;
    }
    options = Object.assign({}, options, {debug: true});
    var minify = (options.minify == null) ? util.isProduction : options.minify;
  
    var b = browserify(options);
    this.emit('bundle', b);
    b.add(file);
    if (process.env.BUNDLE_DEBUG) {
      b.on('file', (...args) => { console.log('FILE', ...args) });
    }

    var bundleStream = (minify) ?
      b.plugin('common-shakeify')
        .plugin('browser-pack-flat/plugin')
        .bundle()
        .pipe(minifyStream()) :
      b.bundle();

    var sourceStream = new BufferStream();
    var sourceMapStream = new BufferStream();
    bundleStream
      .pipe(exorcist(sourceMapStream, '/'))
      .pipe(sourceStream);

    sourceStream.on('finish', function() {
      var source = sourceStream.toString()
        // Remove the sourceMappingURL inserted by exorcist
        .replace(/\n\/\/# sourceMappingURL=.*/, '');
      var sourceMap = sourceMapStream.toString();
      cb(null, source, sourceMap);
    });
  }

  App.prototype.bundle = function(backend, options, cb) {
    const app = this;
    if (typeof options === 'function') {
      cb = options;
      options = null;
    }
    if (!options) {
      options = {};
    }
    if (options.minify == null) options.minify = util.isProduction;
    // Turn all of the app's currently registered views into a javascript
    // function that can recreate them in the client
    const viewsSource = this._viewsSource(options);
    const bundleFiles = [];
    backend.once('bundle', function(bundle) {
      const derbyPath = require.resolve('derby', { paths: [app.filename] });
      bundle.require(derbyPath, {expose: 'derby'});
      // Hack to inject the views script into the Browserify bundle by replacing
      // the empty _views.js file with the generated source
      const viewsFilename = require.resolve('./_views');
      bundle.transform(function(filename) {
        if (filename !== viewsFilename) return through();
        return through(
          function write() {},
          function end() {
            this.queue(viewsSource);
            this.queue(null);
          }
        );
      }, {global: true});
      bundle.on('file', function(filename) {
        bundleFiles.push(filename);
      });
      app.emit('bundle', bundle);
    });
    backend.bundle(app.filename, options, function(err, source, map) {
      if (err) return cb(err);
      app.scriptHash = crypto.createHash('md5').update(source).digest('hex');
      source = source.replace('{{DERBY_SCRIPT_HASH}}', app.scriptHash);
      source = source.replace(/['"]{{DERBY_BUNDLED_AT}}['"]/, Date.now());
      if (app.watchFiles) {
        app._autoRefresh(backend);
        app._watchBundle(bundleFiles);
      }
      cb(null, source, map);
    });
  };

  App.prototype.writeScripts = function(backend, dir, options, cb) {
    const app = this;
    this.bundle(backend, options, function(err, source, map) {
      if (err) return cb(err);
      dir = path.join(dir, 'derby');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir);
      const filename = app.name + '-' + app.scriptHash;
      const base = path.join(dir, filename);
      app.scriptUrl = app.scriptBaseUrl + '/derby/' + filename + '.js';

      // Write current map and bundle files
      if (!(options && options.disableScriptMap)) {
        app.scriptMapUrl = app.scriptMapBaseUrl +  '/derby/' + filename + '.map.json';
        source += '\n//# sourceMappingURL=' + app.scriptMapUrl;
        app.scriptMapFilename = base + '.map.json';
        fs.writeFileSync(app.scriptMapFilename, map, 'utf8');
      }
      app.scriptFilename = base + '.js';
      fs.writeFileSync(app.scriptFilename, source, 'utf8');

      // Delete app bundles with same name in development so files don't
      // accumulate. Don't do this automatically in production, since there could
      // be race conditions with multiple processes intentionally running
      // different versions of the app in parallel out of the same directory,
      // such as during a rolling restart.
      if (app.watchFiles) {
        const appPrefix = app.name + '-';
        const currentBundlePrefix = appPrefix + app.scriptHash;
        const filenames = fs.readdirSync(dir);
        for (let i = 0; i < filenames.length; i++) {
          const filename = filenames[i];
          if (filename.indexOf(appPrefix) !== 0) {
            // Not a bundle for this app, skip.
            continue;
          }
          if (filename.indexOf(currentBundlePrefix) === 0) {
            // Current (newly written) bundle for this app, skip.
            continue;
          }
          // Older bundle for this app, clean it up.
          const oldFilename = path.join(dir, filename);
          fs.unlinkSync(oldFilename);
        }
      }
      if (cb) {
        cb();
      }
    });
  };

  app.on('htmlDone', page => {
    let bundleScriptTag = `<script async data-derby-app src="${page.app.scriptUrl}"`;
    if (page.app.scriptCrossOrigin) {
      // Scripts loaded from a different origin (such as a CDN) won't report
      // much information to the host page's window.onerror. Adding the
      // "crossorigin" attribute to the script tag allows reporting of detailed
      // error info to the host page.
      // HOWEVER - if the "crossorigin" attribute is present for a script tag
      // with a cross-origin "src", then the script's HTTP response MUST have
      // an appropriate "Access-Control-Allow-Origin" header set. Otherwise,
      // the browser will refuse to load the script.
      bundleScriptTag += ' crossorigin';
    }
    bundleScriptTag += '></script>';
    page.res.write(bundleScriptTag);
  });
}
