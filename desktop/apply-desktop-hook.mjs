#!/usr/bin/env node
/**
 * Inject, verify, or remove the dsh-pro-tools tray hook in the DeepSeek Harness
 * desktop shell (`resources/app/lib/main.js`).
 *
 * The tray lives in the Electron main process, which plugins cannot reach, so
 * this one region is the only part of the feature that has to touch the shell.
 * The region is self-contained and marker-delimited, so:
 *
 *   - re-running the script after a Harness update restores it,
 *   - `--uninstall` removes exactly those lines,
 *   - `--check` reports whether the running shell still carries it.
 *
 * The script also removes the ad-hoc 0.1 prototype edit (a hard-coded
 * `restartTrayApplication` row) so an earlier hand patch cannot duplicate the
 * contributed row.
 *
 * Usage:
 *   node desktop/apply-desktop-hook.mjs [--main <path/to/main.js>] [--app <app dir>]
 *                                       [--check] [--uninstall] [--dry-run]
 *
 * @module dsh-pro-tools/desktop/apply-desktop-hook
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const hookSourcePath = join(here, 'tray-hook.js');
const BEGIN = '// >>> dsh-pro-tools tray hook v1';
const END = '// <<< dsh-pro-tools tray hook v1';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
};

const checkOnly = flag('check');
const uninstall = flag('uninstall');
const dryRun = flag('dry-run');

/** Candidate shell entry points, best first. */
function resolveMainPath() {
  const explicit = option('main') ?? process.env.DSH_DESKTOP_MAIN;
  if (explicit) return explicit;
  const appDir = option('app');
  if (appDir) return join(appDir, 'resources', 'app', 'lib', 'main.js');
  const roots = [
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness'),
    process.env.ProgramFiles && join(process.env.ProgramFiles, 'DeepSeek Harness'),
    process.env['ProgramFiles(x86)'] && join(process.env['ProgramFiles(x86)'], 'DeepSeek Harness'),
    join(homedir(), 'AppData', 'Local', 'Programs', 'DeepSeek Harness'),
    'C:/Program Files/DeepSeek Harness',
    'D:/Programs/DeepSeek Harness',
  ].filter((root) => typeof root === 'string' && root.length > 0);
  for (const root of roots) {
    const candidate = join(root, 'resources', 'app', 'lib', 'main.js');
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

const mainPath = resolveMainPath();
if (!mainPath) {
  console.error('找不到桌面外壳 lib/main.js。请加 --main "<安装目录>\\resources\\app\\lib\\main.js" 或设置 DSH_DESKTOP_MAIN。');
  process.exit(2);
}
if (!existsSync(mainPath)) {
  console.error(`没有这个文件：${mainPath}`);
  process.exit(2);
}

const hookSource = readFileSync(hookSourcePath, 'utf8').replace(/\r\n/g, '\n').trimEnd();
const original = readFileSync(mainPath, 'utf8');
const eol = original.includes('\r\n') ? '\r\n' : '\n';
const hook = hookSource.split('\n').join(eol);

/** The ad-hoc 0.1 edit this hook supersedes, removed when present. */
const LEGACY = [
  '\trestartTrayApplication: "Restart DeepSeek Harness",\n',
  '\trestartTrayApplication: "重启 DeepSeek Harness",\n',
  '\t\t\trestart: () => {\n\t\t\t\tif (quitting) return;\n\t\t\t\tapp.relaunch();\n\t\t\t\tquitWithoutConfirmation();\n\t\t\t}\n',
  '\t\t\t{\n\t\t\t\tlabel: messages.restartTrayApplication,\n\t\t\t\tclick: () => {\n\t\t\t\t\tthis.options.restart();\n\t\t\t\t}\n\t\t\t},\n',
];

const anchors = [
  '\t} catch (error) {\n\t\tconsole.warn("desktop tray: unavailable", error);\n\t}\n',
  '\tconst backgroundNotice = process.platform === "win32"',
];

const hasRegion = original.includes(BEGIN) && original.includes(END);
const state = { removedLegacy: 0, inserted: false, replaced: false };

/** Remove the legacy fragments; count what actually changed. */
function stripLegacy(text) {
  let next = text;
  for (const fragment of LEGACY) {
    const unix = fragment;
    const windows = fragment.split('\n').join('\r\n');
    for (const variant of new Set([fragment, windows])) {
      if (next.includes(variant)) {
        next = next.split(variant).join('');
        state.removedLegacy += 1;
        break;
      }
    }
  }
  return next;
}

/** Splice the hook region after the first anchor that exists. */
function insertRegion(text) {
  const anchor = anchors.find((candidate) => text.includes(candidate));
  if (anchor === undefined) return undefined;
  const at = text.indexOf(anchor) + anchor.length;
  const separator = text[at - 1] === '\n' ? '' : eol;
  return `${text.slice(0, at)}${separator}${hook}${eol}${text.slice(at)}`;
}

/** Replace an existing region in place. */
function replaceRegion(text) {
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END, start);
  if (start < 0 || end < 0) return text;
  return `${text.slice(0, start)}${hook}${text.slice(end + END.length)}`;
}

/** Parse the result as ESM so a bad splice never reaches the app. */
function syntaxCheck(text) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pro-tools-hook-'));
  try {
    const copy = join(dir, 'main.mjs');
    writeFileSync(copy, text, 'utf8');
    execFileSync(process.execPath, ['--check', copy], { stdio: 'pipe' });
    return { ok: true };
  } catch (error) {
    return { ok: false, message: String(error.stderr ?? error.message).trim().split('\n').slice(0, 6).join('\n') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** One backup next to the app, plus a rotating copy under the Pro Tools data dir. */
function backup(text) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const local = `${mainPath}.dsh-pro-tools.${stamp}.bak`;
  writeFileSync(local, text, 'utf8');
  const dataDir = join(process.env.DSH_HOME?.trim() || join(homedir(), '.dsh'), 'pro-tools', 'backups');
  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, `main.js.${stamp}.bak`), text, 'utf8');
  } catch (error) {
    console.warn(`warning: 无法写入 ${dataDir}（${String(error.message)}）；应用目录旁的备份仍然有效。`);
  }
  return local;
}

if (checkOnly) {
  console.log(`shell:   ${mainPath}`);
  console.log(`hook:    ${hasRegion ? 'installed' : 'missing'}`);
  console.log(`legacy:  ${LEGACY.some((fragment) => original.includes(fragment) || original.includes(fragment.split('\n').join('\r\n'))) ? 'prototype edit still present' : 'clean'}`);
  if (hasRegion) {
    const installed = original.slice(original.indexOf(BEGIN), original.indexOf(END) + END.length);
    const current = hookSource.replace(/\r\n/g, '\n');
    console.log(`version: ${installed.replace(/\r\n/g, '\n') === current ? 'current' : 'stale — re-run without --check'}`);
  }
  process.exitCode = hasRegion ? 0 : 1;
  process.exit();
}

if (uninstall) {
  if (!hasRegion) {
    console.log('hook 未安装，无需卸载。');
    process.exit(0);
  }
  const next = original.slice(0, original.indexOf(BEGIN)) + original.slice(original.indexOf(END) + END.length);
  if (!dryRun) {
    const result = syntaxCheck(next);
    if (!result.ok) {
      console.error('移除后语法检查失败，未写入：\n' + result.message);
      process.exit(1);
    }
    const saved = backup(original);
    writeFileSync(mainPath, next, 'utf8');
    console.log(`hook 已移除。备份：${saved}`);
  } else {
    console.log('dry-run：将移除 hook 区段。');
  }
  process.exit(0);
}

let next = stripLegacy(original);
if (hasRegion) {
  next = replaceRegion(next);
  state.replaced = true;
} else {
  const spliced = insertRegion(next);
  if (spliced === undefined) {
    console.error('找不到插入锚点——这个版本的 main.js 结构变了。请把下面这段手动放到托盘创建之后：\n\n' + hookSource);
    process.exit(1);
  }
  next = spliced;
  state.inserted = true;
}

const delta = state.inserted ? 'inserted' : state.replaced ? 'refreshed' : 'unchanged';
const result = syntaxCheck(next);
if (!result.ok) {
  console.error('语法检查失败，未写入：\n' + result.message);
  process.exit(1);
}

if (dryRun || next === original) {
  console.log(`dry-run/无变化：${delta}；移除原型编辑 ${String(state.removedLegacy)} 处。`);
  process.exit(0);
}

const saved = backup(original);
writeFileSync(mainPath, next, 'utf8');
console.log(`hook ${delta} → ${mainPath}`);
console.log(`legacy 清理：${String(state.removedLegacy)} 处；备份：${saved}`);
console.log('重启一次 DeepSeek Harness 之后托盘才会使用新菜单（设置页改动本身实时生效）。');
