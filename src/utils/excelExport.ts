import * as XLSX from 'xlsx';
import {
  ClubAthleteRecord,
  formatTurkishDate,
  PerformanceTestFormValues,
  PerformanceTestRecord,
} from '../types';

function toNumericOrString(val: string): number | string {
  if (!val || val.trim() === '') return '';
  const normalized = val.trim().replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && /^-?\d+(\.\d+)?$/.test(normalized)
    ? parsed
    : val.trim();
}

function buildFlatRow(
  item: PerformanceTestFormValues,
  index?: number
): Record<string, string | number> {
  const row: Record<string, string | number> = {};
  if (typeof index === 'number') {
    row['Sıra No'] = index + 1;
  }
  row['Test Tarihi'] = formatTurkishDate(item.testDate);
  row['Spor Kulübü'] = item.sportsClub?.trim() || 'Belirtilmedi';
  row['Adı Soyadı'] = item.athleteName?.trim() || '';
  row['Doğum Tarihi'] = formatTurkishDate(item.birthDate);
  row['Boy (cm)'] = toNumericOrString(item.heightCm);
  row['Ağırlık (kg)'] = toNumericOrString(item.weightKg);
  row['Pençe Kuvveti Sağ (kg)'] = toNumericOrString(item.gripRightKg);
  row['Pençe Kuvveti Sol (kg)'] = toNumericOrString(item.gripLeftKg);
  row['Flamingo Sağ 1. Deneme (sn)'] = toNumericOrString(item.flamingoRight1);
  row['Flamingo Sağ 2. Deneme (sn)'] = toNumericOrString(item.flamingoRight2);
  row['Flamingo Sol 1. Deneme (sn)'] = toNumericOrString(item.flamingoLeft1);
  row['Flamingo Sol 2. Deneme (sn)'] = toNumericOrString(item.flamingoLeft2);
  row['20M Sprint (sn)'] = toNumericOrString(item.sprint20m);
  row['Esneklik Otur Eriş (cm)'] = toNumericOrString(item.sitAndReachCm);
  row['Kol Sürat Sağ (sn)'] = toNumericOrString(item.armSpeedRightSec);
  row['Kol Sürat Sol (sn)'] = toNumericOrString(item.armSpeedLeftSec);
  row['Durarak Uzun Atlama (cm)'] = toNumericOrString(item.standingLongJumpCm);
  row['10x5 Sürat (sn)'] = toNumericOrString(item.shuttleRun10x5Sec);
  row['Dikey Sıçrama (cm)'] = toNumericOrString(item.verticalJumpCm);
  row['Reaksiyon Testi (sn)'] = toNumericOrString(item.reactionTestSec);
  row['Deri Kıvrım Triceps (mm)'] = toNumericOrString(item.skinfoldTricepsMm);
  row['Deri Kıvrım Biceps (mm)'] = toNumericOrString(item.skinfoldBicepsMm);
  row['Deri Kıvrım Iliac (mm)'] = toNumericOrString(item.skinfoldIliacMm);
  row['Deri Kıvrım Calf (mm)'] = toNumericOrString(item.skinfoldCalfMm);
  row['Anne Boy (cm)'] = toNumericOrString(item.motherHeightCm);
  row['Anne Kilo (kg)'] = toNumericOrString(item.motherWeightKg);
  row['Anne Spor Geçmişi'] = item.motherSportsHistory?.trim() || '';
  row['Baba Boy (cm)'] = toNumericOrString(item.fatherHeightCm);
  row['Baba Kilo (kg)'] = toNumericOrString(item.fatherWeightKg);
  row['Baba Spor Geçmişi'] = item.fatherSportsHistory?.trim() || '';
  return row;
}

function autoFitColumns(rows: Record<string, string | number>[]): XLSX.ColInfo[] {
  if (rows.length === 0) return [];
  const keys = Object.keys(rows[0]);
  return keys.map((key) => {
    let maxLen = key.length;
    for (const r of rows) {
      const cellVal = r[key] !== undefined && r[key] !== null ? String(r[key]) : '';
      if (cellVal.length > maxLen) {
        maxLen = cellVal.length;
      }
    }
    return { wch: Math.min(Math.max(maxLen + 4, 14), 38) };
  });
}

/**
 * Tek bir sporcu test formunu Excel (.xlsx) dosyası olarak indirir.
 * İçerisinde hem dikey "Test Formu Kartı" sayfası hem de "Tablo Satırı" sayfası bulunur.
 */
export function exportSingleTestToExcel(form: PerformanceTestFormValues): void {
  const wb = XLSX.utils.book_new();

  // Sayfa 1: Orijinal Kâğıt Form Sıralamasıyla Dikey Test Formu Özeti
  const verticalRows: (string | number)[][] = [
    ['ROTA PERFORMANS – DİJİTAL PERFORMANS TEST FORMU', '', ''],
    ['Bölüm / Kategori', 'Ölçüm Alanı', 'Değer', 'Birim'],
    ['1. Genel Bilgiler', 'Spor Kulübü', form.sportsClub || 'Belirtilmedi', ''],
    ['1. Genel Bilgiler', 'Adı Soyadı', form.athleteName || '—', ''],
    ['1. Genel Bilgiler', 'Doğum Tarihi', formatTurkishDate(form.birthDate), ''],
    ['1. Genel Bilgiler', 'Test Tarihi', formatTurkishDate(form.testDate), ''],
    ['2. Fiziksel Ölçümler', 'Boy', toNumericOrString(form.heightCm), 'cm'],
    ['2. Fiziksel Ölçümler', 'Ağırlık', toNumericOrString(form.weightKg), 'kg'],
    ['3. Pençe Kuvveti', 'Sağ El Pençe Kuvveti', toNumericOrString(form.gripRightKg), 'kg'],
    ['3. Pençe Kuvveti', 'Sol El Pençe Kuvveti', toNumericOrString(form.gripLeftKg), 'kg'],
    ['4. Flamingo Denge', 'Sağ - 1. Deneme', toNumericOrString(form.flamingoRight1), 'sn'],
    ['4. Flamingo Denge', 'Sağ - 2. Deneme', toNumericOrString(form.flamingoRight2), 'sn'],
    ['4. Flamingo Denge', 'Sol - 1. Deneme', toNumericOrString(form.flamingoLeft1), 'sn'],
    ['4. Flamingo Denge', 'Sol - 2. Deneme', toNumericOrString(form.flamingoLeft2), 'sn'],
    ['5. Performans Testleri', '20M Sprint', toNumericOrString(form.sprint20m), 'sn'],
    ['5. Performans Testleri', 'Esneklik Otur Eriş', toNumericOrString(form.sitAndReachCm), 'cm'],
    ['5. Performans Testleri', 'Kol Sürat Sağ', toNumericOrString(form.armSpeedRightSec), 'sn'],
    ['5. Performans Testleri', 'Kol Sürat Sol', toNumericOrString(form.armSpeedLeftSec), 'sn'],
    ['5. Performans Testleri', 'Durarak Uzun Atlama', toNumericOrString(form.standingLongJumpCm), 'cm'],
    ['5. Performans Testleri', '10x5 Sürat', toNumericOrString(form.shuttleRun10x5Sec), 'sn'],
    ['5. Performans Testleri', 'Dikey Sıçrama', toNumericOrString(form.verticalJumpCm), 'cm'],
    ['5. Performans Testleri', 'Reaksiyon Testi', toNumericOrString(form.reactionTestSec), 'sn'],
    ['6. Deri Kıvrım Kalınlıkları', 'Triceps', toNumericOrString(form.skinfoldTricepsMm), 'mm'],
    ['6. Deri Kıvrım Kalınlıkları', 'Biceps', toNumericOrString(form.skinfoldBicepsMm), 'mm'],
    ['6. Deri Kıvrım Kalınlıkları', 'Iliac', toNumericOrString(form.skinfoldIliacMm), 'mm'],
    ['6. Deri Kıvrım Kalınlıkları', 'Calf', toNumericOrString(form.skinfoldCalfMm), 'mm'],
    ['7. Aile Bilgileri (Anne)', 'Anne Boy', toNumericOrString(form.motherHeightCm), 'cm'],
    ['7. Aile Bilgileri (Anne)', 'Anne Kilo', toNumericOrString(form.motherWeightKg), 'kg'],
    ['7. Aile Bilgileri (Anne)', 'Anne Spor Geçmişi', form.motherSportsHistory || '', ''],
    ['7. Aile Bilgileri (Baba)', 'Baba Boy', toNumericOrString(form.fatherHeightCm), 'cm'],
    ['7. Aile Bilgileri (Baba)', 'Baba Kilo', toNumericOrString(form.fatherWeightKg), 'kg'],
    ['7. Aile Bilgileri (Baba)', 'Baba Spor Geçmişi', form.fatherSportsHistory || '', ''],
  ];

  const wsForm = XLSX.utils.aoa_to_sheet(verticalRows);
  wsForm['!cols'] = [{ wch: 28 }, { wch: 28 }, { wch: 26 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, wsForm, 'Test Formu');

  // Sayfa 2: Yatay Tablo Satırı
  const flatRow = [buildFlatRow(form, 0)];
  const wsTable = XLSX.utils.json_to_sheet(flatRow);
  wsTable['!cols'] = autoFitColumns(flatRow);
  XLSX.utils.book_append_sheet(wb, wsTable, 'Tablo Verisi');

  const safeSlug = (form.athleteName || 'sporcu')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_ğüşıöç]/gi, '');

  const filename = `ROTA_Performans_${safeSlug || 'form'}_${form.testDate || 'test'}.xlsx`;
  XLSX.writeFile(wb, filename);
}

/**
 * Birden fazla (veya tüm) sporcu test kaydını toplu Excel (.xlsx) dosyası olarak indirir.
 */
export function exportMultipleTestsToExcel(
  records: PerformanceTestRecord[],
  scopeLabel = 'Tum_Kayitlar',
  clubAthletes?: ClubAthleteRecord[]
): void {
  const wb = XLSX.utils.book_new();

  // Sayfa 1: Tüm Ölçüm Verileri
  const tableRows = records.map((rec, idx) => buildFlatRow(rec, idx));
  const wsAll =
    tableRows.length > 0
      ? XLSX.utils.json_to_sheet(tableRows)
      : XLSX.utils.aoa_to_sheet([
          ['Test Tarihi', 'Spor Kulübü', 'Adı Soyadı', 'Doğum Tarihi'],
        ]);
  if (tableRows.length > 0) {
    wsAll['!cols'] = autoFitColumns(tableRows);
  }
  XLSX.utils.book_append_sheet(wb, wsAll, 'Sporcu Olcum Verileri');

  // Sayfa 2: Kulüp Bazlı Özet
  const clubStatsMap = new Map<
    string,
    { count: number; athletes: Set<string>; latestDate: string }
  >();
  for (const r of records) {
    const clubName = r.sportsClub?.trim() || 'Belirtilmedi';
    let entry = clubStatsMap.get(clubName);
    if (!entry) {
      entry = { count: 0, athletes: new Set<string>(), latestDate: '' };
      clubStatsMap.set(clubName, entry);
    }
    entry.count += 1;
    if (r.athleteName?.trim()) {
      entry.athletes.add(r.athleteName.trim().toLocaleLowerCase('tr-TR'));
    }
    if ((r.testDate || '') > entry.latestDate) {
      entry.latestDate = r.testDate;
    }
  }

  const clubSummaryRows = Array.from(clubStatsMap.entries()).map(
    ([clubName, stat], idx) => ({
      'Sıra No': idx + 1,
      'Spor Kulübü': clubName,
      'Farklı Sporcu Sayısı': stat.athletes.size,
      'Toplam Test Sayısı': stat.count,
      'Son Test Tarihi': stat.latestDate
        ? formatTurkishDate(stat.latestDate)
        : '—',
    })
  );

  if (clubSummaryRows.length > 0) {
    const wsClubs = XLSX.utils.json_to_sheet(clubSummaryRows);
    wsClubs['!cols'] = autoFitColumns(clubSummaryRows);
    XLSX.utils.book_append_sheet(wb, wsClubs, 'Kulup Ozeti');
  }

  // Sayfa 3: Kayıtlı Kulüp Sporcu Kadrosu (varsa)
  if (clubAthletes && clubAthletes.length > 0) {
    const rosterRows = clubAthletes.map((ath, idx) => ({
      'Sıra No': idx + 1,
      'Spor Kulübü': ath.sportsClub || 'Belirtilmedi',
      'Sporcu Adı Soyadı': ath.athleteName,
      'Doğum Tarihi': formatTurkishDate(ath.birthDate),
    }));
    const wsRoster = XLSX.utils.json_to_sheet(rosterRows);
    wsRoster['!cols'] = autoFitColumns(rosterRows);
    XLSX.utils.book_append_sheet(wb, wsRoster, 'Kulup Kadrosu');
  }

  const safeLabel = scopeLabel
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_ğüşıöç]/gi, '');
  const today = new Date().toISOString().slice(0, 10);
  const filename = `ROTA_Performans_${safeLabel || 'Toplu_Veriler'}_${today}.xlsx`;
  XLSX.writeFile(wb, filename);
}
