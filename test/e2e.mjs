/*
 * Ujian hujung-ke-hujung Pengurus Bayaran.
 *
 * Membuka aplikasi dalam Chrome headless (CDP), kemudian menguji aliran sebenar:
 * muat halaman, tambah/edit/padam bayaran, tapis, susun, bulan baharu, simpan
 * merentas muat semula, eksport, import dan service worker PWA.
 *
 * Jalankan: node test/e2e.mjs
 */
import { createServer } from 'node:http';
import { readFile, rm } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const L = require('../lib.js');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
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
            let filePath = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath.slice(1));
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
        server.listen(0, '127.0.0.1', () => {
            resolve({ server, port: server.address().port });
        });
    });
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

        ws.addEventListener('message', (event) => {
            const message = JSON.parse(event.data);

            // Dialog (alert/confirm) yang tidak ditangkap akan menyekat Chrome headless.
            if (message.method === 'Page.javascriptDialogOpening') {
                ws.send(JSON.stringify({
                    id: nextId++,
                    method: 'Page.handleJavaScriptDialog',
                    params: { accept: true }
                }));
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
    const userDataDir = path.join(os.tmpdir(), `pengurus-bayaran-e2e-${process.pid}`);
    await rm(userDataDir, { recursive: true, force: true });

    const { server, port: httpPort } = await startStaticServer();
    const pageUrl = `http://127.0.0.1:${httpPort}/`;
    const { child: chrome, port: debugPort } = await launchChrome(chromePath, userDataDir);
    console.log(`Chrome headless sedia (debug port ${debugPort}), pelayan ${pageUrl}`);

    let cdp;
    try {
        const targetResponse = await fetch(
            `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(pageUrl)}`,
            { method: 'PUT' }
        );
        const target = await targetResponse.json();
        cdp = await connectCdp(target.webSocketDebuggerUrl);
        await cdp.send('Runtime.enable');
        await cdp.send('Page.enable');
        console.log('Bersambung ke halaman ujian.');

        async function evaluate(expression) {
            const result = await cdp.send('Runtime.evaluate', {
                expression,
                awaitPromise: true,
                returnByValue: true,
                userGesture: true
            });
            if (result.exceptionDetails) {
                const detail = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
                throw new Error(`Ralat dalam halaman: ${detail}`);
            }
            return result.result.value;
        }

        async function waitFor(check, label, timeout = 15000) {
            const deadline = Date.now() + timeout;
            let lastError = null;
            while (Date.now() < deadline) {
                try {
                    const value = await check();
                    if (value) return value;
                } catch (error) {
                    lastError = error;
                }
                await sleep(120);
            }
            throw new Error(`Tamat masa menunggu: ${label}${lastError ? ` (${lastError.message})` : ''}`);
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
                itemByTitle(title) {
                    return this.items().find((el) => el.querySelector('.payment-title').textContent.trim() === title) || null;
                },
                titles() { return this.items().map((el) => el.querySelector('.payment-title').textContent.trim()); },
                text(id) { return document.getElementById(id).textContent.trim(); },
                summary() {
                    return {
                        totalCount: this.text('totalCount'),
                        totalAmount: this.text('totalAmount'),
                        paidCount: this.text('paidCount'),
                        monthlyTotal: this.text('monthlyTotal'),
                        extraTotal: this.text('extraTotal'),
                        paidAmount: this.text('paidAmount'),
                        unpaidAmount: this.text('unpaidAmount')
                    };
                },
                setSelect(id, value) {
                    const el = document.getElementById(id);
                    el.value = value;
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    return el.value;
                },
                submitForm(id) {
                    const form = document.getElementById(id);
                    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
                    return true;
                },
                addPayment({ title, amount, date, type, paid }) {
                    this.clickButton('Tambah Bayaran');
                    document.getElementById('paymentTitle').value = title;
                    document.getElementById('paymentAmount').value = String(amount);
                    document.getElementById('paymentDate').value = date;
                    document.getElementById('paymentType').value = type;
                    document.getElementById('paymentPaid').checked = Boolean(paid);
                    this.submitForm('paymentForm');
                    return !document.getElementById('paymentModal').classList.contains('active');
                },
                storageKey: 'pengurusBayaranData_v1'
            };
            true;
        `;

        async function addHelpers() {
            await evaluate(HELPERS);
        }

        async function waitForApp() {
            await waitFor(
                () => evaluate("document.readyState === 'complete' && !!window.PengurusBayaran && !!window.PBLib"),
                'aplikasi dimuatkan'
            );
            await addHelpers();
        }

        const steps = [];
        function step(name, fn) {
            steps.push({ name, fn });
        }
        let passed = 0;

        /* ---------------- Langkah ujian ---------------- */

        step('Halaman dimuat dan dilokalkan ke Bahasa Melayu', async () => {
            await waitForApp();

            const info = await evaluate(`({
                lang: document.documentElement.lang,
                title: document.title,
                heading: document.querySelector('h1').textContent.trim(),
                subtitle: document.querySelector('.subtitle').textContent.trim(),
                monthOptions: Array.from(document.querySelectorAll('#monthSelect option')).map((o) => o.textContent.trim()),
                monthMatchesLocale: (() => {
                    const months = PengurusBayaran.getMonths();
                    const key = PengurusBayaran.getCurrentMonthKey();
                    const data = months[key];
                    return document.querySelector('#monthSelect option').textContent.trim() === PBLib.monthLabel(data.month, data.year);
                })(),
                summaryLabels: Array.from(document.querySelectorAll('.summary-label')).map((el) => el.textContent.trim()),
                buttons: Array.from(document.querySelectorAll('.controls button')).map((b) => b.textContent.trim()),
                emptyText: document.querySelector('.empty-state').textContent.trim(),
                summary: window.__t.summary(),
                forbidden: ['Add Payment', 'New Month', 'Cancel', 'Save', 'Paid', 'Unpaid', 'Total Payments',
                    'Filter by', 'Sort by', 'Create New Month', 'Payment Date', 'Monthly Commitment', 'Export']
                    .filter((word) => document.body.innerText.includes(word))
            })`);

            assert.equal(info.lang, 'ms');
            assert.match(info.title, /Pengurus Bayaran/);
            assert.equal(info.heading, '💰 Pengurus Bayaran');
            assert.equal(info.subtitle, 'Urus bayaran bulanan anda dengan mudah');
            assert.equal(info.monthOptions.length, 1);
            assert.equal(info.monthMatchesLocale, true);
            assert.match(info.monthOptions[0], /^(Januari|Februari|Mac|April|Mei|Jun|Julai|Ogos|September|Oktober|November|Disember) \d{4}$/);
            assert.deepEqual(info.summaryLabels, [
                'Bilangan Bayaran', 'Jumlah Keseluruhan', 'Sudah Dibayar', 'Jumlah Bulanan',
                'Jumlah Tambahan', 'Amaun Dibayar', 'Amaun Belum Dibayar'
            ]);
            // Butang "Pasang Aplikasi" boleh muncul jika pelayar menawarkan pemasangan PWA.
            assert.deepEqual(info.buttons.filter((text) => !text.includes('Pasang Aplikasi')),
                ['➕ Bulan Baharu', 'Tambah Bayaran', '💾 Eksport', '📂 Import']);
            assert.match(info.emptyText, /Belum ada bayaran/);
            assert.deepEqual(info.summary, {
                totalCount: '0', totalAmount: 'RM 0.00', paidCount: '0', monthlyTotal: 'RM 0.00',
                extraTotal: 'RM 0.00', paidAmount: 'RM 0.00', unpaidAmount: 'RM 0.00'
            });
            assert.deepEqual(info.forbidden, [], 'Teks Inggeris tertinggal: ' + info.forbidden.join(', '));
        });

        step('Tambah bayaran melalui borang', async () => {
            const result = await evaluate(`(() => {
                window.__t.clickButton('Tambah Bayaran');
                const modalOpen = document.getElementById('paymentModal').classList.contains('active');
                const modalTitle = document.getElementById('modalTitle').textContent.trim();
                const dateDefault = document.getElementById('paymentDate').value;
                window.__t.submitForm('paymentForm');
                const stillOpenEmpty = document.getElementById('paymentModal').classList.contains('active');

                document.getElementById('paymentTitle').value = 'Bil Elektrik';
                document.getElementById('paymentAmount').value = '75.90';
                document.getElementById('paymentDate').value = '2026-10-05';
                document.getElementById('paymentType').value = 'monthly';
                document.getElementById('paymentPaid').checked = true;
                window.__t.submitForm('paymentForm');

                const item = window.__t.itemByTitle('Bil Elektrik');
                return {
                    modalOpen, modalTitle, dateDefault, stillOpenEmpty,
                    closedAfterSave: !document.getElementById('paymentModal').classList.contains('active'),
                    count: window.__t.items().length,
                    itemText: item ? item.innerText : null,
                    summary: window.__t.summary(),
                    stored: JSON.parse(localStorage.getItem(window.__t.storageKey) || '{}')
                };
            })()`);

            assert.equal(result.modalOpen, true);
            assert.equal(result.modalTitle, 'Tambah Bayaran');
            assert.match(result.dateDefault, /^\d{4}-\d{2}-\d{2}$/);
            assert.equal(result.stillOpenEmpty, true, 'Borang kosong tidak sepatutnya dihantar');
            assert.equal(result.closedAfterSave, true);
            assert.equal(result.count, 1);
            assert.match(result.itemText, /Bil Elektrik/);
            assert.match(result.itemText, /5 Oktober 2026/);
            assert.match(result.itemText, /Bulanan/);
            assert.match(result.itemText, /Sudah Dibayar/);
            assert.match(result.itemText, /RM 75\.90/);
            assert.deepEqual(result.summary, {
                totalCount: '1', totalAmount: 'RM 75.90', paidCount: '1', monthlyTotal: 'RM 75.90',
                extraTotal: 'RM 0.00', paidAmount: 'RM 75.90', unpaidAmount: 'RM 0.00'
            });
            const monthKey = Object.keys(result.stored)[0];
            assert.equal(result.stored[monthKey].lists.length, 1);
            assert.equal(result.stored[monthKey].lists[0].title, 'Bil Elektrik');
        });

        step('Tambah bayaran tambahan yang belum dibayar', async () => {
            const result = await evaluate(`(() => {
                window.__t.addPayment({ title: 'Servis Kereta', amount: 20, date: '2026-10-12', type: 'extra', paid: false });
                return {
                    count: window.__t.items().length,
                    titles: window.__t.titles(),
                    firstIsUnpaid: window.__t.items()[0].innerText.includes('Belum Dibayar'),
                    summary: window.__t.summary()
                };
            })()`);

            assert.equal(result.count, 2);
            assert.equal(result.firstIsUnpaid, true, 'Susunan lalai meletakkan belum dibayar dahulu');
            assert.ok(result.titles.includes('Bil Elektrik'));
            assert.ok(result.titles.includes('Servis Kereta'));
            assert.deepEqual(result.summary, {
                totalCount: '2', totalAmount: 'RM 95.90', paidCount: '1', monthlyTotal: 'RM 75.90',
                extraTotal: 'RM 20.00', paidAmount: 'RM 75.90', unpaidAmount: 'RM 20.00'
            });
        });

        step('Tapis ikut jenis dan status', async () => {
            const result = await evaluate(`(() => {
                const out = {};
                window.__t.setSelect('filterType', 'extra');
                out.extra = window.__t.titles();
                window.__t.setSelect('filterType', 'monthly');
                out.monthly = window.__t.titles();
                window.__t.setSelect('filterType', 'all');
                window.__t.setSelect('filterStatus', 'paid');
                out.paid = window.__t.titles();
                window.__t.setSelect('filterStatus', 'unpaid');
                out.unpaid = window.__t.titles();
                window.__t.setSelect('filterType', 'extra');
                out.extraUnpaid = window.__t.titles();
                window.__t.setSelect('filterType', 'monthly');
                out.monthlyUnpaid = window.__t.items().length;
                out.emptyMessage = document.querySelector('.empty-state') ? document.querySelector('.empty-state').textContent.trim() : null;
                // Ringkasan mesti kekal menunjukkan semua bayaran, bukan hasil tapisan.
                out.summary = window.__t.summary();
                window.__t.setSelect('filterType', 'all');
                window.__t.setSelect('filterStatus', 'all');
                return out;
            })()`);

            assert.deepEqual(result.extra, ['Servis Kereta']);
            assert.deepEqual(result.monthly, ['Bil Elektrik']);
            assert.deepEqual(result.paid, ['Bil Elektrik']);
            assert.deepEqual(result.unpaid, ['Servis Kereta']);
            assert.deepEqual(result.extraUnpaid, ['Servis Kereta']);
            assert.equal(result.monthlyUnpaid, 0);
            assert.match(result.emptyMessage, /Tiada bayaran yang sepadan/);
            assert.equal(result.summary.totalCount, '2', 'Ringkasan tidak sepatutnya berubah dengan tapisan');
        });

        step('Susun ikut amaun, nama dan tarikh', async () => {
            const result = await evaluate(`(() => {
                const out = {};
                window.__t.setSelect('sortBy', 'amount-desc');
                out.amountDesc = window.__t.titles();
                window.__t.setSelect('sortBy', 'amount');
                out.amountAsc = window.__t.titles();
                window.__t.setSelect('sortBy', 'title');
                out.titleAsc = window.__t.titles();
                window.__t.setSelect('sortBy', 'title-desc');
                out.titleDesc = window.__t.titles();
                window.__t.setSelect('sortBy', 'date');
                out.dateAsc = window.__t.titles();
                window.__t.setSelect('sortBy', 'status');
                return out;
            })()`);

            assert.deepEqual(result.amountDesc, ['Bil Elektrik', 'Servis Kereta']);
            assert.deepEqual(result.amountAsc, ['Servis Kereta', 'Bil Elektrik']);
            assert.deepEqual(result.titleAsc, ['Bil Elektrik', 'Servis Kereta']);
            assert.deepEqual(result.titleDesc, ['Servis Kereta', 'Bil Elektrik']);
            assert.deepEqual(result.dateAsc, ['Bil Elektrik', 'Servis Kereta']);
        });

        step('Paparan dan tapisan kalendar Hijrah berfungsi', async () => {
            const result = await evaluate(`(() => {
                const out = {};
                const dateOf = (title) => window.__t.itemByTitle(title)
                    .querySelector('.payment-date').textContent.trim();

                // Tarikh Hijrah hari ini di bawah tajuk.
                const today = document.getElementById('todayHijri');
                out.todayHidden = today.hidden;
                out.todayText = today.textContent.trim();

                // Tarikh Hijrah tersembunyi secara lalai.
                out.gregorianOnly = dateOf('Bil Elektrik');
                out.hasHijriByDefault = out.gregorianOnly.includes('H');

                // Hidupkan paparan Hijrah: 5 Okt 2026 = 24 Rabiulakhir 1448H.
                document.getElementById('showHijriDates').checked = true;
                window.applyFiltersAndSort();
                out.withHijri = dateOf('Bil Elektrik');
                out.hasHijriAfterToggle = out.withHijri.includes('24 Rabiulakhir 1448H');
                out.hasParentheses = out.withHijri.includes('(') && out.withHijri.includes(')');

                // 12 Okt 2026 = 1 Jamadilawal 1448H.
                out.extraWithHijri = dateOf('Servis Kereta');
                out.hasJamadilawal = out.extraWithHijri.includes('1 Jamadilawal 1448H');

                // Penapis: 13 pilihan (Semua + 12 bulan).
                out.filterSelect = document.getElementById('filterHijriMonth').options.length;

                // Tapis mengikut bulan Hijrah sebenar bagi tarikh ujian.
                window.__t.setSelect('filterHijriMonth', '4');
                out.rabiulakhir = window.__t.titles();

                window.__t.setSelect('filterHijriMonth', '5');
                out.jamadilawal = window.__t.titles();

                window.__t.setSelect('filterHijriMonth', '9');
                out.ramadan = window.__t.titles();

                window.__t.setSelect('filterHijriMonth', 'all');
                out.allMonthsCount = window.__t.items().length;

                // Matikan paparan Hijrah.
                document.getElementById('showHijriDates').checked = false;
                window.applyFiltersAndSort();
                out.gregorianOnlyAgain = dateOf('Bil Elektrik').includes('H');

                return out;
            })()`);

            assert.equal(result.todayHidden, false, 'Tarikh Hijrah hari ini mesti dipaparkan');
            assert.ok(result.todayText.includes('Hari ini') && result.todayText.includes('H'),
                'Tarikh Hijrah hari ini mesti mengandungi "Hari ini" dan penanda "H"');
            assert.equal(result.hasHijriByDefault, false, 'Tarikh Hijrah tidak sepatutnya dipaparkan secara lalai');
            assert.equal(result.hasHijriAfterToggle, true, 'Tarikh Hijrah mesti dipaparkan selepas toggle');
            assert.equal(result.hasParentheses, true, 'Tarikh Hijrah mesti dalam kurungan');
            assert.equal(result.hasJamadilawal, true, 'Tarikh 2026-10-12 mesti menjadi 1 Jamadilawal 1448H');
            assert.equal(result.filterSelect, 13, 'Penapis Hijrah mesti mempunyai 13 pilihan (Semua + 12 bulan)');
            assert.deepEqual(result.rabiulakhir, ['Bil Elektrik'], 'Penapis Rabiulakhir mesti tinggalkan Bil Elektrik sahaja');
            assert.deepEqual(result.jamadilawal, ['Servis Kereta'], 'Penapis Jamadilawal mesti tinggalkan Servis Kereta sahaja');
            assert.deepEqual(result.ramadan, [], 'Tiada bayaran dalam bulan Ramadan');
            assert.equal(result.allMonthsCount, 2, 'Semua bayaran mesti dipaparkan tanpa tapisan');
            assert.equal(result.gregorianOnlyAgain, false, 'Tarikh Hijrah tidak sepatutnya dipaparkan selepas tutup toggle');
        });

        step('Sunting bayaran sedia ada', async () => {
            const result = await evaluate(`(() => {
                const item = window.__t.itemByTitle('Bil Elektrik');
                const button = Array.from(item.querySelectorAll('button')).find((b) => b.textContent.includes('Sunting'));
                button.click();
                const out = {
                    open: document.getElementById('paymentModal').classList.contains('active'),
                    title: document.getElementById('modalTitle').textContent.trim(),
                    formTitle: document.getElementById('paymentTitle').value,
                    formAmount: document.getElementById('paymentAmount').value,
                    formType: document.getElementById('paymentType').value,
                    formPaid: document.getElementById('paymentPaid').checked,
                    formDate: document.getElementById('paymentDate').value
                };
                document.getElementById('paymentTitle').value = 'Bil Elektrik Baru';
                document.getElementById('paymentAmount').value = '80';
                window.__t.submitForm('paymentForm');
                out.count = window.__t.items().length;
                out.renamed = window.__t.titles();
                out.summary = window.__t.summary();
                return out;
            })()`);

            assert.equal(result.open, true);
            assert.equal(result.title, 'Edit Bayaran');
            assert.equal(result.formTitle, 'Bil Elektrik');
            assert.equal(result.formAmount, '75.9');
            assert.equal(result.formType, 'monthly');
            assert.equal(result.formPaid, true);
            assert.equal(result.formDate, '2026-10-05');
            assert.equal(result.count, 2, 'Sunting tidak boleh menambah bayaran');
            assert.ok(result.renamed.includes('Bil Elektrik Baru'));
            assert.equal(result.summary.totalAmount, 'RM 100.00');
            assert.equal(result.summary.paidAmount, 'RM 80.00');
            assert.equal(result.summary.unpaidAmount, 'RM 20.00');
        });

        step('Padam bayaran (dengan pengesahan)', async () => {
            const result = await evaluate(`(() => {
                const originalConfirm = window.confirm;
                window.confirm = () => false;
                const keepItem = window.__t.itemByTitle('Servis Kereta');
                Array.from(keepItem.querySelectorAll('button')).find((b) => b.textContent.includes('🗑')).click();
                const afterCancel = window.__t.items().length;

                window.confirm = () => true;
                const deleteItem = window.__t.itemByTitle('Servis Kereta');
                Array.from(deleteItem.querySelectorAll('button')).find((b) => b.textContent.includes('🗑')).click();
                const out = {
                    afterCancel,
                    afterDelete: window.__t.items().length,
                    titles: window.__t.titles(),
                    summary: window.__t.summary()
                };
                window.confirm = originalConfirm;
                return out;
            })()`);

            assert.equal(result.afterCancel, 2, 'Batal padam tidak boleh mengubah data');
            assert.equal(result.afterDelete, 1);
            assert.deepEqual(result.titles, ['Bil Elektrik Baru']);
            assert.deepEqual(result.summary, {
                totalCount: '1', totalAmount: 'RM 80.00', paidCount: '1', monthlyTotal: 'RM 80.00',
                extraTotal: 'RM 0.00', paidAmount: 'RM 80.00', unpaidAmount: 'RM 0.00'
            });
        });

        step('Cipta bulan baharu dan salin komitmen bulanan', async () => {
            const result = await evaluate(`(() => {
                const monthsBefore = Object.keys(PengurusBayaran.getMonths());
                const now = new Date();
                const months = PBLib.MONTHS_EN;
                let target = null;
                for (let year = 2030; year <= 2035 && !target; year++) {
                    for (let m = 11; m >= 0; m--) {
                        const key = months[m] + '_' + year;
                        if (!monthsBefore.includes(key)) { target = { key, month: months[m], year }; break; }
                    }
                }
                window.__t.clickButton('Bulan Baharu');
                const out = {
                    target,
                    modalOpen: document.getElementById('newMonthModal').classList.contains('active'),
                    monthOptionCount: document.querySelectorAll('#newMonth option').length,
                    firstMonthOption: document.querySelector('#newMonth option').textContent.trim(),
                    lastMonthOption: Array.from(document.querySelectorAll('#newMonth option')).pop().textContent.trim()
                };
                document.getElementById('newMonth').value = target.month;
                document.getElementById('newYear').value = String(target.year);
                window.__t.submitForm('newMonthForm');

                out.modalClosed = !document.getElementById('newMonthModal').classList.contains('active');
                out.currentKey = PengurusBayaran.getCurrentMonthKey();
                out.selectedOption = document.getElementById('monthSelect').selectedOptions[0].textContent.trim();
                out.optionCount = document.querySelectorAll('#monthSelect option').length;
                out.titles = window.__t.titles();
                out.summary = window.__t.summary();
                out.itemText = window.__t.items()[0] ? window.__t.items()[0].innerText : null;
                out.newMonthRecord = PengurusBayaran.getMonths()[target.key];
                return out;
            })()`);

            assert.equal(result.modalOpen, true);
            assert.equal(result.monthOptionCount, 12);
            assert.equal(result.firstMonthOption, 'Januari');
            assert.equal(result.lastMonthOption, 'Disember');
            assert.equal(result.modalClosed, true);
            assert.equal(result.currentKey, result.target.key);
            assert.match(result.selectedOption, /^[A-Za-z]+ \d{4}$/);
            assert.equal(result.optionCount, 2);
            assert.deepEqual(result.titles, ['Bil Elektrik Baru'], 'Hanya komitmen bulanan disalin');
            assert.match(result.itemText, /Belum Dibayar/);
            assert.equal(result.newMonthRecord.lists[0].payDate, `${result.target.year}-${String(L.monthIndex(result.target.month) + 1).padStart(2, '0')}-01`);
            assert.deepEqual(result.summary, {
                totalCount: '1', totalAmount: 'RM 80.00', paidCount: '0', monthlyTotal: 'RM 80.00',
                extraTotal: 'RM 0.00', paidAmount: 'RM 0.00', unpaidAmount: 'RM 80.00'
            });
        });

        step('Data kekal selepas muat semula halaman', async () => {
            await evaluate('location.reload(); true');
            await waitForApp();
            const result = await waitFor(async () => {
                const state = await evaluate(`(() => {
                    const months = PengurusBayaran.getMonths();
                    return {
                        monthCount: Object.keys(months).length,
                        currentKey: PengurusBayaran.getCurrentMonthKey(),
                        titles: window.__t.titles(),
                        summary: window.__t.summary(),
                        stored: JSON.parse(localStorage.getItem('pengurusBayaranData_v1') || '{}')
                    };
                })()`);
                return state.titles.length > 0 ? state : null;
            }, 'senarai selepas muat semula');

            assert.equal(result.monthCount, 2);
            assert.deepEqual(result.titles, ['Bil Elektrik Baru']);
            assert.equal(result.summary.totalAmount, 'RM 80.00');
            assert.equal(Object.keys(result.stored).length, 2);
        });

        step('Eksport menghasilkan fail JSON yang lengkap', async () => {
            const result = await evaluate(`(async () => {
                window.__dl = {};
                window.__blob = null;
                HTMLAnchorElement.prototype.click = function () {
                    window.__dl.download = this.download;
                    window.__dl.href = this.href;
                };
                const originalCreate = URL.createObjectURL;
                URL.createObjectURL = (blob) => { window.__blob = blob; return 'blob:test'; };
                window.exportData();
                URL.createObjectURL = originalCreate;
                const text = await window.__blob.text();
                const months = PengurusBayaran.getMonths();
                return {
                    download: window.__dl.download,
                    monthsInApp: Object.keys(months).length,
                    parsed: JSON.parse(text),
                    text
                };
            })()`);

            assert.equal(result.download, 'data-pengurus-bayaran.json');
            assert.equal(Object.keys(result.parsed).length, result.monthsInApp);
            assert.equal(result.text.includes('Bil Elektrik Baru'), true);
        });

        step('Import menggantikan data dan mengendalikan fail tidak sah', async () => {
            const importWith = `
                async (payload) => {
                    const originalAlert = window.alert;
                    const alerts = [];
                    window.alert = (message) => { alerts.push(String(message)); };
                    window.confirm = () => true;
                    const file = new File([payload], 'data.json', { type: 'application/json' });
                    const transfer = new DataTransfer();
                    transfer.items.add(file);
                    const input = document.getElementById('importFile');
                    input.files = transfer.files;
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    const deadline = Date.now() + 5000;
                    while (alerts.length === 0 && Date.now() < deadline) {
                        await new Promise((resolve) => setTimeout(resolve, 50));
                    }
                    await new Promise((resolve) => setTimeout(resolve, 100));
                    window.alert = originalAlert;
                    return {
                        alerts,
                        monthCount: Object.keys(PengurusBayaran.getMonths()).length,
                        currentKey: PengurusBayaran.getCurrentMonthKey(),
                        titles: window.__t.titles(),
                        summary: window.__t.summary(),
                        selectedOption: document.getElementById('monthSelect').selectedOptions[0]?.textContent.trim() || null,
                        inputCleared: document.getElementById('importFile').value === ''
                    };
                }
            `;

            const validPayload = JSON.stringify({
                March_2027: {
                    month: 'March',
                    year: 2027,
                    topic: 'Mac 2027 — bayaran bulanan',
                    lists: [
                        { id: 1, title: 'Sewa Rumah', amount: 950, payDate: '2027-03-01', paid: true, type: 'monthly' }
                    ]
                }
            });
            await evaluate(`window.__importTest = ${importWith}`);
            const valid = await evaluate(`window.__importTest(${JSON.stringify(validPayload)})`);

            assert.deepEqual(valid.alerts, ['Data berjaya diimport.']);
            assert.equal(valid.monthCount, 1);
            assert.equal(valid.currentKey, 'March_2027');
            assert.equal(valid.selectedOption, 'Mac 2027');
            assert.deepEqual(valid.titles, ['Sewa Rumah']);
            assert.equal(valid.summary.totalAmount, 'RM 950.00');
            assert.equal(valid.inputCleared, true);

            // Fail tidak sah: data semasa mesti kekal.
            const invalid = await evaluate(`window.__importTest('{ ini bukan json }')`);
            assert.equal(invalid.monthCount, 1);
            assert.equal(invalid.currentKey, 'March_2027');
            assert.deepEqual(invalid.titles, ['Sewa Rumah']);
            assert.match(invalid.alerts[0], /^Ralat semasa mengimport fail:/);

            // Pengguna membatalkan pengesahan: data semasa mesti kekal.
            const cancelled = await evaluate(`(async () => {
                const originalConfirm = window.confirm;
                window.confirm = () => false;
                const originalAlert = window.alert;
                let alerted = false;
                window.alert = () => { alerted = true; };
                const file = new File([JSON.stringify({ April_2027: { month: 'April', year: 2027, lists: [] } })], 'x.json', { type: 'application/json' });
                const transfer = new DataTransfer();
                transfer.items.add(file);
                const input = document.getElementById('importFile');
                input.files = transfer.files;
                input.dispatchEvent(new Event('change', { bubbles: true }));
                await new Promise((resolve) => setTimeout(resolve, 300));
                window.confirm = originalConfirm;
                window.alert = originalAlert;
                return {
                    monthCount: Object.keys(PengurusBayaran.getMonths()).length,
                    currentKey: PengurusBayaran.getCurrentMonthKey(),
                    alerted
                };
            })()`);
            assert.equal(cancelled.monthCount, 1);
            assert.equal(cancelled.currentKey, 'March_2027');
            assert.equal(cancelled.alerted, false);
        });

        step('Manifest PWA dan service worker berfungsi', async () => {
            const manifest = await evaluate(`fetch('manifest.json').then((r) => r.json())`);
            assert.match(manifest.name, /Pengurus Bayaran/);
            assert.equal(manifest.lang, 'ms');
            assert.equal(manifest.icons.length, 4);
            assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'), 'ikon maskable diperlukan');
            assert.equal(manifest.theme_color, '#0e5c46');
            assert.equal(manifest.start_url, './');

            const sw = await waitFor(
                () => evaluate(`navigator.serviceWorker.getRegistration().then((r) => r ? { scope: r.scope, active: !!r.active } : null)`),
                'service worker berdaftar',
                20000
            );
            assert.equal(sw.active, true);
            assert.match(sw.scope, new RegExp(`127\\.0\\.0\\.1:${httpPort}`));

            // Aset penting mesti boleh diambil (cache shell).
            const assets = await evaluate(`Promise.all(['index.html', 'styles.css', 'lib.js', 'app.js', 'manifest.json', 'icons/icon-192.png',
                'icons/icon.svg', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'social/og-card.png']
                .map((path) => fetch(path).then((r) => r.status)))`);
            assert.deepEqual(assets, [200, 200, 200, 200, 200, 200, 200, 200, 200, 200]);
        });

        for (const { name, fn } of steps) {
            console.log(`→ ${name}`);
            await fn();
            passed++;
            console.log(`✔ ${name}`);
        }

        console.log(`\n${passed}/${steps.length} langkah lulus.`);
    } finally {
        if (cdp) cdp.close();
        chrome.kill();
        server.close();
        await sleep(300);
        await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    }
}

main().catch((error) => {
    console.error('\n✖ Ujian gagal:', error.message);
    console.error(error.stack);
    process.exitCode = 1;
});
