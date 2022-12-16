// Avoid Browserifying these dependencies
let
  browserify,
  BufferStream,
  exorcist,
  minifyStream;
if (module.require) {
  browserify = require('browserify');
  BufferStream = require('./buffer-stream');
  exorcist = require('exorcist');
  minifyStream = require('minify-stream');
}

module.exports = function bundle(file, options, cb) {
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
    b.pipeline.on('file', (file, id, parent) => {
      console.log('FILE', file, id, JSON.stringify(parent));
    });
  }

  var bundleStream = (minify) ?
    b.plugin('common-shakeify')
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
