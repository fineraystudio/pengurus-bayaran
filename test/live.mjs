/*
 * Ujian langsung (live) Pengurus Bayaran.
 *
 * Menyemak salinan yang benar-benar dihoskan di GitHub Pages: halaman dimuat,
 * tiada ralat konsol, tambah bayaran dan kekal selepas muat semula, service
 * worker berdaftar, PWA boleh dipasang, dan tiada limpahan mendatar pada telefon.
 * Turut menyemak halaman senarai di tools-site dan butang "Buka aplikasi".
 *
 * Jalankan: node test/live.mjs
 * Pilihan: LIVE_URL=... TOOLS_URL=... node test/live.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';

const APP_URL = process.env.LIVE_URL || 'https://fineraystudio.github.io/pengurus-bayaran/';
const TOOLS_URL = process.env.TOOLS_URL || 'https://fineraystudio.github.io/tools-site/pengurus-bayaran/';

const CHROME_CANDIDATES = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findChrome() {
    const candidates = process.env.CHROME_PATH ? [process.env.CHROME_PATH, ...CHROME_CANDIDATES] : CHROME_CANDIDATES;
    const found = candidates.find((candidate) => existsSync(candidate));
    if (!found) throw new Error('Chrome/Edge tidak dijumpai. Set CHROME_PATH.');
    return found;
}

async function launchChrome(executable, userDataDir) {
    const child = spawn(executable, [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-extensions',
        '--disable-sync',
        '--metrics-recording-only',
        '--mute-audio',
        '--remote-allow-origins=*',
        '--remote-debugging-address=127.0.0.1',
        '--remote-debugging-port=0',
        `--user-data-dir=${userDataDir}`,
        'about:blank'
    ], { stdio: 'ignore' });

    const activePortFile = path.join(userDataDir, 'DevToolsActivePort');
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
        if (existsSync(activePortFile)) {
            const [port] = readFileSync(activePortFile, 'utf8').split('\n');
            if (port) return { child, port: Number(port) };
        }
        if (child.exitCode !== null) throw new Error('Chrome berhenti semasa dimulakan.');
        await sleep(100);
    }
    throw new Error('Chrome tidak membuka port debug dalam masa 20 saat.');
}

function connectCdp(wsUrl) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        let nextId = 1;
        const pending = new Map();
        const events = [];

        ws.addEventListener('message', (event) => {
            const message = JSON.parse(event.data);
            if (message.method === 'Page.javascriptDialogOpening') {
                ws.send(JSON.stringify({ id: nextId++, method: 'Page.handleJavaScriptDialog', params: { accept: true } }));
                return;
            }
            if (!message.id && message.method) events.push(message);
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
            events,
            close() { ws.close(); }
        }));
    });
}

async function openPage(debugPort, url) {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
    const target = await response.json();
    const cdp = await connectCdp(target.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Log.enable');
    return cdp;
}

function makeApi(cdp) {
    async function evaluate(expression) {
        const result = await cdp.send('Runtime.evaluate', {
            expression, awaitPromise: true, returnByValue: true, userGesture: true
        });
        if (result.exceptionDetails) {
            const detail = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
            throw new Error(`Ralat dalam halaman: ${detail}`);
        }
        return result.result.value;
    }

    async function waitFor(check, label, timeout = 20000) {
        const deadline = Date.now() + timeout;
        let lastError = null;
        while (Date.now() < deadline) {
            try {
                const value = await check();
                if (value) return value;
            } catch (error) {
                lastError = error;
            }
            await sleep(150);
        }
        throw new Error(`Tamat masa menunggu: ${label}${lastError ? ` (${lastError.message})` : ''}`);
    }

    async function waitForApp() {
        await waitFor(
            () => evaluate("document.readyState === 'complete' && !!window.PengurusBayaran && !!window.PBLib"),
            'aplikasi dimuatkan'
        );
    }

    return { evaluate, waitFor, waitForApp };
}

const HELPERS = `
    window.__t = {
        buttons() { return Array.from(document.querySelectorAll('button')); },
        clickButton(text) {
            const button = this.buttons().find((b) => b.textContent.includes(text));
            if (!button) throw new Error('Butang tidak dijumpai: ' + text);
            button.click();
            return true;
        },
        items() { return Array.from(document.querySelectorAll('.payment-item')); },
        titles() { return this.items().map((el) => el.querySelector('.payment-title').textContent.trim()); },
        summary() {
            const text = (id) => document.getElementById(id).textContent.trim();
            return {
                totalCount: text('totalCount'), totalAmount: text('totalAmount'), paidAmount: text('paidAmount'),
                unpaidAmount: text('unpaidAmount')
            };
        },
        addPayment({ title, amount, date, type, paid }) {
            this.clickButton('Tambah Bayaran');
            document.getElementById('paymentTitle').value = title;
            document.getElementById('paymentAmount').value = String(amount);
            document.getElementById('paymentDate').value = date;
            document.getElementById('paymentType').value = type;
            document.getElementById('paymentPaid').checked = Boolean(paid);
            document.getElementById('paymentForm')
                .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            return !document.getElementById('paymentModal').classList.contains('active');
        },
        storageKey: 'pengurusBayaranData_v1'
    };
    true;
`;

async function main() {
    const chromePath = findChrome();
    const userDataDir = path.join(os.tmpdir(), `pengurus-bayaran-live-${process.pid}`);
    await rm(userDataDir, { recursive: true, force: true });
    const { child: chrome, port: debugPort } = await launchChrome(chromePath, userDataDir);
    console.log(`Chrome headless sedia (debug port ${debugPort}), ujian ${APP_URL}`);

    let cdp;
    let passed = 0;
    const steps = [];
    const step = (name, fn) => steps.push({ name, fn });

    try {
        cdp = await openPage(debugPort, APP_URL);
        const { evaluate, waitFor, waitForApp } = makeApi(cdp);
        await waitForApp();
        await evaluate(HELPERS);

        step('Halaman hidup dimuat dalam Bahasa Melayu', async () => {
            const info = await evaluate(`({
                lang: document.documentElement.lang,
                title: document.title,
                heading: document.querySelector('h1').textContent.trim(),
                subtitle: document.querySelector('.subtitle').textContent.trim(),
                canonical: document.querySelector('link[rel="canonical"]')?.href || '',
                manifest: document.querySelector('link[rel="manifest"]')?.href || '',
                themeColor: document.querySelector('meta[name="theme-color"]')?.content || '',
                buttons: window.__t.buttons().map((b) => b.textContent.trim()).filter((t) => t && !t.includes('Pasang'))
            })`);
            assert.equal(info.lang, 'ms');
            assert.match(info.title, /Pengurus Bayaran/);
            assert.equal(info.heading, '💰 Pengurus Bayaran');
            assert.equal(info.subtitle, 'Urus bayaran bulanan anda dengan mudah');
            assert.equal(info.canonical, APP_URL);
            assert.equal(info.manifest, `${APP_URL}manifest.json`);
            assert.match(info.themeColor, /^#[0-9a-f]{6}$/i);
            assert.ok(info.buttons.includes('Tambah Bayaran'));
        });

        step('Keadaan kosong dan tambah bayaran berfungsi di live', async () => {
            await evaluate(`localStorage.clear(); true`);
            await cdp.send('Page.reload');
            await waitForApp();
            await evaluate(HELPERS);
            const empty = await evaluate(`({
                empty: document.querySelector('.empty-state').textContent.trim(),
                count: window.__t.summary().totalCount
            })`);
            assert.match(empty.empty, /Belum ada bayaran/);
            assert.equal(empty.count, '0');

            const added = await evaluate(`(() => {
                const ok = window.__t.addPayment({ title: 'Bil Elektrik', amount: 75.9, date: '2026-10-05', type: 'monthly', paid: true });
                return { ok, titles: window.__t.titles(), summary: window.__t.summary() };
            })()`);
            assert.equal(added.ok, true);
            assert.deepEqual(added.titles, ['Bil Elektrik']);
            assert.equal(added.summary.totalCount, '1');
            assert.equal(added.summary.totalAmount, 'RM 75.90');
            assert.equal(added.summary.paidAmount, 'RM 75.90');
        });

        step('Data kekal selepas muat semula di live', async () => {
            await cdp.send('Page.reload');
            await waitForApp();
            await evaluate(HELPERS);
            const after = await evaluate(`({
                titles: window.__t.titles(),
                summary: window.__t.summary(),
                stored: !!localStorage.getItem(window.__t.storageKey),
                hijri: (document.getElementById('todayHijri')?.textContent || '').trim()
            })`);
            assert.deepEqual(after.titles, ['Bil Elektrik']);
            assert.equal(after.summary.totalAmount, 'RM 75.90');
            assert.equal(after.stored, true);
            assert.ok(after.hijri.length > 0, 'Tarikh Hijrah hari ini sepatutnya dipaparkan');
        });

        step('Kalkulator Zakat berfungsi di live', async () => {
            const zakat = await evaluate(`(() => {
                const input = document.getElementById('zakatSavings');
                if (!input) return { found: false };
                input.value = '20000';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                return {
                    found: true,
                    visible: document.getElementById('zakatResult').style.display !== 'none',
                    status: document.getElementById('zakatStatus').textContent.trim(),
                    amount: document.getElementById('zakatAmount').textContent.trim()
                };
            })()`);
            assert.equal(zakat.found, true, 'Medan simpanan zakat tidak dijumpai');
            assert.equal(zakat.visible, true, 'Keputusan zakat sepatutnya dipaparkan');
            assert.match(zakat.status, /mencapai nisab/);
            assert.match(zakat.amount, /RM\s?500\.00/, 'Zakat 2.5% daripada RM 20,000 = RM 500.00');
        });

        step('Service worker berdaftar dan mengawal halaman', async () => {
            const sw = await waitFor(async () => {
                const state = await evaluate(`(async () => {
                    const reg = await navigator.serviceWorker.getRegistration();
                    return {
                        registered: !!reg,
                        scope: reg ? reg.scope : '',
                        active: !!(reg && reg.active),
                        controlling: !!navigator.serviceWorker.controller
                    };
                })()`);
                return state.active && state.controlling ? state : null;
            }, 'service worker aktif');
            assert.equal(sw.registered, true);
            assert.equal(sw.active, true);
            assert.equal(sw.controlling, true);
            assert.equal(sw.scope, APP_URL);
        });

        step('PWA boleh dipasang dari live', async () => {
            const result = await cdp.send('Page.getInstallabilityErrors');
            assert.deepEqual(result.installabilityErrors, []);
            const offline = await evaluate(`(async () => {
                const cacheNames = await caches.keys();
                return { caches: cacheNames, manifestOk: await fetch('manifest.json').then((r) => r.ok) };
            })()`);
            assert.ok(offline.caches.length > 0, 'Cache service worker sepatutnya wujud');
            assert.equal(offline.manifestOk, true);
        });

        step('Tiada limpahan mendatar pada telefon 390px', async () => {
            await cdp.send('Emulation.setDeviceMetricsOverride', {
                width: 390, height: 844, deviceScaleFactor: 2, mobile: true
            });
            await cdp.send('Page.reload');
            await waitForApp();
            const overflow = await evaluate(`({
                scrollWidth: document.documentElement.scrollWidth,
                clientWidth: document.documentElement.clientWidth
            })`);
            await cdp.send('Emulation.clearDeviceMetricsOverride');
            assert.ok(overflow.scrollWidth <= overflow.clientWidth + 1,
                `Limpahan mendatar: ${overflow.scrollWidth} > ${overflow.clientWidth}`);
        });

        step('Halaman senarai tools-site hidup dan menuju aplikasi', async () => {
            const listing = await openPage(debugPort, TOOLS_URL);
            const api = makeApi(listing);
            try {
                const info = await api.waitFor(() => api.evaluate(`(() => {
                    const link = Array.from(document.querySelectorAll('a'))
                        .find((a) => /Buka aplikasi/i.test(a.textContent));
                    const images = Array.from(document.querySelectorAll('img'));
                    return {
                        ready: document.readyState === 'complete',
                        title: document.title,
                        lang: document.documentElement.lang,
                        cta: link ? link.href : '',
                        images: images.map((img) => ({ src: img.currentSrc || img.src, loaded: img.complete && img.naturalWidth > 0 })),
                        privacy: !!Array.from(document.querySelectorAll('a')).find((a) => /privasi/i.test(a.href))
                    };
                })()`), 'halaman senarai dimuatkan');
                assert.match(info.title, /Pengurus Bayaran/);
                assert.equal(info.lang, 'ms');
                assert.equal(info.cta, APP_URL);
                assert.ok(info.images.length >= 3, 'Sekurang-kurangnya 3 tangkapan skrin dijangka');
                const broken = info.images.filter((img) => !img.loaded);
                assert.deepEqual(broken, [], 'Imej gagal dimuatkan: ' + JSON.stringify(broken));
                assert.equal(info.privacy, true);
            } finally {
                listing.close();
            }
        });

        steps.push({
            name: 'Tiada ralat konsol sepanjang ujian',
            fn: async () => {
                const errors = cdp.events
                    .filter((event) => event.method === 'Log.entryAdded' && event.params.entry.level === 'error')
                    .map((event) => `${event.params.entry.text} ${event.params.entry.url || ''}`.trim())
                    .filter((text) => !/favicon/i.test(text));
                assert.deepEqual(errors, []);
            }
        });

        for (const { name, fn } of steps) {
            console.log(`→ ${name}`);
            await fn();
            passed++;
            console.log(`✔ ${name}`);
        }

        console.log(`\n${passed}/${steps.length} langkah live lulus.`);
    } finally {
        if (cdp) cdp.close();
        chrome.kill();
        await sleep(300);
        await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    }
}

main().catch((error) => {
    console.error('\n✖ Ujian live gagal:', error.message);
    console.error(error.stack);
    process.exitCode = 1;
});
