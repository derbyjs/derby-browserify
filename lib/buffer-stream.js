const { Writable } = require('stream');

module.exports = BufferStream;

function BufferStream() {
  Writable.call(this);
  this.chunks = [];
}

BufferStream.prototype = Object.create(Writable.prototype);

BufferStream.prototype.constructor = BufferStream;

BufferStream.prototype._write = function(chunk, encoding, callback) {
  this.chunks.push(chunk);
  callback();
};

BufferStream.prototype.toString = function() {
  return Buffer.concat(this.chunks).toString();
};
