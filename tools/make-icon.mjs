/*
 * Ikon dan kad jenama Pengurus Bayaran.
 *
 * Menjana ikon vektor (bintang lapan / khatam, hijau + emas) sekali dan
 * merasterkannya ke semua saiz yang PWA perlukan, kemudian kad OG 1200x630.
 * Ikon dilukis sendiri (tiada imej pihak ketiga), jadi tiada kredit tambahan.
 *
 * Jalankan: node tools/make-icon.mjs
 */
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ICONS = path.join(ROOT, 'icons');
const SOCIAL = path.join(ROOT, 'social');

const CHROME_CANDIDATES = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
];

const GREEN_DARK = '#07382A';
const GREEN = '#0E5C46';
const GREEN_LIGHT = '#15805F';
const GOLD = '#D4AF37';
const GOLD_LIGHT = '#F3DD94';
const GOLD_DARK = '#A8821B';

function findChrome() {
    const candidates = process.env.CHROME_PATH ? [process.env.CHROME_PATH, ...CHROME_CANDIDATES] : CHROME_CANDIDATES;
    const found = candidates.find((candidate) => existsSync(candidate));
    if (!found) throw new Error('Chrome/Edge tidak dijumpai. Set CHROME_PATH.');
    return found;
}

// Titik bintang n-punjur: jejari luar dan dalam berselang-seli.
function starPoints(cx, cy, outer, inner, points = 8) {
    const pts = [];
    for (let i = 0; i < points * 2; i += 1) {
        const r = i % 2 === 0 ? outer : inner;
        const a = (-Math.PI / 2) + (i * Math.PI) / points;
        pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
    }
    return pts.join(' ');
}

function defs() {
    return `
    <defs>
        <radialGradient id="bg" cx="44%" cy="32%" r="82%">
            <stop offset="0" stop-color="${GREEN_LIGHT}"/>
            <stop offset="0.55" stop-color="${GREEN}"/>
            <stop offset="1" stop-color="${GREEN_DARK}"/>
        </radialGradient>
        <linearGradient id="gold" x1="0.1" y1="0" x2="0.9" y2="1">
            <stop offset="0" stop-color="#F7E7AE"/>
            <stop offset="0.35" stop-color="${GOLD}"/>
            <stop offset="0.7" stop-color="${GOLD_DARK}"/>
            <stop offset="1" stop-color="#E4C56A"/>
        </linearGradient>
        <linearGradient id="goldText" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#FFF0C2"/>
            <stop offset="0.55" stop-color="${GOLD_LIGHT}"/>
            <stop offset="1" stop-color="${GOLD}"/>
        </linearGradient>
        <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#02241A" flood-opacity="0.45"/>
        </filter>
    </defs>`;
}

// Latar geometri: garis kekisi pepenjuru + empat bintang kecil di penjuru.
function lattice() {
    const lines = [];
    for (let i = -512; i <= 1024; i += 64) {
        lines.push(`<line x1="${i}" y1="0" x2="${i + 512}" y2="512"/>`);
        lines.push(`<line x1="${i}" y1="512" x2="${i + 512}" y2="0"/>`);
    }
    const stars = [[92, 92], [420, 92], [92, 420], [420, 420]]
        .map(([x, y]) => `<polygon points="${starPoints(x, y, 30, 13)}" fill="none" stroke="${GOLD_LIGHT}" stroke-opacity="0.30" stroke-width="2.5"/>`)
        .join('\n        ');
    return `
    <rect width="512" height="512" fill="url(#bg)"/>
    <g stroke="${GOLD_LIGHT}" stroke-opacity="0.055" stroke-width="1.5">
        ${lines.join('\n        ')}
    </g>
    <circle cx="256" cy="256" r="200" fill="none" stroke="${GOLD_LIGHT}" stroke-opacity="0.20" stroke-width="2"/>
    ${stars}`;
}

// Lambang pusat: bintang lapan (khatam) emas dengan syiling "RM" hijau di tengah.
function emblem() {
    return `
    <g filter="url(#soft)">
        <polygon points="${starPoints(256, 256, 240, 164)}" fill="url(#gold)"/>
        <polygon points="${starPoints(256, 256, 196, 134)}" fill="none" stroke="${GOLD_LIGHT}" stroke-opacity="0.55" stroke-width="2"/>
    </g>
    <circle cx="256" cy="256" r="122" fill="${GREEN_DARK}"/>
    <circle cx="256" cy="256" r="122" fill="none" stroke="url(#gold)" stroke-width="7"/>
    <circle cx="256" cy="256" r="108" fill="none" stroke="${GOLD_LIGHT}" stroke-opacity="0.45" stroke-width="1.6"/>
    <text x="256" y="291" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="92" font-weight="700" letter-spacing="1" fill="url(#goldText)">RM</text>`;
}

function iconSvg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 512 512" role="img" aria-label="Pengurus Bayaran">
    ${defs()}
    ${lattice()}
    ${emblem()}
</svg>`;
}

// Versi maskable: kandungan dikecilkan ke 78% supaya selamat apabila Android memotong bulatan.
function maskableSvg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 512 512" role="img" aria-label="Pengurus Bayaran">
    ${defs()}
    ${lattice()}
    <g transform="translate(256 256) scale(0.78) translate(-256 -256)">
        ${emblem()}
    </g>
</svg>`;
}

function ogSvg() {
    const lines = [];
    for (let i = -700; i <= 1500; i += 70) {
        lines.push(`<line x1="${i}" y1="0" x2="${i + 630}" y2="630"/>`);
        lines.push(`<line x1="${i}" y1="630" x2="${i + 630}" y2="0"/>`);
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 1200 630" role="img" aria-label="Pengurus Bayaran">
    ${defs()}
    <rect width="1200" height="630" fill="url(#bg)"/>
    <g stroke="${GOLD_LIGHT}" stroke-opacity="0.06" stroke-width="1.6">${lines.join('')}</g>
    <g transform="translate(236 315) scale(0.66) translate(-256 -256)">
        <g>${emblem()}</g>
    </g>
    <g fill="${GOLD_LIGHT}">
        <text x="440" y="292" font-family="Georgia, 'Times New Roman', serif" font-size="76" font-weight="700">Pengurus Bayaran</text>
        <text x="443" y="348" font-family="'Segoe UI', Arial, sans-serif" font-size="32" fill-opacity="0.92">Urus bayaran bulanan anda dengan mudah</text>
        <text x="443" y="404" font-family="'Segoe UI', Arial, sans-serif" font-size="24" fill-opacity="0.68">Bahasa Melayu · Ringgit Malaysia · Kalendar Hijrah · Kalkulator Zakat</text>
    </g>
    <rect x="443" y="432" width="120" height="6" rx="3" fill="url(#gold)"/>
</svg>`;
}

// Chrome di Windows mempunyai lebar tetingkap minimum, jadi tangkapan skrin dilakukan
// melalui CDP dengan metrik peranti yang tepat (bukan --window-size).
function launchChrome(executable, userDataDir) {
    return new Promise((resolve, reject) => {
        const child = spawn(executable, [
            '--headless=new',
            '--disable-gpu',
            '--no-first-run',
            '--no-default-browser-check',
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function screenshot(cdp, url, width, height, out) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url });
    await sleep(350);
    const { data } = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: 0, y: 0, width, height, scale: 1 }
    });
    await writeFile(out, Buffer.from(data, 'base64'));
}

async function main() {
    const chrome = findChrome();
    await mkdir(ICONS, { recursive: true });
    await mkdir(SOCIAL, { recursive: true });

    const iconFile = path.join(ICONS, 'icon.svg');
    const maskableFile = path.join(ICONS, 'icon-maskable.svg');
    const ogFile = path.join(SOCIAL, 'og-card.svg');
    await writeFile(iconFile, iconSvg(), 'utf8');
    await writeFile(maskableFile, maskableSvg(), 'utf8');
    await writeFile(ogFile, ogSvg(), 'utf8');
    console.log('SVG ditulis: icons/icon.svg, icons/icon-maskable.svg, social/og-card.svg');

    const userDataDir = path.join(os.tmpdir(), `pengurus-bayaran-brand-${process.pid}`);
    await rm(userDataDir, { recursive: true, force: true });
    const { child: chromeProcess, port } = await launchChrome(chrome, userDataDir);
    const targetResponse = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
    const target = await targetResponse.json();
    const cdp = await connectCdp(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');

    const jobs = [
        [iconFile, 512, 512, path.join(ICONS, 'icon-512.png')],
        [iconFile, 192, 192, path.join(ICONS, 'icon-192.png')],
        [iconFile, 180, 180, path.join(ICONS, 'apple-touch-icon.png')],
        [iconFile, 32, 32, path.join(ICONS, 'favicon-32.png')],
        [maskableFile, 512, 512, path.join(ICONS, 'icon-maskable-512.png')],
        [ogFile, 1200, 630, path.join(SOCIAL, 'og-card.png')]
    ];

    for (const [file, width, height, out] of jobs) {
        const url = `file:///${file.replace(/\\/g, '/')}`;
        await screenshot(cdp, url, width, height, out);
        console.log(`  ${path.relative(ROOT, out)} (${width}x${height})`);
    }
    cdp.close();
    chromeProcess.kill();
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    console.log('Selesai. Ikon dan kad OG dijana daripada SVG.');
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
