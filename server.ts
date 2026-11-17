import express from 'express';
import { createServer as createHttpServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ActiveCollabUser {
  sessionId: string;
  userName: string;
  activeSectionId: number | null;
  athleteName: string;
  sportsClub: string;
  updatedAt: number;
}

interface CategoryLock {
  sectionId: number;
  sessionId: string;
  userName: string;
  lockedAt: number;
}

const connectedClients = new Map<WebSocket, string>();
const activeUsers = new Map<string, ActiveCollabUser>();
const categoryLocks = new Map<number, CategoryLock>();
let sharedFormState: Record<string, string> = {};

const LOCK_TTL_MS = 1000 * 60 * 10; // 10 minutes auto-expiry for stale locks

function pruneStaleLocks() {
  const now = Date.now();
  for (const [secId, lock] of categoryLocks.entries()) {
    if (now - lock.lockedAt > LOCK_TTL_MS) {
      categoryLocks.delete(secId);
    }
  }
}

function broadcastState() {
  pruneStaleLocks();
  const payload = JSON.stringify({
    type: 'collab:state',
    users: Array.from(activeUsers.values()),
    locks: Array.from(categoryLocks.values()),
    sharedFormState,
  });

  for (const client of connectedClients.keys()) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;
  const httpServer = createHttpServer(app);

  app.use(express.json({ limit: '5mb' }));

  // Health & current locks REST endpoint
  app.get('/api/collab-state', (_req, res) => {
    pruneStaleLocks();
    res.json({
      users: Array.from(activeUsers.values()),
      locks: Array.from(categoryLocks.values()),
      sharedFormState,
    });
  });

  // In-memory cache of latest synced records & last webhook delivery for external systems
  let latestSyncedRecords: Record<string, unknown>[] = [];
  let lastWebhookDelivery: {
    sentAt: string;
    targetUrl: string;
    event: string;
    recordCount: number;
    statusCode: number;
    ok: boolean;
  } | null = null;

  const DEFAULT_WEBHOOK_TARGET_URL =
    'https://ais-dev-ure73sbmiunotntj5gxxy3-80416778425.europe-west1.run.app/api/webhooks/sportsfly-lab';

  // Format a raw performance test record into a structured, developer-friendly Webhook JSON object
  const formatWebhookRecord = (raw: Record<string, unknown>) => {
    const toNumOrNull = (val: unknown): number | null => {
      if (val === undefined || val === null || String(val).trim() === '') {
        return null;
      }
      const parsed = Number(String(val).replace(',', '.'));
      return Number.isFinite(parsed) ? parsed : null;
    };

    const athleteName = String(raw.athleteName || '');
    const sportsClub = String(raw.sportsClub || '');
    const birthDate = String(raw.birthDate || '');
    const testDate = String(raw.testDate || '');

    return {
      id: String(raw.id || `rota_${Date.now()}`),
      testDate,
      athleteName,
      sportsClub,
      clubName: sportsClub,
      birthDate,
      heightCm: toNumOrNull(raw.heightCm),
      weightKg: toNumOrNull(raw.weightKg),
      gripRightKg: toNumOrNull(raw.gripRightKg),
      gripLeftKg: toNumOrNull(raw.gripLeftKg),
      flamingoRight1: toNumOrNull(raw.flamingoRight1),
      flamingoRight2: toNumOrNull(raw.flamingoRight2),
      flamingoLeft1: toNumOrNull(raw.flamingoLeft1),
      flamingoLeft2: toNumOrNull(raw.flamingoLeft2),
      sprint20m: toNumOrNull(raw.sprint20m),
      sitAndReachCm: toNumOrNull(raw.sitAndReachCm),
      armSpeedRightSec: toNumOrNull(raw.armSpeedRightSec),
      armSpeedLeftSec: toNumOrNull(raw.armSpeedLeftSec),
      standingLongJumpCm: toNumOrNull(raw.standingLongJumpCm),
      shuttleRun10x5Sec: toNumOrNull(raw.shuttleRun10x5Sec),
      verticalJumpCm: toNumOrNull(raw.verticalJumpCm),
      reactionTestSec: toNumOrNull(raw.reactionTestSec),
      skinfoldTricepsMm: toNumOrNull(raw.skinfoldTricepsMm),
      skinfoldBicepsMm: toNumOrNull(raw.skinfoldBicepsMm),
      skinfoldIliacMm: toNumOrNull(raw.skinfoldIliacMm),
      skinfoldCalfMm: toNumOrNull(raw.skinfoldCalfMm),
      motherHeightCm: toNumOrNull(raw.motherHeightCm),
      motherWeightKg: toNumOrNull(raw.motherWeightKg),
      motherSportsHistory: String(raw.motherSportsHistory || ''),
      fatherHeightCm: toNumOrNull(raw.fatherHeightCm),
      fatherWeightKg: toNumOrNull(raw.fatherWeightKg),
      fatherSportsHistory: String(raw.fatherSportsHistory || ''),
      createdAt: String(raw.createdAt || new Date().toISOString()),
      updatedAt: String(raw.updatedAt || new Date().toISOString()),
      athlete: {
        name: athleteName,
        athleteName,
        sportsClub,
        clubName: sportsClub,
        birthDate,
      },
      physicalMeasurements: {
        heightCm: toNumOrNull(raw.heightCm),
        weightKg: toNumOrNull(raw.weightKg),
      },
      gripStrengthKg: {
        rightKg: toNumOrNull(raw.gripRightKg),
        leftKg: toNumOrNull(raw.gripLeftKg),
      },
      flamingoBalanceSec: {
        rightAttempt1Sec: toNumOrNull(raw.flamingoRight1),
        rightAttempt2Sec: toNumOrNull(raw.flamingoRight2),
        leftAttempt1Sec: toNumOrNull(raw.flamingoLeft1),
        leftAttempt2Sec: toNumOrNull(raw.flamingoLeft2),
      },
      performanceTests: {
        sprint20mSec: toNumOrNull(raw.sprint20m),
        sitAndReachCm: toNumOrNull(raw.sitAndReachCm),
        armSpeedRightSec: toNumOrNull(raw.armSpeedRightSec),
        armSpeedLeftSec: toNumOrNull(raw.armSpeedLeftSec),
        standingLongJumpCm: toNumOrNull(raw.standingLongJumpCm),
        shuttleRun10x5Sec: toNumOrNull(raw.shuttleRun10x5Sec),
        verticalJumpCm: toNumOrNull(raw.verticalJumpCm),
        reactionTestSec: toNumOrNull(raw.reactionTestSec),
      },
      skinfoldThicknessMm: {
        tricepsMm: toNumOrNull(raw.skinfoldTricepsMm),
        bicepsMm: toNumOrNull(raw.skinfoldBicepsMm),
        iliacMm: toNumOrNull(raw.skinfoldIliacMm),
        calfMm: toNumOrNull(raw.skinfoldCalfMm),
      },
      familyInfo: {
        mother: {
          heightCm: toNumOrNull(raw.motherHeightCm),
          weightKg: toNumOrNull(raw.motherWeightKg),
          sportsHistoryMin1Year: String(raw.motherSportsHistory || ''),
        },
        father: {
          heightCm: toNumOrNull(raw.fatherHeightCm),
          weightKg: toNumOrNull(raw.fatherWeightKg),
          sportsHistoryMin1Year: String(raw.fatherSportsHistory || ''),
        },
      },
      rawFields: raw,
    };
  };

  // Built-in test webhook receiver endpoint (/api/webhook/echo) so users can test webhook delivery immediately
  app.post('/api/webhook/echo', (req, res) => {
    res.status(200).json({
      received: true,
      receivedAt: new Date().toISOString(),
      event: req.body?.event || 'performance_test.saved',
      count: Array.isArray(req.body?.data) ? req.body.data.length : 1,
      message: 'ROTA Performans Webhook verisi başarıyla alındı.',
    });
  });

  // Sync records from client state so external software can pull /api/v1/tests anytime
  app.post('/api/v1/tests/sync', (req, res) => {
    const incomingList: Record<string, unknown>[] = Array.isArray(
      req.body?.records
    )
      ? req.body.records
      : [];
    if (incomingList.length > 0) {
      const byId = new Map<string, Record<string, unknown>>();
      for (const existing of latestSyncedRecords) {
        if (existing.id) byId.set(String(existing.id), existing);
      }
      for (const rec of incomingList) {
        if (rec && typeof rec === 'object') {
          byId.set(String(rec.id || `rota_${Date.now()}`), rec);
        }
      }
      latestSyncedRecords = Array.from(byId.values());
    }
    res.json({ ok: true, count: latestSyncedRecords.length });
  });

  // Public JSON API Feed (/api/v1/tests) for external software to pull synced forms anytime
  app.get('/api/v1/tests', (req, res) => {
    const clubFilter = String(req.query.club || '').trim().toLowerCase();
    const formatted = latestSyncedRecords
      .map((r) => formatWebhookRecord(r))
      .filter((item) =>
        clubFilter
          ? item.athlete.sportsClub.toLowerCase().includes(clubFilter)
          : true
      );

    res.json({
      source: 'ROTA Performans - Dijital Ölçüm Sistemi',
      provider: 'Sporsepeti Bilişim Teknolojileri',
      exportedAt: new Date().toISOString(),
      count: formatted.length,
      lastWebhookDelivery,
      data: formatted,
    });
  });

  // Helper to execute webhook POST with manual redirect checking & ais-pre public token handshake
  async function postWebhookWithDiagnostics(
    targetUrl: string,
    payloadJson: string,
    eventName: string
  ): Promise<{
    ok: boolean;
    statusCode: number;
    responseText: string;
    error?: string;
  }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'ROTA-Performans-Webhook/1.0',
      'X-Rota-Event': eventName,
      'X-Rota-Provider': 'Sporsepeti Bilisim Teknolojileri',
    };

    const parsedUrl = new URL(targetUrl);
    const isAisPre = parsedUrl.hostname.startsWith('ais-pre-');
    const isAisDev = parsedUrl.hostname.startsWith('ais-dev-');

    const doPost = async (extraCookie?: string) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        return await fetch(targetUrl, {
          method: 'POST',
          headers: extraCookie
            ? { ...headers, Cookie: extraCookie }
            : headers,
          body: payloadJson,
          redirect: 'manual',
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    };

    let response = await doPost(
      isAisPre ? '__SECURE-aistudio_auth_token=one_token_to_rule_them_all' : undefined
    );

    // For AI Studio Shared (ais-pre) containers, first request may warm auth_token_cache and return 302.
    // Warm the cache via GET and immediately retry the POST.
    if (isAisPre && response.status >= 300 && response.status < 400) {
      const publicCookie =
        '__SECURE-aistudio_auth_token=one_token_to_rule_them_all';
      const warmController = new AbortController();
      const warmTimeout = setTimeout(() => warmController.abort(), 8000);
      try {
        await fetch(parsedUrl.origin + '/', {
          method: 'GET',
          headers: { Cookie: publicCookie },
          redirect: 'manual',
          signal: warmController.signal,
        });
      } finally {
        clearTimeout(warmTimeout);
      }
      response = await doPost(publicCookie);
    }

    const location = response.headers.get('location') || '';
    const contentType = response.headers.get('content-type') || '';
    const responseText = await response.text().catch(() => '');

    // Detect AI Studio Auth Bridge / Cookie Check redirects (never treat as 200 OK!)
    if (response.status >= 300 && response.status < 400) {
      const isAuthWall =
        location.includes('__cookie_check') ||
        location.includes('applet-auth-bridge') ||
        responseText.includes('302 Found');

      if (isAuthWall && isAisDev) {
        return {
          ok: false,
          statusCode: response.status,
          responseText,
          error:
            'Hedef adres "ais-dev-" (özel geliştirici önizleme) adresi olduğu için Google oturum duvarına (HTTP 302) takıldı ve karşı yazılıma ulaşamadı. Karşı uygulamayı yayınlayıp (Share) "ais-pre-" veya Cloud Run adresini kullanmalısınız.',
        };
      }

      return {
        ok: false,
        statusCode: response.status,
        responseText,
        error: `Hedef sunucu yönlendirme (HTTP ${response.status} -> ${location || 'bilinmiyor'}) döndürdü. Webhook isteği hedef rotaya ulaşamadı.`,
      };
    }

    // Detect HTML auth check / warmup / 404 Cannot POST pages
    if (
      contentType.includes('text/html') &&
      (responseText.includes('Cookie check') ||
        responseText.includes('applet-auth-bridge'))
    ) {
      return {
        ok: false,
        statusCode: 401,
        responseText,
        error:
          'Hedef URL AI Studio oturum doğrulama sayfası döndürdü. Lütfen "ais-dev-" yerine yayınlanmış (ais-pre- veya Cloud Run) adresi kullanın.',
      };
    }

    if (response.status === 404) {
      return {
        ok: false,
        statusCode: 404,
        responseText,
        error: `Hedef sunucuya ulaşıldı ancak "${parsedUrl.pathname}" uç noktası bulunamadı (HTTP 404). Karşı uygulamayı güncellediğinizden/yayınladığınızdan emin olun.`,
      };
    }

    return {
      ok: response.ok,
      statusCode: response.status,
      responseText,
      error: response.ok
        ? undefined
        : `Hedef sunucu HTTP ${response.status} hata yanıtı döndürdü.`,
    };
  }

  // Server-side Webhook Dispatcher (/api/webhook/dispatch)
  // Forwards saved form records via HTTP POST to the target external software URL (avoids browser CORS limits)
  app.post('/api/webhook/dispatch', async (req, res) => {
    try {
      const rawTargetUrl = String(
        req.body?.targetUrl ||
          process.env.WEBHOOK_TARGET_URL ||
          DEFAULT_WEBHOOK_TARGET_URL
      ).trim();
      const eventName = String(
        req.body?.event || 'performance_test.saved'
      ).trim();
      const recordsInput: Record<string, unknown>[] = Array.isArray(
        req.body?.records
      )
        ? req.body.records
        : req.body?.record
          ? [req.body.record]
          : [];

      if (recordsInput.length > 0) {
        // Merge into latestSyncedRecords cache for /api/v1/tests
        const byId = new Map<string, Record<string, unknown>>();
        for (const existing of latestSyncedRecords) {
          byId.set(String(existing.id || ''), existing);
        }
        for (const incoming of recordsInput) {
          byId.set(String(incoming.id || `rota_${Date.now()}`), incoming);
        }
        latestSyncedRecords = Array.from(byId.values());
      }

      if (!rawTargetUrl) {
        res.status(400).json({
          ok: false,
          error: 'Lütfen geçerli bir Hedef Webhook URL adresi girin.',
        });
        return;
      }

      // Resolve relative URLs (like /api/webhook/echo) to local server URL
      const resolvedUrl = rawTargetUrl.startsWith('/')
        ? `http://127.0.0.1:${PORT}${rawTargetUrl}`
        : rawTargetUrl;

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(resolvedUrl);
        if (
          parsedUrl.protocol !== 'http:' &&
          parsedUrl.protocol !== 'https:'
        ) {
          throw new Error('Invalid protocol');
        }
      } catch {
        res.status(400).json({
          ok: false,
          error:
            'Geçersiz Webhook URL formatı. Adres http:// veya https:// ile başlamalıdır.',
        });
        return;
      }

      const formattedData = recordsInput.map((rec) =>
        formatWebhookRecord(rec)
      );
      const primaryRecord = formattedData[0] || {};

      const webhookPayload = {
        ...primaryRecord,
        event: eventName,
        source: 'ROTA Performans - Dijital Performans Test Formu',
        provider: 'Sporsepeti Bilişim Teknolojileri',
        sentAt: new Date().toISOString(),
        count: formattedData.length,
        record: formattedData[0] || null,
        records: formattedData,
        data: formattedData,
      };

      const delivery = await postWebhookWithDiagnostics(
        parsedUrl.toString(),
        JSON.stringify(webhookPayload),
        eventName
      );

      lastWebhookDelivery = {
        sentAt: webhookPayload.sentAt,
        targetUrl: rawTargetUrl,
        event: eventName,
        recordCount: formattedData.length,
        statusCode: delivery.statusCode,
        ok: delivery.ok,
      };

      res.status(200).json({
        ok: delivery.ok,
        statusCode: delivery.statusCode,
        targetUrl: rawTargetUrl,
        sentAt: webhookPayload.sentAt,
        count: formattedData.length,
        error: delivery.error,
        responsePreview: delivery.responseText.slice(0, 300),
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Bilinmeyen bağlantı hatası';
      res.status(200).json({
        ok: false,
        statusCode: 0,
        error: `Hedef sunucuya ulaşılamadı: ${message}`,
      });
    }
  });

  // WebSocket Server for Real-Time Multi-User Category Locking & Live Field Sync
  const wss = new WebSocketServer({ server: httpServer, path: '/ws-collab' });

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (!msg || typeof msg !== 'object') return;

        const sessionId = String(msg.sessionId || '').slice(0, 80);
        const userName = String(msg.userName || 'Kullanıcı').slice(0, 60);
        if (!sessionId) return;

        connectedClients.set(ws, sessionId);

        if (msg.type === 'user:join' || msg.type === 'user:heartbeat') {
          const existing = activeUsers.get(sessionId);
          activeUsers.set(sessionId, {
            sessionId,
            userName,
            activeSectionId: existing?.activeSectionId ?? null,
            athleteName: String(msg.athleteName || existing?.athleteName || '').slice(0, 120),
            sportsClub: String(msg.sportsClub || existing?.sportsClub || '').slice(0, 120),
            updatedAt: Date.now(),
          });
          // Refresh lock timestamp if user holds one
          for (const [secId, lock] of categoryLocks.entries()) {
            if (lock.sessionId === sessionId) {
              categoryLocks.set(secId, {
                ...lock,
                userName,
                lockedAt: Date.now(),
              });
            }
          }
          broadcastState();
        } else if (msg.type === 'category:lock') {
          const sectionId = Number(msg.sectionId);
          if (!Number.isInteger(sectionId) || sectionId < 1 || sectionId > 7) {
            return;
          }
          pruneStaleLocks();
          const currentLock = categoryLocks.get(sectionId);

          // If locked by another active user, reject and broadcast current state
          if (currentLock && currentLock.sessionId !== sessionId) {
            ws.send(
              JSON.stringify({
                type: 'category:lock_rejected',
                sectionId,
                lockedBy: currentLock.userName,
              })
            );
            broadcastState();
            return;
          }

          // Release any previous section lock held by this same user (each user locks 1 active category at a time)
          for (const [secId, lock] of categoryLocks.entries()) {
            if (lock.sessionId === sessionId && secId !== sectionId) {
              categoryLocks.delete(secId);
            }
          }

          // Section 1 (Genel Bilgiler - Sporcu/Kulüp seçimi) or Sections 2-7 lock
          categoryLocks.set(sectionId, {
            sectionId,
            sessionId,
            userName,
            lockedAt: Date.now(),
          });

          const existing = activeUsers.get(sessionId);
          activeUsers.set(sessionId, {
            sessionId,
            userName,
            activeSectionId: sectionId,
            athleteName: String(msg.athleteName || existing?.athleteName || '').slice(0, 120),
            sportsClub: String(msg.sportsClub || existing?.sportsClub || '').slice(0, 120),
            updatedAt: Date.now(),
          });

          broadcastState();
        } else if (msg.type === 'category:unlock') {
          const sectionId = Number(msg.sectionId);
          if (Number.isInteger(sectionId)) {
            const currentLock = categoryLocks.get(sectionId);
            if (currentLock && currentLock.sessionId === sessionId) {
              categoryLocks.delete(sectionId);
            }
          } else {
            for (const [secId, lock] of categoryLocks.entries()) {
              if (lock.sessionId === sessionId) {
                categoryLocks.delete(secId);
              }
            }
          }

          const existing = activeUsers.get(sessionId);
          if (existing) {
            activeUsers.set(sessionId, {
              ...existing,
              activeSectionId: null,
              updatedAt: Date.now(),
            });
          }
          broadcastState();
        } else if (msg.type === 'field:update') {
          const sectionId = Number(msg.sectionId);
          const field = String(msg.field || '');
          const value = String(msg.value ?? '').slice(0, 250);

          // Check that the section is not locked by someone else
          const currentLock = categoryLocks.get(sectionId);
          if (currentLock && currentLock.sessionId !== sessionId) {
            ws.send(
              JSON.stringify({
                type: 'category:lock_rejected',
                sectionId,
                lockedBy: currentLock.userName,
              })
            );
            return;
          }

          // Automatically acquire/refresh lock on this category for the editing user
          if (Number.isInteger(sectionId) && sectionId >= 1 && sectionId <= 7) {
            for (const [secId, lock] of categoryLocks.entries()) {
              if (lock.sessionId === sessionId && secId !== sectionId) {
                categoryLocks.delete(secId);
              }
            }
            categoryLocks.set(sectionId, {
              sectionId,
              sessionId,
              userName,
              lockedAt: Date.now(),
            });
          }

          if (field) {
            sharedFormState[field] = value;
          }

          const deltaPayload = JSON.stringify({
            type: 'field:delta',
            sessionId,
            userName,
            sectionId,
            field,
            value,
          });

          for (const [clientWs] of connectedClients.entries()) {
            if (clientWs !== ws && clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(deltaPayload);
            }
          }
          broadcastState();
        } else if (msg.type === 'form:reset') {
          sharedFormState = msg.formValues && typeof msg.formValues === 'object' ? { ...msg.formValues } : {};
          categoryLocks.clear();
          const resetPayload = JSON.stringify({
            type: 'form:reset_broadcast',
            sessionId,
            userName,
            formValues: sharedFormState,
          });
          for (const [clientWs] of connectedClients.entries()) {
            if (clientWs !== ws && clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(resetPayload);
            }
          }
          broadcastState();
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on('close', () => {
      const sessionId = connectedClients.get(ws);
      connectedClients.delete(ws);
      if (sessionId) {
        // Check if user still has another open socket
        const stillConnected = Array.from(connectedClients.values()).includes(
          sessionId
        );
        if (!stillConnected) {
          activeUsers.delete(sessionId);
          for (const [secId, lock] of categoryLocks.entries()) {
            if (lock.sessionId === sessionId) {
              categoryLocks.delete(secId);
            }
          }
          broadcastState();
        }
      }
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*all', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`ROTA Performans Server listening on http://localhost:${PORT}`);
  });
}

startServer();
