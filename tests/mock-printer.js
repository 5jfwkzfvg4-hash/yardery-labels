// Simulated Zebra ZD411 over Web Bluetooth, injected into the page before it loads.
// Options:
//   name, setup        pre-fill this device's saved first name / "has connected before"
//   bluetooth=false    browser with no Bluetooth (iPad Safari, desktop Firefox)
//   getDevices         browser can remember a printer between visits
//   remembered         "ok" | "hang"  how the remembered printer answers a background connect
//   picked             "ok" | "hang"  how the printer picked from the list answers
//   cancelFirstPick    the first time the list opens, the person closes it
//   busy               the remembered printer ignores this many connects first (another device is printing)
// Records into window.__bt: log (picker/connect/disconnect), reqs (list filters), zpl (everything printed).
module.exports = function mockPrinter(o = {}) {
  return `(() => {
  const O = ${JSON.stringify(o)};
  if (window.top !== window) return;               // only the label page talks to the printer
  try {
    if (O.name) localStorage.setItem('ypl:name', JSON.stringify(O.name));
    if (O.setup) { localStorage.setItem('ypl:printerSetup', 'true'); localStorage.setItem('ypl:printerName', JSON.stringify('DFJ235305204')); }
  } catch (e) {}
  const bt = window.__bt = { log: [], reqs: [], zpl: '' };
  if (O.bluetooth === false) return;
  const ch = {
    writeValueWithResponse: async v => { bt.zpl += new TextDecoder().decode(v); },
    writeValueWithoutResponse: async v => { bt.zpl += new TextDecoder().decode(v); }
  };
  let busy = 0;
  const make = (tag, how) => {
    const listeners = [];
    const gatt = {
      connected: false,
      connect: async () => {
        bt.log.push('connect:' + tag);
        if (how === 'hang' || (tag === 'remembered' && O.busy && busy++ < O.busy)) return new Promise(() => {});
        gatt.connected = true;
        return { getPrimaryService: async () => ({ getCharacteristic: async () => ch }) };
      },
      disconnect() { bt.log.push('disconnect'); gatt.connected = false; listeners.forEach(f => f()); }
    };
    return { name: 'DFJ235305204', gatt, addEventListener(t, f) { if (t === 'gattserverdisconnected') listeners.push(f); } };
  };
  const remembered = make('remembered', O.remembered || 'ok');
  const picked = make('picked', O.picked || 'ok');
  let picks = 0;
  const api = {
    requestDevice: async opts => {
      bt.log.push('picker'); bt.reqs.push(opts);
      if (O.cancelFirstPick && picks++ === 0) { const e = new Error('User cancelled the requestDevice() chooser.'); e.name = 'NotFoundError'; throw e; }
      return picked;
    }
  };
  if (O.getDevices) api.getDevices = async () => [remembered];
  Object.defineProperty(navigator, 'bluetooth', { value: api });
})()`;
};
