import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const source = dirname(dirname(fileURLToPath(import.meta.url)));
const engine = process.env.CLEAN_LAYOUT_POWERSHELL || 'powershell.exe';
function fixture(t) {
  const tempBase = realpathSync.native(tmpdir());
  const temp = mkdtempSync(join(tempBase, 'gt-layout-'));
  t.after(() => {
    assert.equal(dirname(temp), tempBase);
    assert.ok(basename(temp).startsWith('gt-layout-'));
    rmSync(temp, { recursive: true, force: true });
  });
  const root = join(temp, 'Clean Layout spaces Żółw');
  mkdirSync(root);
  for (const name of ['install.ps1', 'shortcut.ps1', 'launch.mjs', 'launch-hidden.vbs', 'companion.css']) copyFileSync(join(source, name), join(root, name));
  const companion = join(root, 'GT.Launcher.exe');
  writeFileSync(companion, 'Fixture only; never executed');
  const shortcut = join(root, 'gaming.tools - Clean Layout.lnk');
  const run = (...extra) => spawnSync(engine, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'install.ps1'),
    '-ShortcutDirectory', root, '-CompanionPath', companion, '-NodePath', process.execPath, ...extra], { encoding: 'utf8', windowsHide: true });
  return { root, companion, shortcut, run };
}

test('install and uninstall with spaces and Unicode paths; sources survive', t => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(f.shortcut));
  assert.equal(JSON.parse(readFileSync(join(f.root, 'launcher-config.json'), 'utf8')).companionPath, f.companion);
  const inspect = spawnSync(engine, ['-NoProfile', '-Command',
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8; . $env:GT_TEST_HELPER; $s=[CleanLayoutShortcut]::Read($env:GT_TEST_LINK); @{Target=$s[0];Arguments=$s[1]}|ConvertTo-Json'],
    { encoding:'utf8', windowsHide:true, env:{...process.env,GT_TEST_LINK:f.shortcut,GT_TEST_HELPER:join(f.root,'shortcut.ps1')} });
  assert.equal(inspect.status, 0, inspect.stderr);
  const link = JSON.parse(inspect.stdout);
  assert.match(link.Target, /\\wscript\.exe$/i);
  assert.equal(link.Arguments, '"' + join(f.root, 'launch-hidden.vbs') + '"');
  assert.equal(f.run().status, 0, 'Reinstall must be safe for the owned shortcut');
  assert.equal(f.run('-Uninstall').status, 0);
  assert.ok(!existsSync(f.shortcut));
  assert.ok(!existsSync(join(f.root, 'launcher-config.json')));
  assert.ok(existsSync(join(f.root, 'launch.mjs')));
  assert.ok(existsSync(f.companion));
});
test('missing app fails before writing local configuration', t => {
  const f = fixture(t);
  rmSync(f.companion);
  assert.notEqual(f.run().status, 0);
  assert.ok(!existsSync(f.shortcut));
  assert.ok(!existsSync(join(f.root, 'launcher-config.json')));
});
test('missing CSS fails before writing shortcut', t => {
  const f = fixture(t);
  rmSync(join(f.root, 'companion.css'));
  assert.notEqual(f.run().status, 0);
  assert.ok(!existsSync(f.shortcut));
});
test('foreign shortcut is preserved during install and uninstall', t => {
  const f = fixture(t);
  const create = spawnSync(engine, ['-NoProfile', '-Command',
    '. $env:GT_TEST_HELPER; [CleanLayoutShortcut]::Write($env:GT_TEST_LINK,$env:ComSpec,"",$env:TEMP,$env:ComSpec)'],
    { env:{...process.env,GT_TEST_LINK:f.shortcut,GT_TEST_HELPER:join(f.root,'shortcut.ps1')},windowsHide:true });
  assert.equal(create.status, 0);
  const original = readFileSync(f.shortcut);
  assert.notEqual(f.run().status, 0);
  assert.notEqual(f.run('-Uninstall').status, 0);
  assert.deepEqual(readFileSync(f.shortcut), original);
  assert.ok(!existsSync(join(f.root, 'launcher-config.json')));
});
test('CSS is identical to the user-accepted flicker fix', () => {
  const hash = createHash('sha256').update(readFileSync(join(source, 'companion.css'))).digest('hex');
  assert.equal(hash, 'b3f85cbed581f373ba6902db70b7dcfd68f405f923f66e3ce8d0d662d269209b');
});
