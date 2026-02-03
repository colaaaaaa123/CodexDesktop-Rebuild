// Process polyfill for path-browserify compatibility
(function() {
  // 从 navigator 推断平台
  function detectPlatform() {
    var ua = navigator.userAgent.toLowerCase();
    if (ua.indexOf('win') !== -1) return 'win32';
    if (ua.indexOf('mac') !== -1) return 'darwin';
    if (ua.indexOf('linux') !== -1) return 'linux';
    return 'browser';
  }

  window.process = window.process || {
    cwd: function() { return '/'; },
    env: {},
    platform: detectPlatform(),
    version: '',
    nextTick: function(fn) { setTimeout(fn, 0); }
  };
})();
