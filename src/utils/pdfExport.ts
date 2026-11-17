import { jsPDF } from 'jspdf';
import { formatTurkishDate, PerformanceTestFormValues } from '../types';

const LOGO_URL = '/assets/aistudio/download_3d50004a.png';

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Renders the ROTA Performans Test Form onto a high-DPI A4 canvas (1654 x 2339 px)
 * using the official ROTA Performans logo and its Cyan / Cobalt Blue / Silver color palette,
 * then saves it as a single-page A4 PDF.
 */
export async function downloadPerformanceTestPdf(
  form: PerformanceTestFormValues
): Promise<void> {
  const logoImg = await loadImage(LOGO_URL);

  const canvas = document.createElement('canvas');
  const W = 1654; // A4 width at 200 DPI
  const H = 2339; // A4 height at 200 DPI
  canvas.width = W;
  canvas.height = H;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // ROTA Performans Logo Palette
  const COBALT_DARK = '#0B192C';
  const COBALT_MID = '#0F294A';
  const CYAN_ACCENT = '#00B4D8';
  const CYAN_DEEP = '#0284C7';
  const SILVER_BG = '#F0F6FC';
  const SILVER_HEADER = '#E2EEF8';
  const BORDER = '#CBD5E1';
  const TEXT_DARK = '#0B192C';
  const TEXT_MUTED = '#475569';
  const WHITE = '#FFFFFF';

  // Background
  ctx.fillStyle = WHITE;
  ctx.fillRect(0, 0, W, H);

  const margin = 80;
  const contentW = W - margin * 2;
  let y = 76;

  // Outer Form Frame
  ctx.strokeStyle = COBALT_DARK;
  ctx.lineWidth = 3;
  ctx.strokeRect(margin - 16, y - 16, contentW + 32, H - 124);

  // Header Banner
  const headerH = 136;
  ctx.fillStyle = COBALT_DARK;
  ctx.fillRect(margin, y, contentW, headerH);

  // Cyan bottom accent stripe on header
  ctx.fillStyle = CYAN_ACCENT;
  ctx.fillRect(margin, y + headerH - 10, contentW, 10);

  let textStartX = margin + 36;
  if (logoImg) {
    const logoSize = 98;
    ctx.drawImage(logoImg, margin + 28, y + 14, logoSize, logoSize);
    textStartX = margin + 28 + logoSize + 22;
  }

  // Brand Title
  ctx.fillStyle = WHITE;
  ctx.font = 'bold 42px "Plus Jakarta Sans", "Inter", sans-serif';
  ctx.fillText('ROTA PERFORMANS', textStartX, y + 60);

  ctx.fillStyle = CYAN_ACCENT;
  ctx.font = '600 22px "Plus Jakarta Sans", "Inter", sans-serif';
  ctx.fillText('PERFORMANS TEST FORMU', textStartX, y + 96);

  // Right side Test Date in Header
  ctx.textAlign = 'right';
  ctx.fillStyle = '#94A3B8';
  ctx.font = '500 18px "Plus Jakarta Sans", "Inter", sans-serif';
  ctx.fillText('TEST TARİHİ', margin + contentW - 36, y + 50);

  ctx.fillStyle = WHITE;
  ctx.font = 'bold 28px "Plus Jakarta Sans", "Inter", sans-serif';
  ctx.fillText(formatTurkishDate(form.testDate), margin + contentW - 36, y + 88);
  ctx.textAlign = 'left';

  y += headerH + 26;

  // Helper: Section Header
  const drawSectionHeader = (
    title: string,
    xPos: number,
    yPos: number,
    width: number
  ) => {
    const h = 44;
    ctx.fillStyle = COBALT_MID;
    ctx.fillRect(xPos, yPos, width, h);
    ctx.fillStyle = CYAN_ACCENT;
    ctx.fillRect(xPos, yPos, 10, h);
    ctx.fillStyle = WHITE;
    ctx.font = 'bold 21px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(title, xPos + 24, yPos + 29);
    return yPos + h;
  };

  // Helper: Labeled Value Box
  const drawFieldBox = (
    label: string,
    value: string,
    unit: string,
    xPos: number,
    yPos: number,
    width: number,
    height = 68
  ) => {
    ctx.fillStyle = SILVER_BG;
    ctx.fillRect(xPos, yPos, width, height);
    ctx.strokeStyle = BORDER;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(xPos, yPos, width, height);

    ctx.fillStyle = TEXT_MUTED;
    ctx.font = '600 16px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(label, xPos + 16, yPos + 24);

    const displayVal = value && value.trim() !== '' ? value.trim() : '—';
    ctx.fillStyle = TEXT_DARK;
    ctx.font = 'bold 22px "Plus Jakarta Sans", "Inter", sans-serif';
    ctx.fillText(displayVal, xPos + 16, yPos + 54);

    if (unit && value && value.trim() !== '') {
      const valWidth = ctx.measureText(displayVal).width;
      ctx.fillStyle = CYAN_DEEP;
      ctx.font = '600 16px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(unit, xPos + 22 + valWidth, yPos + 53);
    }
  };

  // 1. GENEL BİLGİLER (Adı Soyadı, Spor Kulübü, Doğum Tarihi, Test Tarihi)
  y = drawSectionHeader('1. GENEL BİLGİLER', margin, y, contentW);
  y += 10;
  const wName = contentW * 0.30;
  const wClub = contentW * 0.28;
  const wBirth = contentW * 0.19;
  const wTest = contentW - wName - wClub - wBirth - 36;

  drawFieldBox('Adı Soyadı', form.athleteName, '', margin, y, wName, 72);
  drawFieldBox(
    'Spor Kulübü',
    form.sportsClub || 'Belirtilmedi',
    '',
    margin + wName + 12,
    y,
    wClub,
    72
  );
  drawFieldBox(
    'Doğum Tarihi',
    form.birthDate ? formatTurkishDate(form.birthDate) : '',
    '',
    margin + wName + wClub + 24,
    y,
    wBirth,
    72
  );
  drawFieldBox(
    'Test Tarihi',
    form.testDate ? formatTurkishDate(form.testDate) : '',
    '',
    margin + wName + wClub + wBirth + 36,
    y,
    wTest,
    72
  );
  y += 96;

  // Row with 2. FİZİKSEL ÖLÇÜMLER & 3. PENÇE KUVVETİ (kg)
  const halfW = (contentW - 24) / 2;
  const row2Y = y;

  // Left: Fiziksel Ölçümler
  let leftY = drawSectionHeader('2. FİZİKSEL ÖLÇÜMLER', margin, row2Y, halfW);
  leftY += 10;
  const quarterW = (halfW - 12) / 2;
  drawFieldBox('Boy (cm)', form.heightCm, 'cm', margin, leftY, quarterW, 72);
  drawFieldBox(
    'Ağırlık (kg)',
    form.weightKg,
    'kg',
    margin + quarterW + 12,
    leftY,
    quarterW,
    72
  );

  // Right: Pençe Kuvveti (kg)
  const rightX = margin + halfW + 24;
  let rightY = drawSectionHeader('3. PENÇE KUVVETİ (kg)', rightX, row2Y, halfW);
  rightY += 10;
  drawFieldBox('Sağ', form.gripRightKg, 'kg', rightX, rightY, quarterW, 72);
  drawFieldBox(
    'Sol',
    form.gripLeftKg,
    'kg',
    rightX + quarterW + 12,
    rightY,
    quarterW,
    72
  );

  y = leftY + 96;

  // 4. FLAMİNGO DENGE (sn)
  y = drawSectionHeader('4. FLAMİNGO DENGE (sn)', margin, y, contentW);
  y += 10;

  const flamTableH = 44;
  ctx.fillStyle = SILVER_HEADER;
  ctx.fillRect(margin, y, contentW, flamTableH);
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(margin, y, contentW, flamTableH);

  const flamCol1 = contentW * 0.34;
  const flamCol2 = contentW * 0.33;
  const flamCol3 = contentW * 0.33;

  ctx.fillStyle = COBALT_MID;
  ctx.font = 'bold 17px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Yön', margin + 20, y + 28);
  ctx.fillText('1. Deneme (sn)', margin + flamCol1 + 20, y + 28);
  ctx.fillText('2. Deneme (sn)', margin + flamCol1 + flamCol2 + 20, y + 28);
  y += flamTableH;

  const drawFlamingoRow = (
    label: string,
    val1: string,
    val2: string,
    rowY: number
  ) => {
    const rH = 54;
    ctx.fillStyle = WHITE;
    ctx.fillRect(margin, rowY, contentW, rH);
    ctx.strokeStyle = BORDER;
    ctx.strokeRect(margin, rowY, flamCol1, rH);
    ctx.strokeRect(margin + flamCol1, rowY, flamCol2, rH);
    ctx.strokeRect(margin + flamCol1 + flamCol2, rowY, flamCol3, rH);

    ctx.fillStyle = TEXT_DARK;
    ctx.font = 'bold 19px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(label, margin + 20, rowY + 34);

    ctx.font = 'bold 21px "Plus Jakarta Sans", "Inter", sans-serif';
    ctx.fillText(val1 ? `${val1} sn` : '—', margin + flamCol1 + 20, rowY + 35);
    ctx.fillText(
      val2 ? `${val2} sn` : '—',
      margin + flamCol1 + flamCol2 + 20,
      rowY + 35
    );
    return rowY + rH;
  };

  y = drawFlamingoRow('Sağ', form.flamingoRight1, form.flamingoRight2, y);
  y = drawFlamingoRow('Sol', form.flamingoLeft1, form.flamingoLeft2, y);
  y += 26;

  // 5. PERFORMANS TESTLERİ
  y = drawSectionHeader('5. PERFORMANS TESTLERİ', margin, y, contentW);
  y += 10;

  const perfTests: [string, string, string][] = [
    ['20M Sprint (sn)', form.sprint20m, 'sn'],
    ['Esneklik Otur Eriş (cm)', form.sitAndReachCm, 'cm'],
    ['Kol Sürat Sağ (sn)', form.armSpeedRightSec, 'sn'],
    ['Kol Sürat Sol (sn)', form.armSpeedLeftSec, 'sn'],
    ['Durarak Uzun Atlama (cm)', form.standingLongJumpCm, 'cm'],
    ['10x5 Sürat (sn)', form.shuttleRun10x5Sec, 'sn'],
    ['Dikey Sıçrama (cm)', form.verticalJumpCm, 'cm'],
    ['Reaksiyon Testi (sn)', form.reactionTestSec, 'sn'],
  ];

  const perfColW = (contentW - 16) / 2;
  for (let i = 0; i < perfTests.length; i += 2) {
    const [labelL, valL, unitL] = perfTests[i];
    const [labelR, valR, unitR] = perfTests[i + 1];
    drawFieldBox(labelL, valL, unitL, margin, y, perfColW, 68);
    drawFieldBox(labelR, valR, unitR, margin + perfColW + 16, y, perfColW, 68);
    y += 78;
  }
  y += 16;

  // 6. DERİ KIVRIM KALINLIKLARI (mm)
  y = drawSectionHeader('6. DERİ KIVRIM KALINLIKLARI (mm)', margin, y, contentW);
  y += 10;
  const skinColW = (contentW - 36) / 4;
  drawFieldBox('Triceps', form.skinfoldTricepsMm, 'mm', margin, y, skinColW, 68);
  drawFieldBox(
    'Biceps',
    form.skinfoldBicepsMm,
    'mm',
    margin + skinColW + 12,
    y,
    skinColW,
    68
  );
  drawFieldBox(
    'Iliac',
    form.skinfoldIliacMm,
    'mm',
    margin + (skinColW + 12) * 2,
    y,
    skinColW,
    68
  );
  drawFieldBox(
    'Calf',
    form.skinfoldCalfMm,
    'mm',
    margin + (skinColW + 12) * 3,
    y,
    skinColW,
    68
  );
  y += 92;

  // 7. AİLE BİLGİLERİ
  y = drawSectionHeader('7. AİLE BİLGİLERİ', margin, y, contentW);
  y += 10;

  const drawParentBlock = (
    parentTitle: string,
    pHeight: string,
    pWeight: string,
    pHistory: string,
    xPos: number,
    yPos: number,
    blockW: number
  ) => {
    ctx.fillStyle = SILVER_HEADER;
    ctx.fillRect(xPos, yPos, blockW, 38);
    ctx.strokeStyle = BORDER;
    ctx.strokeRect(xPos, yPos, blockW, 38);
    ctx.fillStyle = COBALT_DARK;
    ctx.font = 'bold 18px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(parentTitle, xPos + 16, yPos + 26);

    const innerY = yPos + 46;
    const pHalfW = (blockW - 12) / 2;
    drawFieldBox('Boy (cm)', pHeight, 'cm', xPos, innerY, pHalfW, 66);
    drawFieldBox(
      'Kilo (kg)',
      pWeight,
      'kg',
      xPos + pHalfW + 12,
      innerY,
      pHalfW,
      66
    );

    drawFieldBox(
      'Spor Geçmişi (Min. 1 yıl herhangi bir branş)',
      pHistory,
      '',
      xPos,
      innerY + 76,
      blockW,
      72
    );
  };

  drawParentBlock(
    'ANNE',
    form.motherHeightCm,
    form.motherWeightKg,
    form.motherSportsHistory,
    margin,
    y,
    halfW
  );
  drawParentBlock(
    'BABA',
    form.fatherHeightCm,
    form.fatherWeightKg,
    form.fatherSportsHistory,
    margin + halfW + 24,
    y,
    halfW
  );

  // Official Footer Bar inside the A4 Sheet Frame
  const footerBarH = 54;
  const footerBarY = H - 140;

  ctx.fillStyle = SILVER_BG;
  ctx.fillRect(margin, footerBarY, contentW, footerBarH);
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(margin, footerBarY, contentW, footerBarH);

  // Left cyan accent bar on footer
  ctx.fillStyle = CYAN_ACCENT;
  ctx.fillRect(margin, footerBarY, 8, footerBarH);

  ctx.fillStyle = TEXT_MUTED;
  ctx.font = '600 17px "Plus Jakarta Sans", "Inter", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(
    `ROTA Performans – Dijital Performans Test Formu   |   Test Tarihi: ${formatTurkishDate(form.testDate)}`,
    margin + 24,
    footerBarY + 33
  );

  // Right aligned "Powered by Sporsepeti Bilişim Teknolojileri"
  const poweredPrefix = 'Powered by ';
  const poweredBrand = 'Sporsepeti Bilişim Teknolojileri';

  ctx.font = 'bold 18px "Plus Jakarta Sans", "Inter", sans-serif';
  const brandWidth = ctx.measureText(poweredBrand).width;

  ctx.textAlign = 'right';
  ctx.fillStyle = CYAN_DEEP;
  ctx.fillText(poweredBrand, margin + contentW - 24, footerBarY + 33);

  ctx.font = '600 17px "Plus Jakarta Sans", "Inter", sans-serif';
  ctx.fillStyle = COBALT_DARK;
  ctx.fillText(
    poweredPrefix,
    margin + contentW - 24 - brandWidth,
    footerBarY + 33
  );
  ctx.textAlign = 'left';

  // Export to A4 PDF
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const imgData = canvas.toDataURL('image/png', 1.0);
  pdf.addImage(imgData, 'PNG', 0, 0, 210, 297, undefined, 'FAST');

  const safeSlug = (form.athleteName || 'sporcu')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_ğüşıöç]/gi, '');
  const filename = `ROTA_Performans_${safeSlug || 'form'}_${form.testDate || 'test'}.pdf`;
  pdf.save(filename);
}
