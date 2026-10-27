/*
 * Pengurus Bayaran — logik data (tulen, tiada DOM)
 * Berdasarkan "Payment Manager" daripada personal-efficiency-machine (Farid Rameli).
 * Lesen: MIT — lihat LICENSE.
 *
 * Fungsi di sini tidak menyentuh DOM atau localStorage supaya boleh diuji dengan Node.
 */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        root.PBLib = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // Nilai bulan disimpan dalam Bahasa Inggeris supaya data lama (dan fail import)
    // kekal serasi; hanya paparan diterjemah ke Bahasa Melayu.
    var MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    var MONTHS_MS = ['Januari', 'Februari', 'Mac', 'April', 'Mei', 'Jun',
        'Julai', 'Ogos', 'September', 'Oktober', 'November', 'Disember'];

    function monthIndex(monthEn) {
        return MONTHS_EN.indexOf(monthEn);
    }

    function monthLabel(monthEn, year) {
        var i = monthIndex(monthEn);
        return (i >= 0 ? MONTHS_MS[i] : String(monthEn)) + ' ' + year;
    }

    function monthKey(monthEn, year) {
        return monthEn + '_' + year;
    }

    function formatRM(value) {
        var n = Number(value);
        if (!isFinite(n)) n = 0;
        return 'RM ' + n.toLocaleString('ms-MY', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    // Pastikan setiap bayaran mempunyai medan type (data lama tiada).
    function migratePaymentData(data) {
        var result = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
        Object.keys(result).forEach(function (key) {
            var month = result[key];
            if (!month || !Array.isArray(month.lists)) return;
            month.lists.forEach(function (payment) {
                if (!payment.type) payment.type = 'monthly';
            });
        });
        return result;
    }

    // Ambil komitmen bulanan sahaja (untuk disalin ke bulan baharu).
    function extractMonthlyCommitments(monthData) {
        if (!monthData || !Array.isArray(monthData.lists)) return [];
        return monthData.lists
            .filter(function (payment) { return (payment.type || 'monthly') === 'monthly'; })
            .map(function (payment) {
                return { title: payment.title, amount: payment.amount, type: 'monthly' };
            });
    }

    function filterPayments(payments, filterType, filterStatus) {
        var result = payments.slice();
        if (filterType !== 'all') {
            result = result.filter(function (payment) {
                return (payment.type || 'monthly') === filterType;
            });
        }
        if (filterStatus !== 'all') {
            result = result.filter(function (payment) {
                return filterStatus === 'paid' ? payment.paid === true : payment.paid !== true;
            });
        }
        return result;
    }

    function sortPayments(payments, sortBy) {
        var sorted = payments.slice();
        var isDesc = String(sortBy).slice(-5) === '-desc';
        var sortField = isDesc ? String(sortBy).slice(0, -5) : String(sortBy);

        sorted.sort(function (a, b) {
            var comparison = 0;

            switch (sortField) {
                case 'status':
                    // Belum dibayar (false) dahulu.
                    comparison = a.paid === b.paid ? 0 : (a.paid ? 1 : -1);
                    break;
                case 'type':
                    var aType = a.type || 'monthly';
                    var bType = b.type || 'monthly';
                    if (aType !== bType) comparison = aType === 'monthly' ? -1 : 1;
                    break;
                case 'date':
                    var aDate = a.payDate ? new Date(a.payDate).getTime() : NaN;
                    var bDate = b.payDate ? new Date(b.payDate).getTime() : NaN;
                    var aHas = !isNaN(aDate);
                    var bHas = !isNaN(bDate);
                    if (aHas && bHas) comparison = aDate - bDate;
                    else if (aHas) comparison = -1;
                    else if (bHas) comparison = 1;
                    break;
                case 'amount':
                    comparison = (Number(a.amount) || 0) - (Number(b.amount) || 0);
                    break;
                case 'title':
                    comparison = String(a.title || '').localeCompare(String(b.title || ''), 'ms');
                    break;
                default:
                    comparison = 0;
            }

            return isDesc ? -comparison : comparison;
        });

        return sorted;
    }

    function summaryAmount(list) {
        return list.reduce(function (sum, payment) {
            var amount = Number(payment.amount);
            return sum + (isFinite(amount) ? amount : 0);
        }, 0);
    }

    function computeSummary(payments) {
        var lists = Array.isArray(payments) ? payments : [];
        return {
            totalCount: lists.length,
            totalAmount: summaryAmount(lists),
            paidCount: lists.filter(function (p) { return p.paid; }).length,
            monthlyTotal: summaryAmount(lists.filter(function (p) { return (p.type || 'monthly') === 'monthly'; })),
            extraTotal: summaryAmount(lists.filter(function (p) { return (p.type || 'monthly') === 'extra'; })),
            paidAmount: summaryAmount(lists.filter(function (p) { return p.paid; })),
            unpaidAmount: summaryAmount(lists.filter(function (p) { return !p.paid; }))
        };
    }

    function nextPaymentId(lists) {
        var ids = (lists || []).map(function (p) { return Number(p.id); })
            .filter(function (id) { return isFinite(id); });
        return ids.length ? Math.max.apply(null, ids) + 1 : 1;
    }

    // Cipta rekod bulan baharu; komitmen bulanan disalin dan tarikh lalai ialah 1 haribulan.
    function createMonthRecord(monthEn, year, monthlyCommitments) {
        var idx = monthIndex(monthEn);
        var numYear = Number(year);
        var defaultDate = numYear + '-' + String(Math.max(idx, 0) + 1).padStart(2, '0') + '-01';

        var lists = (monthlyCommitments || []).map(function (commitment, index) {
            return {
                id: index + 1,
                title: commitment.title,
                amount: commitment.amount,
                type: 'monthly',
                paid: false,
                payDate: defaultDate
            };
        });

        return {
            month: monthEn,
            year: numYear,
            topic: monthLabel(monthEn, numYear) + ' — bayaran bulanan',
            lists: lists
        };
    }

    // Kunci bulan terkini dalam himpunan (tahun terbesar, kemudian bulan terbesar).
    function mostRecentMonthKey(months) {
        var keys = Object.keys(months || {});
        if (!keys.length) return null;
        return keys.sort(function (a, b) {
            var A = months[a];
            var B = months[b];
            if (A.year !== B.year) return B.year - A.year;
            return monthIndex(B.month) - monthIndex(A.month);
        })[0];
    }

    // Kira Zakat ke atas simpanan.
    // Nisab = RM 15,000 (anggaran berdasarkan harga perak semasa di Malaysia)
    // Kadar Zakat = 2.5% daripada simpanan yang melebihi nisab
    function calculateZakat(savingsAmount) {
        var NISAB = 15000;
        var ZAKAT_RATE = 0.025;
        var savings = Number(savingsAmount);

        if (!isFinite(savings) || savings < NISAB) {
            return {
                nisab: NISAB,
                savings: savings,
                isEligible: false,
                zakatDue: 0
            };
        }

        return {
            nisab: NISAB,
            savings: savings,
            isEligible: true,
            zakatDue: savings * ZAKAT_RATE
        };
    }

    return {
        MONTHS_EN: MONTHS_EN,
        MONTHS_MS: MONTHS_MS,
        monthIndex: monthIndex,
        monthLabel: monthLabel,
        monthKey: monthKey,
        formatRM: formatRM,
        migratePaymentData: migratePaymentData,
        extractMonthlyCommitments: extractMonthlyCommitments,
        filterPayments: filterPayments,
        sortPayments: sortPayments,
        computeSummary: computeSummary,
        nextPaymentId: nextPaymentId,
        createMonthRecord: createMonthRecord,
        mostRecentMonthKey: mostRecentMonthKey,
        calculateZakat: calculateZakat
    };
});
