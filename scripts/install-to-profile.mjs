#!/usr/bin/env node
/**
 * Pack this bundle and register the tarball in the active dsh profile.
 *
 * Why a tarball and not the checkout directory: a `file:<dir>` dependency makes
 * pnpm create a *relative* symlink. When the profile is reached through a
 * junction or an alias path (`C:\Users\...\.dsh` → `D:\Users\...\.dsh`), that
 * relative link dangles, and the loader then reports
 * `cannot resolve profile bundle "<name>"`. A packed tarball is materialized
 * inside the profile, so the link shape no longer matters.
 *
 * Usage:
 *   node scripts/install-to-profile.mjs [--profile <dir>] [--dry-run] [--no-install]
 *
 * @module dsh-pro-tools/scripts/install-to-profile
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
};

const dryRun = flag('dry-run');
const skipInstall = flag('no-install');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const name = manifest.name;
const version = manifest.version;

const profileDir = option('profile')
  ?? process.env.DSH_PROFILE_DIR
  ?? join(process.env.DSH_HOME?.trim() || join(homedir(), '.dsh'), 'profiles', 'desktop');
const profileManifestPath = join(profileDir, 'package.json');
if (!existsSync(profileManifestPath)) {
  console.error(`profile 目录不存在或缺少 package.json：${profileDir}`);
  process.exit(2);
}

const pluginsDir = join(process.env.DSH_HOME?.trim() || join(homedir(), '.dsh'), 'local-plugins');
const tarball = join(pluginsDir, `${name}-${version}.tgz`);

console.log(`bundle:  ${name}@${version}`);
console.log(`profile: ${profileDir}`);
console.log(`tarball: ${tarball}`);

if (dryRun) {
  console.log('dry-run：不打包、不写 profile、不跑 pnpm。');
  process.exit(0);
}

execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--pack-destination', pluginsDir], {
  cwd: root,
  stdio: 'inherit',
});
if (!existsSync(tarball)) {
  console.error(`打包后仍找不到 ${tarball}`);
  process.exit(1);
}

const profileManifest = JSON.parse(readFileSync(profileManifestPath, 'utf8'));
copyFileSync(profileManifestPath, `${profileManifestPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`);
profileManifest.dependencies ??= {};
profileManifest.dependencies[name] = `file:${tarball.replaceAll('\\', '/')}`;
profileManifest.dsh ??= {};
profileManifest.dsh.profile ??= {};
profileManifest.dsh.profile.bundles ??= [];
if (!profileManifest.dsh.profile.bundles.includes(name)) profileManifest.dsh.profile.bundles.push(name);
writeFileSync(profileManifestPath, `${JSON.stringify(profileManifest, null, 2)}\n`, 'utf8');
console.log(`manifest: dependency + bundles entry written`);

if (skipInstall) {
  console.log('跳过 pnpm install；没有这一步 loader 仍解析不到包。');
} else {
  execFileSync(process.platform === 'win32' ? 'corepack.cmd' : 'corepack', ['pnpm@11.28.5', 'install'], {
    cwd: profileDir,
    stdio: 'inherit',
  });
}

console.log('下一步：刷新设置页即可看到新版本；若只是代码更新，宿主会按插件文件 mtime 自动重载，无需重启桌面端。');
