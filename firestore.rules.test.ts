/**
 * Firestore Security Rules Specification Tests (Dirty Dozen Verification)
 * Verifies that all 12 adversarial payloads described in security_spec.md are denied.
 */

export interface SecurityTestCase {
  id: number;
  name: string;
  operation: 'create' | 'update' | 'get' | 'list' | 'delete';
  auth: { uid: string; email_verified: boolean } | null;
  docId: string;
  payload?: Record<string, unknown>;
  expectedResult: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_TESTS: SecurityTestCase[] = [
  {
    id: 1,
    name: 'Unauthenticated Write',
    operation: 'create',
    auth: null,
    docId: 'test_001',
    payload: { ownerId: 'user_1', athleteName: 'Ali Yılmaz', testDate: '2026-11-16' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Unverified Email Spoof',
    operation: 'create',
    auth: { uid: 'user_1', email_verified: false },
    docId: 'test_002',
    payload: { ownerId: 'user_1', athleteName: 'Ali Yılmaz', testDate: '2026-11-16' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Identity Spoofing on Create',
    operation: 'create',
    auth: { uid: 'attacker_uid', email_verified: true },
    docId: 'test_003',
    payload: { ownerId: 'victim_uid', athleteName: 'Ali Yılmaz', testDate: '2026-11-16' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Shadow Field Injection on Create',
    operation: 'create',
    auth: { uid: 'user_1', email_verified: true },
    docId: 'test_004',
    payload: { ownerId: 'user_1', athleteName: 'Ali Yılmaz', testDate: '2026-11-16', isVerified: true },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Missing Required Field on Create',
    operation: 'create',
    auth: { uid: 'user_1', email_verified: true },
    docId: 'test_005',
    payload: { ownerId: 'user_1', athleteName: 'Ali Yılmaz' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Oversized String Denial-of-Wallet',
    operation: 'create',
    auth: { uid: 'user_1', email_verified: true },
    docId: 'test_006',
    payload: { ownerId: 'user_1', athleteName: 'A'.repeat(500), testDate: '2026-11-16' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Invalid Date Format',
    operation: 'create',
    auth: { uid: 'user_1', email_verified: true },
    docId: 'test_007',
    payload: { ownerId: 'user_1', athleteName: 'Ali Yılmaz', testDate: '16-11-2026' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Forged Client Timestamp on Create',
    operation: 'create',
    auth: { uid: 'user_1', email_verified: true },
    docId: 'test_008',
    payload: { ownerId: 'user_1', athleteName: 'Ali Yılmaz', testDate: '2026-11-16', createdAt: '2020-01-01T00:00:00Z' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Ownership Hijack on Update',
    operation: 'update',
    auth: { uid: 'user_1', email_verified: true },
    docId: 'test_009',
    payload: { ownerId: 'user_2' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Immortal Field Mutation on Update',
    operation: 'update',
    auth: { uid: 'user_1', email_verified: true },
    docId: 'test_010',
    payload: { createdAt: '2026-01-01T00:00:00Z' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Value Poisoning on Update',
    operation: 'update',
    auth: { uid: 'user_1', email_verified: true },
    docId: 'test_011',
    payload: { heightCm: 180 },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Cross-Tenant List Scraping',
    operation: 'list',
    auth: { uid: 'attacker_uid', email_verified: true },
    docId: '*',
    expectedResult: 'PERMISSION_DENIED',
  },
];
