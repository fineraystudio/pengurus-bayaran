'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../lib.js');

function payment(overrides) {
    return Object.assign({
        id: 1,
        title: 'Bil Elektrik',
        amount: 75.9,
        payDate: '2026-10-01',
        paid: false,
        type: 'monthly'
    }, overrides);
}

test('monthLabel memaparkan nama bulan Bahasa Melayu', () => {
    assert.equal(L.monthLabel('October', 2026), 'Oktober 2026');
    assert.equal(L.monthLabel('May', 2026), 'Mei 2026');
    assert.equal(L.monthLabel('December', 2025), 'Disember 2025');
});

test('monthKey menggunakan nama bulan Bahasa Inggeris untuk keserasian data', () => {
    assert.equal(L.monthKey('October', 2026), 'October_2026');
});

test('formatRM memformat amaun dalam Ringgit Malaysia', () => {
    assert.equal(L.formatRM(1234.5), 'RM 1,234.50');
    assert.equal(L.formatRM('12'), 'RM 12.00');
    assert.equal(L.formatRM(0), 'RM 0.00');
    assert.equal(L.formatRM(undefined), 'RM 0.00');
    assert.equal(L.formatRM('bukan nombor'), 'RM 0.00');
});

test('migratePaymentData menambah jenis "monthly" pada data lama', () => {
    const data = {
        October_2026: {
            month: 'October',
            year: 2026,
            lists: [
                { id: 1, title: 'Air', amount: 30 },
                { id: 2, title: 'Servis Kereta', amount: 200, type: 'extra' }
            ]
        }
    };
    const result = L.migratePaymentData(data);
    assert.equal(result.October_2026.lists[0].type, 'monthly');
    assert.equal(result.October_2026.lists[1].type, 'extra');
});

test('migratePaymentData selamat dengan data tidak sah', () => {
    assert.deepEqual(L.migratePaymentData(null), {});
    assert.deepEqual(L.migratePaymentData([]), {});
    assert.deepEqual(L.migratePaymentData('teks'), {});
});

test('extractMonthlyCommitments hanya mengambil komitmen bulanan', () => {
    const result = L.extractMonthlyCommitments({
        lists: [
            payment({ id: 1, title: 'Sewa', amount: 900 }),
            payment({ id: 2, title: 'Baiki paip', amount: 150, type: 'extra' }),
            payment({ id: 3, title: 'Internet', amount: 99 })
        ]
    });
    assert.deepEqual(result, [
        { title: 'Sewa', amount: 900, type: 'monthly' },
        { title: 'Internet', amount: 99, type: 'monthly' }
    ]);
});

test('extractMonthlyCommitments selamat tanpa senarai', () => {
    assert.deepEqual(L.extractMonthlyCommitments(null), []);
    assert.deepEqual(L.extractMonthlyCommitments({}), []);
});

test('filterPayments menapis ikut jenis dan status', () => {
    const lists = [
        payment({ id: 1, paid: true, type: 'monthly' }),
        payment({ id: 2, paid: false, type: 'monthly' }),
        payment({ id: 3, paid: true, type: 'extra' }),
        payment({ id: 4, paid: false, type: 'extra' })
    ];

    assert.deepEqual(L.filterPayments(lists, 'all', 'all').map(p => p.id), [1, 2, 3, 4]);
    assert.deepEqual(L.filterPayments(lists, 'monthly', 'all').map(p => p.id), [1, 2]);
    assert.deepEqual(L.filterPayments(lists, 'extra', 'all').map(p => p.id), [3, 4]);
    assert.deepEqual(L.filterPayments(lists, 'all', 'paid').map(p => p.id), [1, 3]);
    assert.deepEqual(L.filterPayments(lists, 'all', 'unpaid').map(p => p.id), [2, 4]);
    assert.deepEqual(L.filterPayments(lists, 'extra', 'unpaid').map(p => p.id), [4]);
});

test('filterPayments menganggap jenis yang tiada sebagai bulanan', () => {
    const lists = [{ id: 1, title: 'X', amount: 1, paid: false }];
    assert.equal(L.filterPayments(lists, 'monthly', 'all').length, 1);
    assert.equal(L.filterPayments(lists, 'extra', 'all').length, 0);
});

test('sortPayments: status (belum dibayar dahulu) dan terbaliknya', () => {
    const lists = [
        payment({ id: 1, paid: true }),
        payment({ id: 2, paid: false }),
        payment({ id: 3, paid: false })
    ];
    assert.equal(L.sortPayments(lists, 'status')[0].paid, false);
    assert.equal(L.sortPayments(lists, 'status-desc')[0].paid, true);
});

test('sortPayments: jumlah menaik dan menurun', () => {
    const lists = [
        payment({ id: 1, amount: 300 }),
        payment({ id: 2, amount: 10 }),
        payment({ id: 3, amount: 75.9 })
    ];
    assert.deepEqual(L.sortPayments(lists, 'amount').map(p => p.id), [2, 3, 1]);
    assert.deepEqual(L.sortPayments(lists, 'amount-desc').map(p => p.id), [1, 3, 2]);
});

test('sortPayments: tarikh paling awal dahulu, tarikh kosong di hujung', () => {
    const lists = [
        payment({ id: 1, payDate: '2026-10-20' }),
        payment({ id: 2, payDate: '' }),
        payment({ id: 3, payDate: '2026-10-01' })
    ];
    assert.deepEqual(L.sortPayments(lists, 'date').map(p => p.id), [3, 1, 2]);
});

test('sortPayments: jenis bulanan dahulu', () => {
    const lists = [
        payment({ id: 1, type: 'extra' }),
        payment({ id: 2, type: 'monthly' })
    ];
    assert.deepEqual(L.sortPayments(lists, 'type').map(p => p.id), [2, 1]);
    assert.deepEqual(L.sortPayments(lists, 'type-desc').map(p => p.id), [1, 2]);
});

test('sortPayments: nama A-Z mengikut bahasa Melayu', () => {
    const lists = [
        payment({ id: 1, title: 'Zakat' }),
        payment({ id: 2, title: 'Air' })
    ];
    assert.deepEqual(L.sortPayments(lists, 'title').map(p => p.id), [2, 1]);
    assert.deepEqual(L.sortPayments(lists, 'title-desc').map(p => p.id), [1, 2]);
});

test('sortPayments tidak mengubah senarai asal', () => {
    const lists = [
        payment({ id: 1, amount: 300 }),
        payment({ id: 2, amount: 10 })
    ];
    L.sortPayments(lists, 'amount');
    assert.deepEqual(lists.map(p => p.id), [1, 2]);
});

test('computeSummary mengira jumlah keseluruhan, jenis dan status', () => {
    const summary = L.computeSummary([
        payment({ id: 1, amount: 100.5, paid: true, type: 'monthly' }),
        payment({ id: 2, amount: 50, paid: false, type: 'monthly' }),
        payment({ id: 3, amount: 20, paid: true, type: 'extra' }),
        payment({ id: 4, amount: 9.5, paid: false, type: 'extra' })
    ]);

    assert.equal(summary.totalCount, 4);
    assert.equal(summary.totalAmount, 180);
    assert.equal(summary.paidCount, 2);
    assert.equal(summary.monthlyTotal, 150.5);
    assert.equal(summary.extraTotal, 29.5);
    assert.equal(summary.paidAmount, 120.5);
    assert.equal(summary.unpaidAmount, 59.5);
});

test('computeSummary selamat dengan senarai kosong atau amaun rosak', () => {
    assert.deepEqual(L.computeSummary([]), {
        totalCount: 0,
        totalAmount: 0,
        paidCount: 0,
        monthlyTotal: 0,
        extraTotal: 0,
        paidAmount: 0,
        unpaidAmount: 0
    });
    const summary = L.computeSummary([payment({ amount: 'bukan nombor' })]);
    assert.equal(summary.totalAmount, 0);
});

test('nextPaymentId memberi id seterusnya yang unik', () => {
    assert.equal(L.nextPaymentId([]), 1);
    assert.equal(L.nextPaymentId([{ id: 1 }, { id: 7 }, { id: 3 }]), 8);
    assert.equal(L.nextPaymentId([{ id: '4' }, { id: 2 }]), 5);
});

test('createMonthRecord menyalin komitmen bulanan dan tarikh lalai 1 haribulan', () => {
    const record = L.createMonthRecord('October', 2026, [
        { title: 'Sewa', amount: 900, type: 'monthly' }
    ]);

    assert.equal(record.month, 'October');
    assert.equal(record.year, 2026);
    assert.equal(record.topic, 'Oktober 2026 — bayaran bulanan');
    assert.equal(record.lists.length, 1);
    assert.equal(record.lists[0].title, 'Sewa');
    assert.equal(record.lists[0].amount, 900);
    assert.equal(record.lists[0].type, 'monthly');
    assert.equal(record.lists[0].paid, false);
    assert.equal(record.lists[0].payDate, '2026-10-01');
});

test('createMonthRecord untuk Disember menggunakan bulan 12', () => {
    const record = L.createMonthRecord('December', 2026, []);
    assert.equal(record.lists.length, 0);
    const withCommitment = L.createMonthRecord('December', 2026, [{ title: 'X', amount: 1 }]);
    assert.equal(withCommitment.lists[0].payDate, '2026-12-01');
});

test('mostRecentMonthKey memilih bulan terkini', () => {
    const months = {
        January_2026: { month: 'January', year: 2026 },
        October_2026: { month: 'October', year: 2026 },
        December_2025: { month: 'December', year: 2025 }
    };
    assert.equal(L.mostRecentMonthKey(months), 'October_2026');
    assert.equal(L.mostRecentMonthKey({}), null);
    assert.equal(L.mostRecentMonthKey(null), null);
});
