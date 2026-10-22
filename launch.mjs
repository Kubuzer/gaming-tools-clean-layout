import { spawn, execFileSync } from 'node:child_process';
import { readFile, stat, appendFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';

const folder = dirname(fileURLToPath(import.meta.url));
const origin = 'https://app.gaming.tools';
const log = message => appendFile(join(folder, 'launcher.log'), `${new Date().toISOString()} ${message}\n`);
let socket;
let app;

try {
  if (process.platform !== 'win32') throw new Error('Windows is required.');
  if (typeof WebSocket !== 'function') throw new Error('Node.js 22 or newer is required. Node.js 24 is recommended.');
  if (!process.env.LOCALAPPDATA) throw new Error('LOCALAPPDATA is missing.');
  const config = JSON.parse(await readFile(join(folder, 'launcher-config.json'), 'utf8'));
  const exe = config.companionPath;
  if (typeof exe !== 'string' || !/GT\.Launcher\.exe$/i.test(exe) || !(await stat(exe)).isFile()) {
    throw new Error('Invalid Companion path. Run install.ps1 again.');
  }
  const profile = join(process.env.LOCALAPPDATA, 'gaming.tools', 'Companion', 'WebView2', 'EBWebView');
  const css = await readFile(join(folder, 'companion.css'), 'utf8');
  const running = execFileSync('powershell.exe', ['-NoProfile', '-Command',
    "@(Get-Process -Name GT.Launcher -ErrorAction SilentlyContinue).Count"],
    { encoding: 'utf8', windowsHide: true }).trim();
  if (running !== '0') throw new Error('Companion is already running. Exit it, then use the CSS shortcut.');
  if (process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS) {
    throw new Error('Existing WebView2 arguments found; refusing to replace them.');
  }

  const started = Date.now();
  app = spawn(exe, [], {
    cwd: dirname(exe), stdio: 'ignore', windowsHide: true,
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
      '--remote-debugging-port=0 --remote-debugging-address=127.0.0.1' },
  });
  await once(app, 'spawn');
  await log(`Started Companion PID ${app.pid}; local CSS only.`);
  app.once('exit', () => { socket?.close(); process.exit(0); });

  // Wait for the new browser's observable port file, never reuse a stale endpoint.
  const portFile = join(profile, 'DevToolsActivePort');
  let port;
  while (Date.now() - started < 30000) {
    try {
      if ((await stat(portFile)).mtimeMs >= started) {
        const lines = (await readFile(portFile, 'utf8')).trim().split(/\r?\n/);
        const candidate = Number(lines[0]);
        if (Number.isInteger(candidate) && candidate > 0 && candidate < 65536 &&
            /^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(lines[1])) {
          port = candidate;
          break;
        }
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await delay(150);
  }
  if (!port) throw new Error('Companion did not expose a new local WebView2 endpoint.');

  // Check the listening process and its parent before connecting to the debugger.
  const ownerScript = `$listeners=@(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction Stop); ` +
    `if(!$listeners.Count -or @($listeners|Where-Object {$_.LocalAddress -notin '127.0.0.1','::1'}).Count){throw 'Not loopback-only'}; ` +
    `$owners=@($listeners.OwningProcess|Sort-Object -Unique); if($owners.Count -ne 1){throw 'Ambiguous owner'}; ` +
    `$browser=Get-CimInstance Win32_Process -Filter ('ProcessId='+$owners[0]); ` +
    `if($browser.Name -ne 'msedgewebview2.exe' -or $browser.ParentProcessId -ne ${app.pid}){throw 'Wrong browser owner'}; ` +
    `$browser.ProcessId`;
  const browserPid = execFileSync('powershell.exe', ['-NoProfile', '-Command', ownerScript],
    { encoding: 'utf8', windowsHide: true }).trim();
  await log(`Verified loopback port ${port}, WebView2 PID ${browserPid}.`);

  let page;
  while (Date.now() - started < 45000) {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error('Cannot read local WebView2 targets.');
    const matches = (await response.json()).filter(target =>
      target.type === 'page' && URL.canParse(target.url) && new URL(target.url).origin === origin);
    if (matches.length > 1) throw new Error('Multiple Companion pages; refusing to select one arbitrarily.');
    if (matches.length === 1) { page = matches[0]; break; }
    await delay(150);
  }
  if (!page) throw new Error('The Companion interface did not load.');
  const wsUrl = new URL(page.webSocketDebuggerUrl);
  if (wsUrl.protocol !== 'ws:' || !['127.0.0.1', 'localhost'].includes(wsUrl.hostname) ||
      wsUrl.port !== String(port) || !wsUrl.pathname.startsWith('/devtools/page/')) {
    throw new Error('Unexpected debugger address.');
  }
  socket = new WebSocket(wsUrl);
  await once(socket, 'open');
  let id = 0;
  const pending = new Map();
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timeout = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`No acknowledgement for ${method}; command not replayed.`));
    }, 5000);
    pending.set(requestId, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  let applying = Promise.resolve();
  const apply = async () => {
    const { frameTree } = await command('Page.getFrameTree');
    if (!URL.canParse(frameTree.frame.url) || new URL(frameTree.frame.url).origin !== origin) return;
    const { styleSheetId } = await command('CSS.createStyleSheet', { frameId: frameTree.frame.id, force: false });
    await command('CSS.setStyleSheetText', { styleSheetId, text: css });
    await log('Applied companion.css to the Companion main document.');
  };
  const enqueue = () => {
    applying = applying.then(apply).catch(async error => {
      await log(`CSS ERROR: ${error.message}`);
    });
  };
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      clearTimeout(request.timeout);
      pending.delete(message.id);
      if (message.error) request.reject(new Error(`${message.error.message}`));
      else request.resolve(message.result);
    } else if (message.method === 'Page.domContentEventFired') {
      enqueue();
    }
  });
  socket.addEventListener('close', () => {
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(new Error('Companion debugger disconnected.'));
    }
    pending.clear();
  });
  await command('DOM.enable');
  await command('CSS.enable');
  await command('Page.enable');
  await apply();
  // Keep this single app-scoped connection alive for reloads; no global configuration.
  await once(socket, 'close');
} catch (error) {
  await log(`ERROR: ${error.message}`).catch(() => {});
  app?.unref();
  socket?.close();
  console.error(error.message);
  spawn('powershell.exe', ['-NoProfile', '-Command',
    "Add-Type -AssemblyName System.Windows.Forms; " +
    "[System.Windows.Forms.MessageBox]::Show('Could not apply Clean Layout. See launcher.log beside launch.mjs. Close Companion before trying again; run install.ps1 again if paths changed.', 'gaming.tools CSS')"],
    { stdio: 'ignore', windowsHide: true });
  process.exitCode = 1;
}
