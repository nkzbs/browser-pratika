// Esegue background.js dell'estensione (invariato) in un contesto isolato con un `chrome` finto.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

function startBackground(extDir, storage) {
  const listeners = [];
  const noop = { addListener: () => {} };
  const chrome = {
    sidePanel: { setPanelBehavior: () => Promise.resolve() },
    runtime: { onInstalled: noop, onStartup: noop, onMessage: { addListener: f => listeners.push(f) } },
    storage: { local: storage }
  };
  const code = fs.readFileSync(path.join(extDir, 'background.js'), 'utf8');
  vm.runInNewContext(code, { chrome, console });

  return function dispatch(msg, sender) {
    return new Promise(resolve => {
      let answered = false;
      const respond = r => { if (!answered) { answered = true; resolve(r); } };
      let async = false;
      for (const l of listeners) { if (l(msg, sender || {}, respond) === true) async = true; }
      if (!async) respond(undefined);
    });
  };
}

module.exports = { startBackground };
