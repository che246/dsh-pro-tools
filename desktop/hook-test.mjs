#!/usr/bin/env node
/**
 * Exercise `desktop/tray-hook.js` against stub Electron objects.
 *
 * The hook is injected into the desktop shell's main process, so this harness is
 * the only way to test it without restarting the application: it evaluates the
 * same source, feeds it a temporary `DH_HOME` state file, and inspects the menu
 * the hook hands to `Tray.setContextMenu`.
 *
 * @module dsh-pro-tools/desktop/hook-test
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const hookPath = join(here, 'tray-hook.js');
const home = mkdtempSync(join(process.env.TEMP ?? process.env.TMP ?? homedir(), 'pro-tools-hook-'));
process.env.DSH_HOME = home;

const stateFile = join(home, 'pro-tools', 'tray.json');
mkdirSync(join(home, 'pro-tools'), { recursive: true });

const calls = [];
const app = {
  relaunch: () => calls.push('relaunch'),
  quit: () => calls.push('quit'),
  once: () => {},
};
const shell = {
  openPath: (path) => calls.push(`openPath:${path}`),
  openExternal: (url) => calls.push(`openUrl:${url}`),
};
const Menu = { buildFromTemplate: (items) => ({ items }) };
let language = 'zh';
const messages = { openApplication: '打开', quitApplication: '退出' };
const currentDesktopLocale = () => ({
  id: language === 'zh' ? 'zh-CN' : 'en',
  messages: language === 'zh' ? messages : { openApplication: 'Open', quitApplication: 'Quit' },
});
const focusPrimaryWindow = () => calls.push('focus');
const quitWithoutConfirmation = () => calls.push('quitNow');
let tick;
const fakeSetInterval = (fn) => {
  tick = fn;
  return { unref() {} };
};

const source = readFileSync(hookPath, 'utf8');
const factory = new Function(
  'join', 'readFileSync', 'homedir', 'Menu', 'app', 'shell', 'setInterval',
  'currentDesktopLocale', 'focusPrimaryWindow', 'quitWithoutConfirmation', 'tray', 'console',
  `${source}\nreturn dshProToolsTray;`,
);
const hook = factory(
  join, readFileSync, homedir, Menu, app, shell, fakeSetInterval,
  currentDesktopLocale, focusPrimaryWindow, quitWithoutConfirmation, undefined, console,
);

const menuTray = {
  current: undefined,
  tray: { setContextMenu: (menu) => { menuTray.current = menu; } },
  relabel() {
    // Stand-in for DesktopTray.relabel: rebuild the stock menu from the shell's labels.
    Menu.buildFromTemplate([
      { label: '打开 DeepSeek Harness' },
      { type: 'separator' },
      { label: '退出 DeepSeek Harness' },
    ]);
  },
};

const labels = () => (menuTray.current?.items ?? []).map((item) => item.type === 'separator' ? '---' : item.label);
const failures = [];
const assert = (value, message) => {
  if (!value) failures.push(message);
};

const writeState = (items) => writeFileSync(stateFile, JSON.stringify({ version: 1, items }, null, 2));
const item = (id, order, zh, en, action) => ({ id, order, labels: { zh, en }, action });

writeState([
  item('restart-tray:restart', 10, '重启 DeepSeek Harness', 'Restart DeepSeek Harness', { type: 'builtin', name: 'restart' }),
  item('open-state-folder:open-folder', 20, '打开数据目录', 'Open data folder', { type: 'openPath', path: 'C:/tmp/pro-tools' }),
]);

hook.attach(menuTray);
assert(labels().includes('重启 DeepSeek Harness'), `contributed restart row missing after attach: ${JSON.stringify(labels())}`);
menuTray.relabel();
assert(labels().includes('重启 DeepSeek Harness'), `contributed restart row missing: ${JSON.stringify(labels())}`);
assert(labels().includes('打开数据目录'), 'contributed openPath row missing');
assert(labels().indexOf('重启 DeepSeek Harness') < labels().indexOf('---'), 'contributions must sit before the final separator');
assert(labels().includes('退出 DeepSeek Harness'), 'stock quit row was dropped');

const restartItem = menuTray.current.items.find((entry) => entry.label === '重启 DeepSeek Harness');
restartItem.click();
assert(calls.includes('relaunch') && calls.includes('quitNow'), 'restart action did not relaunch through the no-confirm quit');

const openItem = menuTray.current.items.find((entry) => entry.label === '打开数据目录');
openItem.click();
assert(calls.includes('openPath:C:/tmp/pro-tools'), 'openPath action did not reach shell.openPath');

// A settings toggle rewrites the file; the poll must pick it up without a restart.
writeState([item('restart-tray:restart', 10, '重启 DeepSeek Harness', 'Restart DeepSeek Harness', { type: 'builtin', name: 'restart' })]);
tick();
assert(!labels().includes('打开数据目录'), 'disabled feature stayed in the tray');
assert(labels().includes('重启 DeepSeek Harness'), 'restart row disappeared with the other feature');

// Locale change re-runs the wrapper and must relabel in English.
language = 'en';
menuTray.relabel();
assert(labels().includes('Restart DeepSeek Harness'), `English label missing: ${JSON.stringify(labels())}`);

// Removing the file retracts every contribution and leaves the stock menu.
rmSync(stateFile, { force: true });
tick();
assert(!labels().some((label) => label.includes('Restart DeepSeek Harness')), 'deleted state file left a contributed row');
assert(labels().includes('退出 DeepSeek Harness'), 'stock rows were not restored after the state file disappeared');

// Malformed state must not throw and must not produce rows.
writeFileSync(stateFile, '{ not json', 'utf8');
tick();
assert(labels().length > 0, 'garbage state file broke the menu');
writeState([{ id: 'x', action: {} }, null, 'nope']);
assert(hook.readItems().length === 0, 'malformed rows were accepted');

rmSync(home, { recursive: true, force: true });

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exitCode = 1;
} else {
  console.log('tray hook: all assertions passed');
}
