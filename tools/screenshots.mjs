/*
 * Tangkapan skrin produk Pengurus Bayaran.
 *
 * Membuka aplikasi dalam Chrome headless, mengisi data contoh Bahasa Melayu,
 * kemudian merakam tiga tangkapan skrin untuk halaman jualan:
 *   1. papan pemuka (ringkasan + senarai bayaran)
 *   2. borang tambah bayaran
 *   3. kalkulator zakat (dibuka, dengan keputusan)
 *
 * Jalankan: node tools/screenshots.mjs
 * Hasil: screenshots/01-dashboard.png, 02-tambah-bayaran.png, 03-kalkulator-zakat.png
 */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'screenshots');
const WIDTH = 1280;
const HEIGHT = 1000;

const CHROME_CANDIDATES = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
];

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
};

// Data contoh: bulan Oktober 2026, campuran komitmen bulanan dan bayaran tambahan.
const SAMPLE_DATA = {
    October_2026: {
        month: 'October',
        year: 2026,
        topic: 'Oktober 2026 — bayaran bulanan',
        lists: [
            { id: 1, title: 'Sewa Rumah', amount: 1200, type: 'monthly', paid: true, payDate: '2026-10-01' },
            { id: 2, title: 'Bil Elektrik TNB', amount: 186.4, type: 'monthly', paid: true, payDate: '2026-10-05' },
            { id: 3, title: 'Bil Air Syabas', amount: 42.3, type: 'monthly', paid: false, payDate: '2026-10-28' },
            { id: 4, title: 'Internet Unifi', amount: 129, type: 'monthly', paid: true, payDate: '2026-10-10' },
            { id: 5, title: 'Ansuran Kereta', amount: 650, type: 'monthly', paid: true, payDate: '2026-10-15' },
            { id: 6, title: 'Bayaran Sekolah Anak', amount: 320, type: 'extra', paid: false, payDate: '2026-10-30' },
            { id: 7, title: 'Servis Penghawa Dingin', amount: 180, type: 'extra', paid: true, payDate: '2026-10-12' }
        ]
    }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findChrome() {
    const candidates = process.env.CHROME_PATH ? [process.env.CHROME_PATH, ...CHROME_CANDIDATES] : CHROME_CANDIDATES;
    const found = candidates.find((candidate) => existsSync(candidate));
    if (!found) throw new Error('Chrome/Edge tidak dijumpai. Set CHROME_PATH.');
    return found;
}

function startStaticServer() {
    const server = createServer(async (req, res) => {
        try {
            const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
            const filePath = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath.slice(1));
            if (!filePath.startsWith(ROOT)) {
                res.writeHead(403);
                res.end('Forbidden');
                return;
            }
            const body = await readFile(filePath);
            res.writeHead(200, {
                'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
                'Cache-Control': 'no-store'
            });
            res.end(body);
        } catch {
            res.writeHead(404);
            res.end('Not found');
        }
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
    });
}

function launchChrome(executable, userDataDir) {
    return new Promise((resolve, reject) => {
        const child = spawn(executable, [
            '--headless=new',
            '--disable-gpu',
            '--hide-scrollbars',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-background-networking',
            '--disable-extensions',
            '--force-device-scale-factor=1',
            '--remote-allow-origins=*',
            '--remote-debugging-address=127.0.0.1',
            '--remote-debugging-port=0',
            `--user-data-dir=${userDataDir}`,
            'about:blank'
        ], { stdio: 'ignore' });
        const portFile = path.join(userDataDir, 'DevToolsActivePort');
        const deadline = Date.now() + 20000;
        const poll = () => {
            if (existsSync(portFile)) {
                const [port] = readFileSync(portFile, 'utf8').split('\n');
                if (port) return resolve({ child, port: Number(port) });
            }
            if (child.exitCode !== null) return reject(new Error('Chrome berhenti semasa dimulakan.'));
            if (Date.now() > deadline) return reject(new Error('Chrome tidak membuka port debug dalam masa 20 saat.'));
            setTimeout(poll, 100);
        };
        poll();
    });
}

function connectCdp(wsUrl) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        let nextId = 1;
        const pending = new Map();
        ws.addEventListener('message', (event) => {
            const message = JSON.parse(event.data);
            if (message.method === 'Page.javascriptDialogOpening') {
                ws.send(JSON.stringify({ id: nextId++, method: 'Page.handleJavaScriptDialog', params: { accept: true } }));
                return;
            }
            if (message.id && pending.has(message.id)) {
                const { resolve: done, reject: fail } = pending.get(message.id);
                pending.delete(message.id);
                if (message.error) fail(new Error(message.error.message));
                else done(message.result);
            }
        });
        ws.addEventListener('error', () => reject(new Error('WebSocket CDP gagal.')));
        ws.addEventListener('open', () => resolve({
            send(method, params = {}) {
                const id = nextId++;
                return new Promise((done, fail) => {
                    pending.set(id, { resolve: done, reject: fail });
                    ws.send(JSON.stringify({ id, method, params }));
                });
            },
            close() { ws.close(); }
        }));
    });
}

async function main() {
    const chromePath = findChrome();
    await mkdir(OUT, { recursive: true });
    const userDataDir = path.join(os.tmpdir(), `pengurus-bayaran-shots-${process.pid}`);
    await rm(userDataDir, { recursive: true, force: true });

    const { server, port: httpPort } = await startStaticServer();
    const pageUrl = `http://127.0.0.1:${httpPort}/`;
    const { child: chrome, port: debugPort } = await launchChrome(chromePath, userDataDir);

    let cdp;
    try {
        const targetResponse = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(pageUrl)}`, { method: 'PUT' });
        const target = await targetResponse.json();
        cdp = await connectCdp(target.webSocketDebuggerUrl);
        await cdp.send('Runtime.enable');
        await cdp.send('Page.enable');
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });

        async function evaluate(expression) {
            const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
            if (result.exceptionDetails) {
                throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
            }
            return result.result.value;
        }

        async function waitFor(check, label, timeout = 15000) {
            const deadline = Date.now() + timeout;
            while (Date.now() < deadline) {
                try {
                    const value = await check();
                    if (value) return value;
                } catch { /* halaman belum sedia */ }
                await sleep(120);
            }
            throw new Error(`Tamat masa menunggu: ${label}`);
        }

        async function shot(name) {
            const { data } = await cdp.send('Page.captureScreenshot', {
                format: 'png',
                captureBeyondViewport: false
            });
            const file = path.join(OUT, name);
            await writeFile(file, Buffer.from(data, 'base64'));
            console.log(`  ${name}`);
        }

        // Halaman dimuatkan dahulu supaya localStorage boleh diisi untuk asalan ini.
        await waitFor(() => evaluate('document.readyState === "complete"'), 'muat halaman');
        await evaluate(`localStorage.setItem('pengurusBayaranData_v1', ${JSON.stringify(JSON.stringify(SAMPLE_DATA))}); true`);
        await cdp.send('Page.reload');
        await waitFor(() => evaluate('document.querySelectorAll(".payment-item").length >= 5'), 'senarai bayaran dirender');
        await evaluate('window.scrollTo(0, 0); true');
        await sleep(250);

        // 1. Papan pemuka
        await shot('01-dashboard.png');

        // 2. Borang tambah bayaran
        await evaluate(`
            showAddPaymentModal();
            document.getElementById('paymentTitle').value = 'Bil Telefon';
            document.getElementById('paymentAmount').value = '68.00';
            document.getElementById('paymentDate').value = '2026-10-28';
            document.getElementById('paymentType').value = 'monthly';
            document.getElementById('paymentPaid').checked = false;
            document.getElementById('paymentAmount').focus();
            true
        `);
        await sleep(250);
        await shot('02-tambah-bayaran.png');

        // 3. Kalkulator zakat, dibuka dengan contoh simpanan
        await evaluate(`
            closeModal();
            toggleZakat();
            const savings = document.getElementById('zakatSavings');
            savings.value = '45000';
            calculateZakatAmount();
            window.scrollTo(0, 0);
            true
        `);
        await sleep(300);
        await shot('03-kalkulator-zakat.png');

        console.log('Selesai: 3 tangkapan skrin dalam screenshots/.');
    } finally {
        if (cdp) cdp.close();
        server.close();
        chrome.kill();
        await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    }
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
