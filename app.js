/*
 * Pengurus Bayaran — antara muka dan penyimpanan (localStorage)
 * Berdasarkan "Payment Manager" daripada personal-efficiency-machine (Farid Rameli).
 * Lesen: MIT — lihat LICENSE.
 */
'use strict';

const L = window.PBLib;
const STORAGE_KEY = 'pengurusBayaranData_v1';

let allMonths = {};
let currentMonthKey = null;
let editingPaymentId = null;

// Keadaan tapisan dan susunan
let filterType = 'all';
let filterStatus = 'all';
let sortBy = 'status';

function $(id) {
    return document.getElementById(id);
}

/* ---------- Data ---------- */

function loadData() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            allMonths = L.migratePaymentData(JSON.parse(saved));
            return;
        }
    } catch (error) {
        console.warn('Gagal membaca data tersimpan:', error);
    }
    allMonths = {};
}

function saveData() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(allMonths));
    } catch (error) {
        console.warn('Gagal menyimpan data:', error);
    }
}

// Jika belum ada bulan, cipta bulan semasa supaya aplikasi terus boleh digunakan.
function ensureCurrentMonth() {
    const latest = L.mostRecentMonthKey(allMonths);
    if (latest) {
        currentMonthKey = latest;
        return;
    }

    const now = new Date();
    const monthEn = L.MONTHS_EN[now.getMonth()];
    const year = now.getFullYear();
    const key = L.monthKey(monthEn, year);
    allMonths[key] = L.createMonthRecord(monthEn, year, []);
    currentMonthKey = key;
    saveData();
}

/* ---------- Paparan ---------- */

function populateMonthSelector() {
    const select = $('monthSelect');
    select.textContent = '';

    const keys = Object.keys(allMonths).sort(function (a, b) {
        const A = allMonths[a];
        const B = allMonths[b];
        if (A.year !== B.year) return A.year - B.year;
        return L.monthIndex(A.month) - L.monthIndex(B.month);
    });

    keys.forEach(function (key) {
        const data = allMonths[key];
        const option = document.createElement('option');
        option.value = key;
        option.textContent = L.monthLabel(data.month, data.year);
        if (key === currentMonthKey) option.selected = true;
        select.appendChild(option);
    });
}

function updateSummary(summary) {
    const totals = summary || {
        totalCount: 0,
        totalAmount: 0,
        paidCount: 0,
        monthlyTotal: 0,
        extraTotal: 0,
        paidAmount: 0,
        unpaidAmount: 0
    };

    $('totalCount').textContent = String(totals.totalCount);
    $('totalAmount').textContent = L.formatRM(totals.totalAmount);
    $('paidCount').textContent = String(totals.paidCount);
    $('monthlyTotal').textContent = L.formatRM(totals.monthlyTotal);
    $('extraTotal').textContent = L.formatRM(totals.extraTotal);
    $('paidAmount').textContent = L.formatRM(totals.paidAmount);
    $('unpaidAmount').textContent = L.formatRM(totals.unpaidAmount);
}

function formatDate(value) {
    if (!value) return 'Tiada tarikh ditetapkan';
    const date = new Date(value + 'T00:00:00');
    if (isNaN(date.getTime())) return String(value);
    try {
        return date.toLocaleDateString('ms-MY', { year: 'numeric', month: 'long', day: 'numeric' });
    } catch (error) {
        return String(value);
    }
}

function emptyState(text) {
    const p = document.createElement('p');
    p.className = 'empty-state';
    p.textContent = text;
    return p;
}

function paymentTypeLabel(paymentType) {
    return paymentType === 'extra' ? 'Tambahan' : 'Bulanan';
}

function buildPaymentItem(payment) {
    const paymentType = payment.type || 'monthly';
    const typeClass = paymentType === 'extra' ? 'type-extra' : 'type-monthly';

    const item = document.createElement('div');
    item.className = 'payment-item';

    const info = document.createElement('div');
    info.className = 'payment-info';

    const title = document.createElement('div');
    title.className = 'payment-title';
    title.textContent = payment.title;

    const date = document.createElement('div');
    date.className = 'payment-date';
    date.textContent = '📅 ' + formatDate(payment.payDate);

    info.appendChild(title);
    info.appendChild(date);

    const type = document.createElement('span');
    type.className = 'payment-type ' + typeClass;
    type.textContent = paymentTypeLabel(paymentType);

    const status = document.createElement('span');
    status.className = 'payment-status ' + (payment.paid ? 'status-paid' : 'status-unpaid');
    status.textContent = payment.paid ? 'Sudah Dibayar' : 'Belum Dibayar';

    const amount = document.createElement('div');
    amount.className = 'payment-amount';
    amount.textContent = L.formatRM(payment.amount);

    const actions = document.createElement('div');
    actions.className = 'payment-actions';

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'btn btn-edit';
    editButton.textContent = '✏️ Sunting';
    editButton.setAttribute('aria-label', 'Sunting ' + payment.title);
    editButton.addEventListener('click', function () {
        editPayment(payment.id);
    });

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'btn btn-danger';
    deleteButton.textContent = '🗑️';
    deleteButton.setAttribute('aria-label', 'Padam ' + payment.title);
    deleteButton.addEventListener('click', function () {
        deletePayment(payment.id);
    });

    actions.appendChild(editButton);
    actions.appendChild(deleteButton);

    item.appendChild(info);
    item.appendChild(type);
    item.appendChild(status);
    item.appendChild(amount);
    item.appendChild(actions);

    return item;
}

function displayPayments() {
    const data = allMonths[currentMonthKey];
    const list = $('paymentsList');
    list.textContent = '';

    if (!data) {
        updateSummary(null);
        list.appendChild(emptyState('Tiada bulan dipilih. Tekan “➕ Bulan Baharu” untuk mula.'));
        return;
    }

    const lists = Array.isArray(data.lists) ? data.lists : [];
    updateSummary(L.computeSummary(lists));

    if (lists.length === 0) {
        list.appendChild(emptyState('Belum ada bayaran untuk bulan ini. Tekan “Tambah Bayaran” untuk mula.'));
        return;
    }

    const filtered = L.filterPayments(lists, filterType, filterStatus);
    const sorted = L.sortPayments(filtered, sortBy);

    if (sorted.length === 0) {
        list.appendChild(emptyState('Tiada bayaran yang sepadan dengan tapisan ini.'));
        return;
    }

    sorted.forEach(function (payment) {
        list.appendChild(buildPaymentItem(payment));
    });
}

/* ---------- Bulan ---------- */

function switchMonth() {
    currentMonthKey = $('monthSelect').value;
    displayPayments();
}

function applyFiltersAndSort() {
    filterType = $('filterType').value;
    filterStatus = $('filterStatus').value;
    sortBy = $('sortBy').value;
    displayPayments();
}

function showNewMonthModal() {
    const now = new Date();
    $('newMonth').value = L.MONTHS_EN[now.getMonth()];
    $('newYear').value = String(now.getFullYear());
    $('newMonthModal').classList.add('active');
}

function closeNewMonthModal() {
    $('newMonthModal').classList.remove('active');
}

function createNewMonth(event) {
    event.preventDefault();

    const monthEn = $('newMonth').value;
    const year = parseInt($('newYear').value, 10);
    if (!isFinite(year) || year < 2000 || year > 2100) {
        alert('Sila masukkan tahun yang sah (2000–2100).');
        return;
    }

    const key = L.monthKey(monthEn, year);
    if (allMonths[key]) {
        alert('Bulan ini sudah wujud!');
        return;
    }

    // Salin komitmen bulanan daripada bulan terkini.
    const latestKey = L.mostRecentMonthKey(allMonths);
    const commitments = latestKey ? L.extractMonthlyCommitments(allMonths[latestKey]) : [];

    allMonths[key] = L.createMonthRecord(monthEn, year, commitments);
    currentMonthKey = key;
    saveData();
    populateMonthSelector();
    displayPayments();
    closeNewMonthModal();
}

/* ---------- Bayaran ---------- */

function todayISO() {
    const now = new Date();
    return now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0');
}

function showAddPaymentModal() {
    if (!allMonths[currentMonthKey]) {
        alert('Sila cipta bulan terlebih dahulu.');
        return;
    }
    editingPaymentId = null;
    $('modalTitle').textContent = 'Tambah Bayaran';
    $('paymentForm').reset();
    $('paymentDate').value = todayISO();
    $('paymentPaid').checked = true;
    $('paymentType').value = 'monthly';
    $('paymentModal').classList.add('active');
    $('paymentTitle').focus();
}

function editPayment(id) {
    const data = allMonths[currentMonthKey];
    if (!data || !Array.isArray(data.lists)) return;

    const payment = data.lists.find(function (p) {
        return String(p.id) === String(id);
    });
    if (!payment) return;

    editingPaymentId = id;
    $('modalTitle').textContent = 'Edit Bayaran';
    $('paymentTitle').value = payment.title;
    $('paymentAmount').value = payment.amount;
    $('paymentDate').value = payment.payDate || todayISO();
    $('paymentPaid').checked = Boolean(payment.paid);
    $('paymentType').value = payment.type || 'monthly';

    $('paymentModal').classList.add('active');
}

function closeModal() {
    $('paymentModal').classList.remove('active');
}

function savePayment(event) {
    event.preventDefault();

    const data = allMonths[currentMonthKey];
    if (!data) return;

    const title = $('paymentTitle').value.trim();
    const amount = Number($('paymentAmount').value);

    if (!title) {
        alert('Sila masukkan nama bayaran.');
        return;
    }
    if (!isFinite(amount) || amount < 0) {
        alert('Sila masukkan amaun yang sah.');
        return;
    }

    if (!Array.isArray(data.lists)) data.lists = [];

    const payment = {
        title: title,
        amount: amount,
        payDate: $('paymentDate').value,
        paid: $('paymentPaid').checked,
        type: $('paymentType').value
    };

    if (editingPaymentId !== null) {
        const index = data.lists.findIndex(function (p) {
            return String(p.id) === String(editingPaymentId);
        });
        if (index !== -1) {
            data.lists[index] = Object.assign({}, data.lists[index], payment);
        }
    } else {
        payment.id = L.nextPaymentId(data.lists);
        data.lists.push(payment);
    }

    saveData();
    displayPayments();
    closeModal();
}

function deletePayment(id) {
    if (!confirm('Adakah anda pasti mahu memadam bayaran ini?')) return;

    const data = allMonths[currentMonthKey];
    if (!data || !Array.isArray(data.lists)) return;

    data.lists = data.lists.filter(function (p) {
        return String(p.id) !== String(id);
    });

    saveData();
    displayPayments();
}

/* ---------- Import / eksport ---------- */

function exportData() {
    const dataStr = JSON.stringify(allMonths, null, 4);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'data-pengurus-bayaran.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function importData() {
    $('importFile').click();
}

function handleImport(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const imported = JSON.parse(e.target.result);
            if (!imported || typeof imported !== 'object' || Array.isArray(imported)) {
                throw new Error('Format fail tidak sah.');
            }
            if (!confirm('Ini akan menggantikan semua data semasa. Teruskan?')) return;

            allMonths = L.migratePaymentData(imported);
            ensureCurrentMonth();
            saveData();
            populateMonthSelector();
            displayPayments();
            alert('Data berjaya diimport.');
        } catch (error) {
            alert('Ralat semasa mengimport fail: ' + error.message);
        } finally {
            event.target.value = '';
        }
    };
    reader.readAsText(file);
}

/* ---------- PWA ---------- */

function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;

    window.addEventListener('load', function () {
        navigator.serviceWorker.register('./service-worker.js')
            .catch(function (error) {
                console.log('Pendaftaran service worker gagal: ', error);
            });
    });
}

let deferredPrompt;

window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    const installButton = $('installButton');
    if (installButton) installButton.style.display = 'inline-block';
});

function installApp() {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(function (choiceResult) {
        deferredPrompt = null;
        const installButton = $('installButton');
        if (installButton) installButton.style.display = 'none';
        console.log(choiceResult.outcome === 'accepted'
            ? 'Pengguna menerima pemasangan'
            : 'Pengguna membatalkan pemasangan');
    });
}

window.addEventListener('appinstalled', function () {
    const installButton = $('installButton');
    if (installButton) installButton.style.display = 'none';
    deferredPrompt = null;
});

/* ---------- Kalkulator Zakat ---------- */

function toggleZakat() {
    const content = $('zakatContent');
    const toggle = $('zakatToggle');

    if (content.classList.contains('active')) {
        content.classList.remove('active');
        toggle.classList.remove('open');
    } else {
        content.classList.add('active');
        toggle.classList.add('open');
    }
}

function calculateZakatAmount() {
    const savingsInput = $('zakatSavings');
    const resultDiv = $('zakatResult');
    const statusDiv = $('zakatStatus');
    const amountDiv = $('zakatAmount');

    const savingsValue = Number(savingsInput.value);

    if (!savingsValue || savingsValue <= 0) {
        resultDiv.style.display = 'none';
        return;
    }

    const result = L.calculateZakat(savingsValue);

    resultDiv.style.display = 'block';

    if (result.isEligible) {
        statusDiv.innerHTML = '✅ Simpanan anda telah mencapai nisab. Zakat wajib dibayar.';
        amountDiv.innerHTML = '<strong>Zakat yang perlu dibayar:</strong> ' + L.formatRM(result.zakatDue);
        amountDiv.style.color = '#0d9488';
    } else {
        statusDiv.innerHTML = '💡 Simpanan anda belum mencapai nisab (RM 15,000). Zakat tidak wajib buat masa ini.';
        amountDiv.innerHTML = '<strong>Nisab:</strong> ' + L.formatRM(result.nisab) + '<br>' +
                              '<strong>Baki untuk capai nisab:</strong> ' + L.formatRM(result.nisab - result.savings);
        amountDiv.style.color = '#6c757d';
    }
}

/* ---------- Mula ---------- */

function init() {
    loadData();
    ensureCurrentMonth();
    populateMonthSelector();

    $('filterType').value = filterType;
    $('filterStatus').value = filterStatus;
    $('sortBy').value = sortBy;

    displayPayments();
    registerServiceWorker();
}

// Eksport untuk ujian (tidak mengubah tingkah laku aplikasi).
window.PengurusBayaran = {
    getMonths: function () { return allMonths; },
    getCurrentMonthKey: function () { return currentMonthKey; },
    setCurrentMonthKey: function (key) { currentMonthKey = key; },
    reload: function () { loadData(); ensureCurrentMonth(); populateMonthSelector(); displayPayments(); },
    displayPayments: displayPayments
};

init();
