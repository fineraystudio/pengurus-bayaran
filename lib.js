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

    // Nama bulan Hijrah dalam Bahasa Melayu
    var HIJRI_MONTHS_MS = [
        'Muharram', 'Safar', 'Rabiulawal', 'Rabiulakhir',
        'Jamadilawal', 'Jamadilakhir', 'Rejab', 'Syaaban',
        'Ramadan', 'Syawal', 'Zulkaedah', 'Zulhijjah'
    ];

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

    // ---------- Kalendar Hijrah ----------
    // Penukaran tarikh Gregorian → Hijrah. Keutamaan: kalendar Umm al-Qura
    // (piawaian yang digunakan di Arab Saudi, tersedia melalui Intl dalam
    // pelayar moden). Jika Intl tiada, guna kalendar Hijrah tabular (Kuwaiti)
    // yang tepat secara aritmetik. Tarikh rasmi Malaysia (JAKIM) ditentukan
    // melalui rukyah, jadi ia boleh berbeza sehari daripada kedua-duanya.

    var hijriFormatter = null;
    var hijriFormatterChecked = false;

    function getHijriFormatter() {
        if (hijriFormatterChecked) return hijriFormatter;
        hijriFormatterChecked = true;
        try {
            if (typeof Intl === 'undefined' || !Intl.DateTimeFormat) return null;
            var formatter = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', {
                year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC'
            });
            // Pastikan ia benar-benar menggunakan kalendar Hijrah dan bukan
            // senyap-senyap jatuh balik ke Gregorian (sesetengah ICU kecil).
            var parts = formatter.formatToParts(new Date(Date.UTC(2023, 6, 19, 12)));
            var found = {};
            parts.forEach(function (part) {
                if (part.type !== 'literal') found[part.type] = part.value;
            });
            var probeYear = parseInt(found.year, 10);
            if (probeYear > 1400 && probeYear < 1500) hijriFormatter = formatter;
        } catch (error) {
            hijriFormatter = null;
        }
        return hijriFormatter;
    }

    // Baca tarikh tanpa terjejas oleh zon waktu peranti.
    function parseGregorianDate(value) {
        if (value instanceof Date) {
            if (isNaN(value.getTime())) return null;
            return { year: value.getFullYear(), month: value.getMonth() + 1, day: value.getDate() };
        }

        var text = String(value == null ? '' : value).trim();
        var match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
        if (match) {
            var year = parseInt(match[1], 10);
            var month = parseInt(match[2], 10);
            var day = parseInt(match[3], 10);
            var check = new Date(Date.UTC(year, month - 1, day));
            if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 ||
                    check.getUTCDate() !== day) {
                return null;
            }
            return { year: year, month: month, day: day };
        }

        var parsed = new Date(text);
        if (isNaN(parsed.getTime())) return null;
        return { year: parsed.getFullYear(), month: parsed.getMonth() + 1, day: parsed.getDate() };
    }

    // Kalendar Hijrah tabular (algoritma Kuwaiti) — sandaran tanpa Intl.
    // Tarikh Hijrah bermula pada 16 Julai 622 CE (JDN 1948440).
    function gregorianToHijriTabular(value) {
        var g = parseGregorianDate(value);
        if (!g) return { year: 0, month: 0, day: 0 };

        var a = Math.floor((14 - g.month) / 12);
        var y = g.year + 4800 - a;
        var m = g.month + 12 * a - 3;
        var jdn = g.day + Math.floor((153 * m + 2) / 5) + 365 * y +
                  Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;

        var l = jdn - 1948440 + 10632;
        var n = Math.floor((l - 1) / 10631);
        l = l - 10631 * n + 354;
        var j = Math.floor((10985 - l) / 5316) * Math.floor((50 * l) / 17719) +
                Math.floor(l / 5670) * Math.floor((43 * l) / 15238);
        l = l - Math.floor((30 - j) / 15) * Math.floor((17719 * j) / 50) -
            Math.floor(j / 16) * Math.floor((15238 * j) / 43) + 29;
        var hijriMonth = Math.floor((24 * l) / 709);
        var hijriDay = l - Math.floor((709 * hijriMonth) / 24);
        var hijriYear = 30 * n + j - 30;

        if (hijriYear < 1 || hijriMonth < 1 || hijriMonth > 12 ||
                hijriDay < 1 || hijriDay > 30) {
            return { year: 0, month: 0, day: 0 };
        }
        return { year: hijriYear, month: hijriMonth, day: hijriDay };
    }

    // Tukar tarikh Gregorian ('YYYY-MM-DD' atau Date) kepada Hijri.
    function gregorianToHijri(value) {
        var g = parseGregorianDate(value);
        if (!g) return { year: 0, month: 0, day: 0 };

        var formatter = getHijriFormatter();
        if (formatter) {
            try {
                var parts = formatter.formatToParts(new Date(Date.UTC(g.year, g.month - 1, g.day, 12)));
                var found = {};
                parts.forEach(function (part) {
                    if (part.type !== 'literal') found[part.type] = part.value;
                });
                var year = parseInt(found.year, 10);
                var month = parseInt(found.month, 10);
                var day = parseInt(found.day, 10);
                if (year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= 30) {
                    return { year: year, month: month, day: day };
                }
            } catch (error) {
                // jatuh ke kaedah aritmetik di bawah
            }
        }

        return gregorianToHijriTabular(g.year + '-' +
            String(g.month).padStart(2, '0') + '-' + String(g.day).padStart(2, '0'));
    }

    // Format tarikh Hijri dalam Bahasa Melayu, cth. "16 Jamadilawal 1448H".
    function formatHijriDate(value) {
        var hijri = gregorianToHijri(value);
        if (!hijri.year) return '';
        var monthName = HIJRI_MONTHS_MS[hijri.month - 1] || '';
        return hijri.day + ' ' + monthName + ' ' + hijri.year + 'H';
    }

    // Dapatkan nama bulan Hijri (untuk penapis)
    function getHijriMonthName(monthNum) {
        return HIJRI_MONTHS_MS[monthNum - 1] || '';
    }

    return {
        MONTHS_EN: MONTHS_EN,
        MONTHS_MS: MONTHS_MS,
        HIJRI_MONTHS_MS: HIJRI_MONTHS_MS,
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
        calculateZakat: calculateZakat,
        gregorianToHijri: gregorianToHijri,
        gregorianToHijriTabular: gregorianToHijriTabular,
        formatHijriDate: formatHijriDate,
        getHijriMonthName: getHijriMonthName
    };
});
