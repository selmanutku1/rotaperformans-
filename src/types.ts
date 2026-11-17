export interface PerformanceTestFormValues {
  // Genel Bilgiler
  testDate: string;
  athleteName: string;
  sportsClub: string;
  birthDate: string;

  // Fiziksel Ölçümler
  heightCm: string;
  weightKg: string;

  // Pençe Kuvveti (kg)
  gripRightKg: string;
  gripLeftKg: string;

  // Flamingo Denge (sn) - Sağ / Sol (1. ve 2. deneme)
  flamingoRight1: string;
  flamingoRight2: string;
  flamingoLeft1: string;
  flamingoLeft2: string;

  // Performans Testleri
  sprint20m: string;
  sitAndReachCm: string;
  armSpeedRightSec: string;
  armSpeedLeftSec: string;
  standingLongJumpCm: string;
  shuttleRun10x5Sec: string;
  verticalJumpCm: string;
  reactionTestSec: string;

  // Deri Kıvrım Kalınlıkları (mm)
  skinfoldTricepsMm: string;
  skinfoldBicepsMm: string;
  skinfoldIliacMm: string;
  skinfoldCalfMm: string;

  // Aile Bilgileri - Anne
  motherHeightCm: string;
  motherWeightKg: string;
  motherSportsHistory: string;

  // Aile Bilgileri - Baba
  fatherHeightCm: string;
  fatherWeightKg: string;
  fatherSportsHistory: string;
}

export interface PerformanceTestRecord extends PerformanceTestFormValues {
  id: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  syncedToCloud?: boolean;
}

export interface SportsClubRecord {
  id: string;
  ownerId: string;
  name: string;
  branch: string;
  createdAt: string;
  syncedToCloud?: boolean;
}

export interface ClubAthleteRecord {
  id: string;
  ownerId: string;
  clubId: string;
  sportsClub: string;
  athleteName: string;
  birthDate: string;
  createdAt: string;
  syncedToCloud?: boolean;
}

// Validation constants synchronized verbatim with firebase-blueprint.json
export const BLUEPRINT_CONSTRAINTS = {
  ID_MAX_LENGTH: 128,
  ID_PATTERN: /^[a-zA-Z0-9_\-]+$/,
  DATE_MAX_LENGTH: 20,
  DATE_PATTERN: /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/,
  ATHLETE_NAME_MAX_LENGTH: 120,
  SPORTS_CLUB_MAX_LENGTH: 100,
  CLUB_BRANCH_MAX_LENGTH: 60,
  METRIC_MAX_LENGTH: 20,
  SPORTS_HISTORY_MAX_LENGTH: 300,
} as const;

export function getTodayIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function createEmptyFormValues(
  defaultClub = '',
  defaultAthleteName = '',
  defaultBirthDate = ''
): PerformanceTestFormValues {
  return {
    testDate: getTodayIsoDate(),
    athleteName: defaultAthleteName,
    sportsClub: defaultClub,
    birthDate: defaultBirthDate,
    heightCm: '',
    weightKg: '',
    gripRightKg: '',
    gripLeftKg: '',
    flamingoRight1: '',
    flamingoRight2: '',
    flamingoLeft1: '',
    flamingoLeft2: '',
    sprint20m: '',
    sitAndReachCm: '',
    armSpeedRightSec: '',
    armSpeedLeftSec: '',
    standingLongJumpCm: '',
    shuttleRun10x5Sec: '',
    verticalJumpCm: '',
    reactionTestSec: '',
    skinfoldTricepsMm: '',
    skinfoldBicepsMm: '',
    skinfoldIliacMm: '',
    skinfoldCalfMm: '',
    motherHeightCm: '',
    motherWeightKg: '',
    motherSportsHistory: '',
    fatherHeightCm: '',
    fatherWeightKg: '',
    fatherSportsHistory: '',
  };
}

export function sanitizeDecimalInput(raw: string): string {
  const cleaned = raw.replace(/[^0-9.,\-]/g, '');
  return cleaned.slice(0, BLUEPRINT_CONSTRAINTS.METRIC_MAX_LENGTH);
}

export function sanitizeFormPayload(
  values: PerformanceTestFormValues
): PerformanceTestFormValues {
  const safeDate =
    values.testDate && BLUEPRINT_CONSTRAINTS.DATE_PATTERN.test(values.testDate.trim())
      ? values.testDate.trim().slice(0, BLUEPRINT_CONSTRAINTS.DATE_MAX_LENGTH)
      : getTodayIsoDate();

  const safeName =
    values.athleteName.trim().slice(0, BLUEPRINT_CONSTRAINTS.ATHLETE_NAME_MAX_LENGTH) ||
    'İsimsiz Sporcu';

  const safeClub = (values.sportsClub || '')
    .trim()
    .slice(0, BLUEPRINT_CONSTRAINTS.SPORTS_CLUB_MAX_LENGTH);

  const trimMetric = (val: string) =>
    (val || '').trim().slice(0, BLUEPRINT_CONSTRAINTS.METRIC_MAX_LENGTH);

  const trimHistory = (val: string) =>
    (val || '').trim().slice(0, BLUEPRINT_CONSTRAINTS.SPORTS_HISTORY_MAX_LENGTH);

  return {
    testDate: safeDate,
    athleteName: safeName,
    sportsClub: safeClub,
    birthDate: trimMetric(values.birthDate),
    heightCm: trimMetric(values.heightCm),
    weightKg: trimMetric(values.weightKg),
    gripRightKg: trimMetric(values.gripRightKg),
    gripLeftKg: trimMetric(values.gripLeftKg),
    flamingoRight1: trimMetric(values.flamingoRight1),
    flamingoRight2: trimMetric(values.flamingoRight2),
    flamingoLeft1: trimMetric(values.flamingoLeft1),
    flamingoLeft2: trimMetric(values.flamingoLeft2),
    sprint20m: trimMetric(values.sprint20m),
    sitAndReachCm: trimMetric(values.sitAndReachCm),
    armSpeedRightSec: trimMetric(values.armSpeedRightSec),
    armSpeedLeftSec: trimMetric(values.armSpeedLeftSec),
    standingLongJumpCm: trimMetric(values.standingLongJumpCm),
    shuttleRun10x5Sec: trimMetric(values.shuttleRun10x5Sec),
    verticalJumpCm: trimMetric(values.verticalJumpCm),
    reactionTestSec: trimMetric(values.reactionTestSec),
    skinfoldTricepsMm: trimMetric(values.skinfoldTricepsMm),
    skinfoldBicepsMm: trimMetric(values.skinfoldBicepsMm),
    skinfoldIliacMm: trimMetric(values.skinfoldIliacMm),
    skinfoldCalfMm: trimMetric(values.skinfoldCalfMm),
    motherHeightCm: trimMetric(values.motherHeightCm),
    motherWeightKg: trimMetric(values.motherWeightKg),
    motherSportsHistory: trimHistory(values.motherSportsHistory),
    fatherHeightCm: trimMetric(values.fatherHeightCm),
    fatherWeightKg: trimMetric(values.fatherWeightKg),
    fatherSportsHistory: trimHistory(values.fatherSportsHistory),
  };
}

export function formatTurkishDate(isoDate: string): string {
  if (!isoDate) return '—';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}
