# Security Specification — ROTA Performans Dijital Test Formu

## 1. Data Invariants

1. **Authentication & Verification Invariant**: Every read and write operation on `/performanceTests/{testId}` requires a signed-in user (`request.auth != null`) with a verified email (`request.auth.token.email_verified == true`).
2. **Ownership Invariant**: A `PerformanceTest` document's `ownerId` must strictly equal `request.auth.uid` upon creation and remain immutable across all updates (`incoming().ownerId == existing().ownerId`).
3. **Strict Schema & Volumetric Invariant**: Every document in `/performanceTests/{testId}` must contain the exact 32 keys defined in `firebase-blueprint.json` (`hasAll` and `hasOnly`), with every string field bounded by explicit `.size()` constraints (`athleteName` 1..120, `testDate` 1..20 matching `^[0-9]{4}-[0-9]{2}-[0-9]{2}$`, measurement strings `<= 20`, parent sports history `<= 300`).
4. **Temporal Integrity Invariant**: `createdAt` must equal `request.time` on creation and remain immutable on update. `updatedAt` must equal `request.time` on both creation and update.
5. **Query Isolation Invariant**: `list` queries on `/performanceTests` must enforce `resource.data.ownerId == request.auth.uid` so no user can list another user's athlete test records.

## 2. The "Dirty Dozen" Payloads

1. **Unauthenticated Write**: Creating a test document with `auth == null`.
2. **Unverified Email Spoof**: Creating a test document with `email_verified: false`.
3. **Identity Spoofing on Create**: Setting `ownerId: "victim-uid"` when `request.auth.uid == "attacker-uid"`.
4. **Shadow Field Injection on Create**: Adding `"isAdmin": true` or `"extraField": "hack"` alongside required fields.
5. **Missing Required Field on Create**: Omitting `flamingoRight1` or `fatherSportsHistory`.
6. **Oversized String Denial-of-Wallet**: Sending a 5,000-character string in `athleteName` (limit 120) or `motherSportsHistory` (limit 300).
7. **Invalid Date Format**: Sending `testDate: "16/11/2026"` instead of `YYYY-MM-DD`.
8. **Forged Client Timestamp on Create**: Passing a past timestamp for `createdAt` instead of `request.time`.
9. **Ownership Hijack on Update**: Modifying `ownerId` during an update operation.
10. **Immortal Field Mutation on Update**: Modifying `createdAt` during an update operation.
11. **Value Poisoning on Update**: Updating `heightCm` with a number or boolean instead of a bounded string (`<= 20`).
12. **Cross-Tenant List Scraping**: Executing an unfiltered `list` query or reading a document where `resource.data.ownerId != request.auth.uid`.
