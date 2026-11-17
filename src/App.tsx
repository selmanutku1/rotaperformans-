/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  Component,
  ErrorInfo,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  Building2,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Copy,
  Download,
  Edit3,
  Eye,
  FileText,
  FolderOpen,
  Layers,
  ListChecks,
  Lock,
  Maximize2,
  Menu,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  Printer,
  RotateCcw,
  Save,
  Search,
  Send,
  Trash2,
  UserPlus,
  Webhook,
  X,
} from 'lucide-react';
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
} from './firebase';
import {
  BLUEPRINT_CONSTRAINTS,
  ClubAthleteRecord,
  createEmptyFormValues,
  formatTurkishDate,
  getTodayIsoDate,
  PerformanceTestFormValues,
  PerformanceTestRecord,
  sanitizeDecimalInput,
  sanitizeFormPayload,
  SportsClubRecord,
} from './types';
import {
  exportMultipleTestsToExcel,
  exportSingleTestToExcel,
} from './utils/excelExport';
import { downloadPerformanceTestPdf } from './utils/pdfExport';

const LOCAL_STORAGE_KEY = 'rota_performans_saved_tests_v2';
const LOCAL_CLUBS_KEY = 'rota_performans_clubs_v1';
const LOCAL_ATHLETES_KEY = 'rota_performans_athletes_v1';
const LOCAL_WEBHOOK_KEY = 'rota_performans_webhook_config_v2';
const DEFAULT_WEBHOOK_URL =
  'https://ais-dev-ure73sbmiunotntj5gxxy3-80416778425.europe-west1.run.app/api/webhooks/sportsfly-lab';
const ROTA_LOGO_PATH = '/assets/aistudio/download_3d50004a.png';
const UNASSIGNED_CLUB_LABEL = 'Kulüp Belirtilmemiş';

interface WebhookConfig {
  targetUrl: string;
  autoSendOnSave: boolean;
}

function loadWebhookConfig(): WebhookConfig {
  try {
    const raw = localStorage.getItem(LOCAL_WEBHOOK_KEY);
    if (!raw) {
      return { targetUrl: DEFAULT_WEBHOOK_URL, autoSendOnSave: true };
    }
    const parsed = JSON.parse(raw);
    const savedUrl = String(parsed?.targetUrl || '').trim();
    return {
      targetUrl: savedUrl || DEFAULT_WEBHOOK_URL,
      autoSendOnSave: parsed?.autoSendOnSave !== false,
    };
  } catch {
    return { targetUrl: DEFAULT_WEBHOOK_URL, autoSendOnSave: true };
  }
}

function saveWebhookConfig(config: WebhookConfig): void {
  try {
    localStorage.setItem(LOCAL_WEBHOOK_KEY, JSON.stringify(config));
  } catch {
    // Ignore
  }
}

const FORM_SECTIONS = [
  { id: 1, anchor: 'section-1', shortTitle: '1. Genel', fullTitle: '1. Genel Bilgiler' },
  { id: 2, anchor: 'section-2', shortTitle: '2. Fiziksel', fullTitle: '2. Fiziksel Ölçümler' },
  { id: 3, anchor: 'section-3', shortTitle: '3. Pençe', fullTitle: '3. Pençe Kuvveti (kg)' },
  { id: 4, anchor: 'section-4', shortTitle: '4. Flamingo', fullTitle: '4. Flamingo Denge (sn)' },
  { id: 5, anchor: 'section-5', shortTitle: '5. Performans', fullTitle: '5. Performans Testleri' },
  { id: 6, anchor: 'section-6', shortTitle: '6. Deri Kıvrım', fullTitle: '6. Deri Kıvrım Kalınlıkları' },
  { id: 7, anchor: 'section-7', shortTitle: '7. Aile', fullTitle: '7. Aile Bilgileri' },
] as const;

const FIELD_TO_SECTION_MAP: Record<keyof PerformanceTestFormValues, number> = {
  testDate: 1,
  athleteName: 1,
  sportsClub: 1,
  birthDate: 1,
  heightCm: 2,
  weightKg: 2,
  gripRightKg: 3,
  gripLeftKg: 3,
  flamingoRight1: 4,
  flamingoRight2: 4,
  flamingoLeft1: 4,
  flamingoLeft2: 4,
  sprint20m: 5,
  sitAndReachCm: 5,
  armSpeedRightSec: 5,
  armSpeedLeftSec: 5,
  standingLongJumpCm: 5,
  shuttleRun10x5Sec: 5,
  verticalJumpCm: 5,
  reactionTestSec: 5,
  skinfoldTricepsMm: 6,
  skinfoldBicepsMm: 6,
  skinfoldIliacMm: 6,
  skinfoldCalfMm: 6,
  motherHeightCm: 7,
  motherWeightKg: 7,
  motherSportsHistory: 7,
  fatherHeightCm: 7,
  fatherWeightKg: 7,
  fatherSportsHistory: 7,
};

interface CollabCategoryLock {
  sectionId: number;
  sessionId: string;
  userName: string;
  lockedAt: number;
}

interface CollabActiveUser {
  sessionId: string;
  userName: string;
  activeSectionId: number | null;
}

function getOrCreateSessionIdentity(): { sessionId: string; defaultName: string } {
  try {
    let sid = sessionStorage.getItem('rota_collab_session_id');
    if (!sid) {
      const randNum = Math.floor(100 + Math.random() * 900);
      sid = `usr_${Date.now()}_${randNum}`;
      sessionStorage.setItem('rota_collab_session_id', sid);
    }
    return { sessionId: sid, defaultName: 'Kullanıcı' };
  } catch {
    const randNum = Math.floor(100 + Math.random() * 900);
    return {
      sessionId: `usr_${Date.now()}_${randNum}`,
      defaultName: 'Kullanıcı',
    };
  }
}

const INITIAL_DEMO_CLUBS: SportsClubRecord[] = [
  {
    id: 'club_rota_101',
    ownerId: 'local_user',
    name: 'ROTA Akademi SK',
    branch: 'Futbol / Atletik Performans',
    createdAt: '2026-11-01T09:00:00.000Z',
    syncedToCloud: false,
  },
  {
    id: 'club_rota_102',
    ownerId: 'local_user',
    name: 'Anadolu Yıldızları SK',
    branch: 'Basketbol / Voleybol',
    createdAt: '2026-11-02T09:00:00.000Z',
    syncedToCloud: false,
  },
];

const INITIAL_DEMO_ATHLETES: ClubAthleteRecord[] = [
  {
    id: 'ath_rota_201',
    ownerId: 'local_user',
    clubId: 'club_rota_101',
    sportsClub: 'ROTA Akademi SK',
    athleteName: 'Kerem Aktürkoğlu',
    birthDate: '2011-04-12',
    createdAt: '2026-11-05T09:00:00.000Z',
    syncedToCloud: false,
  },
  {
    id: 'ath_rota_202',
    ownerId: 'local_user',
    clubId: 'club_rota_101',
    sportsClub: 'ROTA Akademi SK',
    athleteName: 'Efe Can Yılmaz',
    birthDate: '2011-11-05',
    createdAt: '2026-11-05T09:10:00.000Z',
    syncedToCloud: false,
  },
  {
    id: 'ath_rota_203',
    ownerId: 'local_user',
    clubId: 'club_rota_102',
    sportsClub: 'Anadolu Yıldızları SK',
    athleteName: 'Zeynep Demir',
    birthDate: '2012-08-23',
    createdAt: '2026-11-06T10:00:00.000Z',
    syncedToCloud: false,
  },
];

const INITIAL_DEMO_RECORDS: PerformanceTestRecord[] = [
  {
    id: 'rota_test_1001',
    ownerId: 'local_user',
    testDate: getTodayIsoDate(),
    athleteName: 'Kerem Aktürkoğlu',
    sportsClub: 'ROTA Akademi SK',
    birthDate: '2011-04-12',
    heightCm: '168.5',
    weightKg: '57.4',
    gripRightKg: '34.2',
    gripLeftKg: '31.8',
    flamingoRight1: '4',
    flamingoRight2: '3',
    flamingoLeft1: '5',
    flamingoLeft2: '4',
    sprint20m: '3.18',
    sitAndReachCm: '24.5',
    armSpeedRightSec: '6.42',
    armSpeedLeftSec: '6.78',
    standingLongJumpCm: '208',
    shuttleRun10x5Sec: '18.35',
    verticalJumpCm: '42.5',
    reactionTestSec: '0.24',
    skinfoldTricepsMm: '8.2',
    skinfoldBicepsMm: '5.4',
    skinfoldIliacMm: '9.6',
    skinfoldCalfMm: '7.8',
    motherHeightCm: '165',
    motherWeightKg: '62',
    motherSportsHistory: 'Lise düzeyi voleybol',
    fatherHeightCm: '181',
    fatherWeightKg: '80',
    fatherSportsHistory: 'Amatör futbol',
    createdAt: '2026-11-16T09:00:00.000Z',
    updatedAt: '2026-11-16T09:00:00.000Z',
    syncedToCloud: false,
  },
  {
    id: 'rota_test_1002',
    ownerId: 'local_user',
    testDate: getTodayIsoDate(),
    athleteName: 'Zeynep Demir',
    sportsClub: 'Anadolu Yıldızları SK',
    birthDate: '2012-08-23',
    heightCm: '161.0',
    weightKg: '49.2',
    gripRightKg: '27.6',
    gripLeftKg: '26.1',
    flamingoRight1: '3',
    flamingoRight2: '2',
    flamingoLeft1: '3',
    flamingoLeft2: '3',
    sprint20m: '3.41',
    sitAndReachCm: '29.0',
    armSpeedRightSec: '6.85',
    armSpeedLeftSec: '7.10',
    standingLongJumpCm: '186',
    shuttleRun10x5Sec: '19.40',
    verticalJumpCm: '37.0',
    reactionTestSec: '0.26',
    skinfoldTricepsMm: '9.4',
    skinfoldBicepsMm: '6.1',
    skinfoldIliacMm: '10.2',
    skinfoldCalfMm: '8.5',
    motherHeightCm: '168',
    motherWeightKg: '59',
    motherSportsHistory: 'Atletizm (Kısa mesafe koşu)',
    fatherHeightCm: '178',
    fatherWeightKg: '76',
    fatherSportsHistory: 'Basketbol',
    createdAt: '2026-11-10T14:30:00.000Z',
    updatedAt: '2026-11-10T14:30:00.000Z',
    syncedToCloud: false,
  },
  {
    id: 'rota_test_1003',
    ownerId: 'local_user',
    testDate: getTodayIsoDate(),
    athleteName: 'Efe Can Yılmaz',
    sportsClub: 'ROTA Akademi SK',
    birthDate: '2011-11-05',
    heightCm: '171.0',
    weightKg: '60.5',
    gripRightKg: '36.0',
    gripLeftKg: '34.5',
    flamingoRight1: '2',
    flamingoRight2: '2',
    flamingoLeft1: '3',
    flamingoLeft2: '2',
    sprint20m: '3.12',
    sitAndReachCm: '22.0',
    armSpeedRightSec: '6.20',
    armSpeedLeftSec: '6.50',
    standingLongJumpCm: '215',
    shuttleRun10x5Sec: '17.95',
    verticalJumpCm: '45.0',
    reactionTestSec: '0.22',
    skinfoldTricepsMm: '7.5',
    skinfoldBicepsMm: '5.0',
    skinfoldIliacMm: '8.8',
    skinfoldCalfMm: '7.2',
    motherHeightCm: '166',
    motherWeightKg: '60',
    motherSportsHistory: 'Yüzme',
    fatherHeightCm: '183',
    fatherWeightKg: '82',
    fatherSportsHistory: 'Futbol',
    createdAt: '2026-11-16T10:15:00.000Z',
    updatedAt: '2026-11-16T10:15:00.000Z',
    syncedToCloud: false,
  },
];

function loadLocalRecords(): PerformanceTestRecord[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(
        LOCAL_STORAGE_KEY,
        JSON.stringify(INITIAL_DEMO_RECORDS)
      );
      return INITIAL_DEMO_RECORDS;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return INITIAL_DEMO_RECORDS;
    return parsed.map((item) => ({
      ...item,
      sportsClub: item.sportsClub || '',
    }));
  } catch {
    return INITIAL_DEMO_RECORDS;
  }
}

function saveLocalRecords(records: PerformanceTestRecord[]): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Ignore storage quota issues
  }
}

function loadLocalClubs(): SportsClubRecord[] {
  try {
    const raw = localStorage.getItem(LOCAL_CLUBS_KEY);
    if (!raw) {
      localStorage.setItem(
        LOCAL_CLUBS_KEY,
        JSON.stringify(INITIAL_DEMO_CLUBS)
      );
      return INITIAL_DEMO_CLUBS;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : INITIAL_DEMO_CLUBS;
  } catch {
    return INITIAL_DEMO_CLUBS;
  }
}

function saveLocalClubs(clubs: SportsClubRecord[]): void {
  try {
    localStorage.setItem(LOCAL_CLUBS_KEY, JSON.stringify(clubs));
  } catch {
    // Ignore
  }
}

function loadLocalAthletes(): ClubAthleteRecord[] {
  try {
    const raw = localStorage.getItem(LOCAL_ATHLETES_KEY);
    if (!raw) {
      localStorage.setItem(
        LOCAL_ATHLETES_KEY,
        JSON.stringify(INITIAL_DEMO_ATHLETES)
      );
      return INITIAL_DEMO_ATHLETES;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : INITIAL_DEMO_ATHLETES;
  } catch {
    return INITIAL_DEMO_ATHLETES;
  }
}

function saveLocalAthletes(athletes: ClubAthleteRecord[]): void {
  try {
    localStorage.setItem(LOCAL_ATHLETES_KEY, JSON.stringify(athletes));
  } catch {
    // Ignore
  }
}

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

class AppErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error.message || 'Beklenmeyen bir hata oluştu.',
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#F0F6FC] p-6">
          <div className="max-w-lg w-full bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <h2 className="text-lg font-bold text-[#0B192C] mb-2">
              İşlem Sırasında Bir Hata Oluştu
            </h2>
            <p className="text-sm text-slate-600 mb-4 break-words tabular-nums bg-slate-50 p-3 rounded border border-slate-200">
              {this.state.errorMessage}
            </p>
            <button
              type="button"
              onClick={() =>
                this.setState({ hasError: false, errorMessage: '' })
              }
              className="px-4 py-2.5 text-sm font-semibold text-white bg-[#0284C7] rounded-lg hover:bg-[#0369A1] transition-colors"
            >
              Tekrar Dene
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

type ActiveTab = 'form' | 'clubs' | 'records';
type FormMode = 'edit' | 'view';
type EntryLayoutMode = 'all' | 'step';

function RotaPerformansApp() {
  // Navigation & Sidebar State
  const [activeTab, setActiveTab] = useState<ActiveTab>('form');
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState<boolean>(false);
  const [sidebarSectionsOpen, setSidebarSectionsOpen] = useState<boolean>(true);
  const [sidebarClubsOpen, setSidebarClubsOpen] = useState<boolean>(true);

  // Form & Mobile Stepper State
  const [formMode, setFormMode] = useState<FormMode>('edit');
  const [entryLayoutMode, setEntryLayoutMode] = useState<EntryLayoutMode>('all');
  const [activeStepSection, setActiveStepSection] = useState<number>(1);
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [logoLoadError, setLogoLoadError] = useState<boolean>(false);

  // System-wide Automatic Test Date (defaults to today, editable anytime)
  const [systemTestDate, setSystemTestDate] = useState<string>(() =>
    getTodayIsoDate()
  );

  // Form Data State
  const [formValues, setFormValues] = useState<PerformanceTestFormValues>(
    () => createEmptyFormValues()
  );
  const [isManualClubInput, setIsManualClubInput] = useState<boolean>(false);
  const [isManualAthleteInput, setIsManualAthleteInput] =
    useState<boolean>(false);

  // Real-time Multi-User Category Locking State
  const initialIdentity = useMemo(() => getOrCreateSessionIdentity(), []);
  const [collabSessionId] = useState<string>(initialIdentity.sessionId);
  const [collabUserName, setCollabUserName] = useState<string>(
    initialIdentity.defaultName
  );
  const [categoryLocks, setCategoryLocks] = useState<CollabCategoryLock[]>([]);
  const [activeCollabUsers, setActiveCollabUsers] = useState<CollabActiveUser[]>(
    []
  );
  const wsRef = useRef<WebSocket | null>(null);
  const bcRef = useRef<BroadcastChannel | null>(null);

  // Auth & Database State
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState<boolean>(false);

  const [localRecords, setLocalRecords] =
    useState<PerformanceTestRecord[]>(loadLocalRecords);
  const [cloudRecords, setCloudRecords] = useState<PerformanceTestRecord[]>([]);

  const [localClubs, setLocalClubs] =
    useState<SportsClubRecord[]>(loadLocalClubs);
  const [cloudClubs, setCloudClubs] = useState<SportsClubRecord[]>([]);

  const [localAthletes, setLocalAthletes] =
    useState<ClubAthleteRecord[]>(loadLocalAthletes);
  const [cloudAthletes, setCloudAthletes] = useState<ClubAthleteRecord[]>([]);

  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [statusBanner, setStatusBanner] = useState<{
    type: 'success' | 'info' | 'error';
    text: string;
  } | null>(null);

  // New Club & New Athlete Form State in Spor Kulüpleri View
  const [newClubName, setNewClubName] = useState<string>('');
  const [newClubBranch, setNewClubBranch] = useState<string>('');
  const [showAddClubForm, setShowAddClubForm] = useState<boolean>(false);

  const [newAthleteName, setNewAthleteName] = useState<string>('');
  const [newAthleteBirthDate, setNewAthleteBirthDate] = useState<string>('');
  const [newAthleteClubName, setNewAthleteClubName] = useState<string>('');

  // Filter & Search State
  const [searchName, setSearchName] = useState<string>('');
  const [searchDate, setSearchDate] = useState<string>('');
  const [searchClub, setSearchClub] = useState<string>('');
  const [selectedClubView, setSelectedClubView] = useState<string>('ROTA Akademi SK');
  const [clubSearchQuery, setClubSearchQuery] = useState<string>('');
  const [sortDirection, setSortDirection] = useState<'desc' | 'asc'>('desc');

  // Confirmation Modal State
  const [recordToDelete, setRecordToDelete] =
    useState<PerformanceTestRecord | null>(null);
  const [athleteToDelete, setAthleteToDelete] =
    useState<ClubAthleteRecord | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState<boolean>(false);

  // Webhook Integration State
  const initialWebhook = useMemo(() => loadWebhookConfig(), []);
  const [webhookTargetUrl, setWebhookTargetUrl] = useState<string>(
    initialWebhook.targetUrl
  );
  const [webhookAutoSend, setWebhookAutoSend] = useState<boolean>(
    initialWebhook.autoSendOnSave
  );
  const [webhookModalOpen, setWebhookModalOpen] = useState<boolean>(false);
  const [isSendingWebhook, setIsSendingWebhook] = useState<boolean>(false);
  const [copiedSchema, setCopiedSchema] = useState<boolean>(false);
  const [lastWebhookResult, setLastWebhookResult] = useState<{
    ok: boolean;
    statusCode: number;
    sentAt: string;
    count: number;
    message: string;
  } | null>(null);

  // Dynamic OpenGraph URL & Canonical Link Resolution
  useEffect(() => {
    const canonicalUrl = window.location.origin + window.location.pathname;
    const absoluteLogoUrl = window.location.origin + ROTA_LOGO_PATH;

    let canonicalLink = document.querySelector<HTMLLinkElement>(
      'link[rel="canonical"]'
    );
    if (!canonicalLink) {
      canonicalLink = document.createElement('link');
      canonicalLink.setAttribute('rel', 'canonical');
      document.head.appendChild(canonicalLink);
    }
    canonicalLink.setAttribute('href', canonicalUrl);

    let ogUrlMeta = document.querySelector<HTMLMetaElement>(
      'meta[property="og:url"]'
    );
    if (!ogUrlMeta) {
      ogUrlMeta = document.createElement('meta');
      ogUrlMeta.setAttribute('property', 'og:url');
      document.head.appendChild(ogUrlMeta);
    }
    ogUrlMeta.setAttribute('content', canonicalUrl);

    const ogImageMeta = document.querySelector<HTMLMetaElement>(
      'meta[property="og:image"]'
    );
    if (ogImageMeta) {
      ogImageMeta.setAttribute('content', absoluteLogoUrl);
    }
    const twitterImageMeta = document.querySelector<HTMLMetaElement>(
      'meta[name="twitter:image"]'
    );
    if (twitterImageMeta) {
      twitterImageMeta.setAttribute('content', absoluteLogoUrl);
    }
  }, []);

  // Fullscreen toggle
  const toggleFullscreen = useCallback(async () => {
    const nextState = !isFullscreen;
    setIsFullscreen(nextState);

    try {
      if (nextState) {
        if (
          !document.fullscreenElement &&
          document.documentElement.requestFullscreen
        ) {
          await document.documentElement.requestFullscreen();
        }
      } else {
        if (document.fullscreenElement && document.exitFullscreen) {
          await document.exitFullscreen();
        }
      }
    } catch {
      // Fallback to in-window fullscreen expansion
    }
  }, [isFullscreen]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && isFullscreen) {
        setIsFullscreen(false);
      } else if (document.fullscreenElement && !isFullscreen) {
        setIsFullscreen(true);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (mobileDrawerOpen) {
          setMobileDrawerOpen(false);
        } else if (isFullscreen && !document.fullscreenElement) {
          setIsFullscreen(false);
        }
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFullscreen, mobileDrawerOpen]);

  // Auto-hide status notification banner
  useEffect(() => {
    if (!statusBanner) return;
    const timer = setTimeout(() => setStatusBanner(null), 4500);
    return () => clearTimeout(timer);
  }, [statusBanner]);

  // Listen to Firebase Auth State
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
      if (currentUser?.displayName) {
        setCollabUserName(currentUser.displayName);
      }
    });
    return () => unsubscribe();
  }, []);

  // Real-time Multi-User WebSocket & BroadcastChannel Connection for Category Locking & Live Field Sync
  useEffect(() => {
    let isMounted = true;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    // 1. Setup BroadcastChannel for instant same-browser multi-tab sync
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        const bc = new BroadcastChannel('rota_performans_collab_v1');
        bcRef.current = bc;
        bc.onmessage = (ev) => {
          const data = ev.data;
          if (!data || typeof data !== 'object') return;
          if (data.type === 'bc:lock') {
            setCategoryLocks((prev) => {
              const filtered = prev.filter(
                (l) =>
                  l.sessionId !== data.sessionId &&
                  l.sectionId !== data.sectionId
              );
              return [
                ...filtered,
                {
                  sectionId: data.sectionId,
                  sessionId: data.sessionId,
                  userName: data.userName,
                  lockedAt: Date.now(),
                },
              ];
            });
          } else if (data.type === 'bc:unlock') {
            setCategoryLocks((prev) =>
              prev.filter(
                (l) =>
                  !(
                    l.sessionId === data.sessionId &&
                    (!data.sectionId || l.sectionId === data.sectionId)
                  )
              )
            );
          } else if (
            data.type === 'bc:field' &&
            data.sessionId !== collabSessionId
          ) {
            const fieldKey = data.field as keyof PerformanceTestFormValues;
            const fieldVal = String(data.value ?? '');
            setFormValues((prev) => ({
              ...prev,
              [fieldKey]: fieldVal,
            }));
          }
        };
      }
    } catch {
      // Ignore if BroadcastChannel is not supported
    }

    // 2. Setup WebSocket connection to /ws-collab on the server
    const connectWs = () => {
      if (!isMounted) return;
      try {
        const protocol =
          window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws-collab`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          ws.send(
            JSON.stringify({
              type: 'user:join',
              sessionId: collabSessionId,
              userName: collabUserName,
            })
          );
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(String(event.data));
            if (!msg || typeof msg !== 'object') return;

            if (msg.type === 'collab:state') {
              if (Array.isArray(msg.locks)) {
                setCategoryLocks(msg.locks);
              }
              if (Array.isArray(msg.users)) {
                setActiveCollabUsers(msg.users);
              }
            } else if (
              msg.type === 'field:delta' &&
              msg.sessionId !== collabSessionId
            ) {
              const fieldKey = msg.field as keyof PerformanceTestFormValues;
              const fieldVal = String(msg.value ?? '');
              setFormValues((prev) => ({
                ...prev,
                [fieldKey]: fieldVal,
              }));
            } else if (msg.type === 'category:lock_rejected') {
              setStatusBanner({
                type: 'error',
                text: `Bu veri kategorisinde şu anda "${msg.lockedBy}" veri girişi yapıyor. Lütfen farklı bir kategori seçiniz.`,
              });
            } else if (
              msg.type === 'form:reset_broadcast' &&
              msg.sessionId !== collabSessionId &&
              msg.formValues
            ) {
              setFormValues((prev) => ({
                ...prev,
                ...msg.formValues,
              }));
            }
          } catch {
            // Ignore malformed socket message
          }
        };

        ws.onclose = () => {
          if (isMounted) {
            reconnectTimer = setTimeout(connectWs, 3000);
          }
        };
      } catch {
        // Fallback if WebSocket unavailable
      }
    };

    connectWs();

    return () => {
      isMounted = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // Ignore
        }
      }
      if (bcRef.current) {
        try {
          bcRef.current.close();
        } catch {
          // Ignore
        }
      }
    };
  }, [collabSessionId]);

  // Keep userName synced with server when changed
  useEffect(() => {
    try {
      sessionStorage.setItem('rota_collab_user_name', collabUserName);
    } catch {
      // Ignore
    }
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'user:heartbeat',
          sessionId: collabSessionId,
          userName: collabUserName,
        })
      );
    }
  }, [collabSessionId, collabUserName]);

  // Category Lock Helpers
  const getSectionLocker = useCallback(
    (sectionId: number): CollabCategoryLock | null => {
      return categoryLocks.find((l) => l.sectionId === sectionId) || null;
    },
    [categoryLocks]
  );

  const isSectionLockedByOther = useCallback(
    (sectionId: number): boolean => {
      const lock = categoryLocks.find((l) => l.sectionId === sectionId);
      return Boolean(lock && lock.sessionId !== collabSessionId);
    },
    [categoryLocks, collabSessionId]
  );

  const isSectionLockedByMe = useCallback(
    (sectionId: number): boolean => {
      const lock = categoryLocks.find((l) => l.sectionId === sectionId);
      return Boolean(lock && lock.sessionId === collabSessionId);
    },
    [categoryLocks, collabSessionId]
  );

  const requestCategoryLock = useCallback(
    (sectionId: number) => {
      if (formMode === 'view') return false;
      const existingLock = categoryLocks.find((l) => l.sectionId === sectionId);
      if (existingLock && existingLock.sessionId !== collabSessionId) {
        setStatusBanner({
          type: 'error',
          text: `${FORM_SECTIONS.find((s) => s.id === sectionId)?.fullTitle || 'Bu kategori'} şu anda "${existingLock.userName}" tarafından dolduruluyor. Aynı anda sadece farklı veri kategorilerine giriş yapılabilir.`,
        });
        return false;
      }

      // Optimistic local lock update
      setCategoryLocks((prev) => {
        const withoutMine = prev.filter(
          (l) => l.sessionId !== collabSessionId && l.sectionId !== sectionId
        );
        return [
          ...withoutMine,
          {
            sectionId,
            sessionId: collabSessionId,
            userName: collabUserName,
            lockedAt: Date.now(),
          },
        ];
      });

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'category:lock',
            sectionId,
            sessionId: collabSessionId,
            userName: collabUserName,
            athleteName: formValues.athleteName,
            sportsClub: formValues.sportsClub,
          })
        );
      }

      if (bcRef.current) {
        bcRef.current.postMessage({
          type: 'bc:lock',
          sectionId,
          sessionId: collabSessionId,
          userName: collabUserName,
        });
      }
      return true;
    },
    [
      categoryLocks,
      collabSessionId,
      collabUserName,
      formMode,
      formValues.athleteName,
      formValues.sportsClub,
    ]
  );

  const releaseCategoryLock = useCallback(
    (sectionId?: number) => {
      setCategoryLocks((prev) =>
        prev.filter(
          (l) =>
            !(
              l.sessionId === collabSessionId &&
              (sectionId === undefined || l.sectionId === sectionId)
            )
        )
      );

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'category:unlock',
            sectionId,
            sessionId: collabSessionId,
            userName: collabUserName,
          })
        );
      }

      if (bcRef.current) {
        bcRef.current.postMessage({
          type: 'bc:unlock',
          sectionId,
          sessionId: collabSessionId,
        });
      }
    },
    [collabSessionId, collabUserName]
  );

  const broadcastFieldUpdate = useCallback(
    (field: keyof PerformanceTestFormValues, value: string) => {
      const sectionId = FIELD_TO_SECTION_MAP[field] || 1;
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'field:update',
            sectionId,
            field,
            value,
            sessionId: collabSessionId,
            userName: collabUserName,
          })
        );
      }
      if (bcRef.current) {
        bcRef.current.postMessage({
          type: 'bc:field',
          sectionId,
          field,
          value,
          sessionId: collabSessionId,
          userName: collabUserName,
        });
      }
    },
    [collabSessionId, collabUserName]
  );

  // Sync unsynced local records to Firestore once authenticated, and subscribe to Firestore collections
  useEffect(() => {
    if (!authReady || !user) {
      setCloudRecords([]);
      setCloudClubs([]);
      setCloudAthletes([]);
      return;
    }

    const syncLocalToCloud = async () => {
      // 1. Sync PerformanceTests
      const currentLocal = loadLocalRecords();
      const unsyncedTests = currentLocal.filter((r) => !r.syncedToCloud);
      if (unsyncedTests.length > 0) {
        for (const rec of unsyncedTests) {
          const sanitized = sanitizeFormPayload(rec);
          const docRef = doc(db, 'performanceTests', rec.id);
          try {
            await setDoc(docRef, {
              ...sanitized,
              ownerId: user.uid,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          } catch (err) {
            console.warn('Could not auto-sync local record:', err);
          }
        }
        const markedSynced = currentLocal.map((r) => ({
          ...r,
          ownerId: user.uid,
          syncedToCloud: true,
        }));
        saveLocalRecords(markedSynced);
        setLocalRecords(markedSynced);
      }

      // 2. Sync SportsClubs
      const currentClubs = loadLocalClubs();
      const unsyncedClubs = currentClubs.filter((c) => !c.syncedToCloud);
      if (unsyncedClubs.length > 0) {
        for (const club of unsyncedClubs) {
          try {
            await setDoc(doc(db, 'sportsClubs', club.id), {
              ownerId: user.uid,
              name: club.name.slice(0, BLUEPRINT_CONSTRAINTS.SPORTS_CLUB_MAX_LENGTH),
              branch: (club.branch || '').slice(
                0,
                BLUEPRINT_CONSTRAINTS.CLUB_BRANCH_MAX_LENGTH
              ),
              createdAt: serverTimestamp(),
            });
          } catch (err) {
            console.warn('Could not auto-sync local club:', err);
          }
        }
        const markedClubs = currentClubs.map((c) => ({
          ...c,
          ownerId: user.uid,
          syncedToCloud: true,
        }));
        saveLocalClubs(markedClubs);
        setLocalClubs(markedClubs);
      }

      // 3. Sync ClubAthletes
      const currentAthletes = loadLocalAthletes();
      const unsyncedAthletes = currentAthletes.filter((a) => !a.syncedToCloud);
      if (unsyncedAthletes.length > 0) {
        for (const ath of unsyncedAthletes) {
          try {
            await setDoc(doc(db, 'clubAthletes', ath.id), {
              ownerId: user.uid,
              clubId: ath.clubId,
              sportsClub: ath.sportsClub.slice(
                0,
                BLUEPRINT_CONSTRAINTS.SPORTS_CLUB_MAX_LENGTH
              ),
              athleteName: ath.athleteName.slice(
                0,
                BLUEPRINT_CONSTRAINTS.ATHLETE_NAME_MAX_LENGTH
              ),
              birthDate: (ath.birthDate || '').slice(
                0,
                BLUEPRINT_CONSTRAINTS.DATE_MAX_LENGTH
              ),
              createdAt: serverTimestamp(),
            });
          } catch (err) {
            console.warn('Could not auto-sync local athlete:', err);
          }
        }
        const markedAthletes = currentAthletes.map((a) => ({
          ...a,
          ownerId: user.uid,
          syncedToCloud: true,
        }));
        saveLocalAthletes(markedAthletes);
        setLocalAthletes(markedAthletes);
      }
    };

    syncLocalToCloud();

    // Subscribe to performanceTests
    const qTests = query(
      collection(db, 'performanceTests'),
      where('ownerId', '==', user.uid)
    );
    const unsubTests = onSnapshot(
      qTests,
      (snapshot) => {
        const loaded: PerformanceTestRecord[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          const createdIso =
            data.createdAt instanceof Timestamp
              ? data.createdAt.toDate().toISOString()
              : String(data.createdAt || new Date().toISOString());
          const updatedIso =
            data.updatedAt instanceof Timestamp
              ? data.updatedAt.toDate().toISOString()
              : String(data.updatedAt || new Date().toISOString());

          return {
            id: docSnap.id,
            ownerId: String(data.ownerId || user.uid),
            testDate: String(data.testDate || ''),
            athleteName: String(data.athleteName || ''),
            sportsClub: String(data.sportsClub || ''),
            birthDate: String(data.birthDate || ''),
            heightCm: String(data.heightCm || ''),
            weightKg: String(data.weightKg || ''),
            gripRightKg: String(data.gripRightKg || ''),
            gripLeftKg: String(data.gripLeftKg || ''),
            flamingoRight1: String(data.flamingoRight1 || ''),
            flamingoRight2: String(data.flamingoRight2 || ''),
            flamingoLeft1: String(data.flamingoLeft1 || ''),
            flamingoLeft2: String(data.flamingoLeft2 || ''),
            sprint20m: String(data.sprint20m || ''),
            sitAndReachCm: String(data.sitAndReachCm || ''),
            armSpeedRightSec: String(data.armSpeedRightSec || ''),
            armSpeedLeftSec: String(data.armSpeedLeftSec || ''),
            standingLongJumpCm: String(data.standingLongJumpCm || ''),
            shuttleRun10x5Sec: String(data.shuttleRun10x5Sec || ''),
            verticalJumpCm: String(data.verticalJumpCm || ''),
            reactionTestSec: String(data.reactionTestSec || ''),
            skinfoldTricepsMm: String(data.skinfoldTricepsMm || ''),
            skinfoldBicepsMm: String(data.skinfoldBicepsMm || ''),
            skinfoldIliacMm: String(data.skinfoldIliacMm || ''),
            skinfoldCalfMm: String(data.skinfoldCalfMm || ''),
            motherHeightCm: String(data.motherHeightCm || ''),
            motherWeightKg: String(data.motherWeightKg || ''),
            motherSportsHistory: String(data.motherSportsHistory || ''),
            fatherHeightCm: String(data.fatherHeightCm || ''),
            fatherWeightKg: String(data.fatherWeightKg || ''),
            fatherSportsHistory: String(data.fatherSportsHistory || ''),
            createdAt: createdIso,
            updatedAt: updatedIso,
            syncedToCloud: true,
          };
        });
        setCloudRecords(loaded);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'performanceTests');
      }
    );

    // Subscribe to sportsClubs
    const qClubs = query(
      collection(db, 'sportsClubs'),
      where('ownerId', '==', user.uid)
    );
    const unsubClubs = onSnapshot(
      qClubs,
      (snapshot) => {
        const loadedClubs: SportsClubRecord[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          const createdIso =
            data.createdAt instanceof Timestamp
              ? data.createdAt.toDate().toISOString()
              : String(data.createdAt || new Date().toISOString());
          return {
            id: docSnap.id,
            ownerId: String(data.ownerId || user.uid),
            name: String(data.name || ''),
            branch: String(data.branch || ''),
            createdAt: createdIso,
            syncedToCloud: true,
          };
        });
        setCloudClubs(loadedClubs);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'sportsClubs');
      }
    );

    // Subscribe to clubAthletes
    const qAthletes = query(
      collection(db, 'clubAthletes'),
      where('ownerId', '==', user.uid)
    );
    const unsubAthletes = onSnapshot(
      qAthletes,
      (snapshot) => {
        const loadedAthletes: ClubAthleteRecord[] = snapshot.docs.map(
          (docSnap) => {
            const data = docSnap.data();
            const createdIso =
              data.createdAt instanceof Timestamp
                ? data.createdAt.toDate().toISOString()
                : String(data.createdAt || new Date().toISOString());
            return {
              id: docSnap.id,
              ownerId: String(data.ownerId || user.uid),
              clubId: String(data.clubId || ''),
              sportsClub: String(data.sportsClub || ''),
              athleteName: String(data.athleteName || ''),
              birthDate: String(data.birthDate || ''),
              createdAt: createdIso,
              syncedToCloud: true,
            };
          }
        );
        setCloudAthletes(loadedAthletes);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'clubAthletes');
      }
    );

    return () => {
      unsubTests();
      unsubClubs();
      unsubAthletes();
    };
  }, [authReady, user]);

  // Unified records list
  const allRecords = useMemo(() => {
    const map = new Map<string, PerformanceTestRecord>();
    for (const r of localRecords) {
      map.set(r.id, r);
    }
    for (const r of cloudRecords) {
      map.set(r.id, r);
    }
    const merged = Array.from(map.values());
    merged.sort((a, b) => {
      const cmp = (a.testDate || '').localeCompare(b.testDate || '');
      if (cmp !== 0) {
        return sortDirection === 'desc' ? -cmp : cmp;
      }
      return (b.updatedAt || '').localeCompare(a.updatedAt || '');
    });
    return merged;
  }, [localRecords, cloudRecords, sortDirection]);

  // Unified clubs list
  const allClubs = useMemo(() => {
    const map = new Map<string, SportsClubRecord>();
    for (const c of localClubs) {
      map.set(c.name.trim().toLocaleLowerCase('tr-TR'), c);
    }
    for (const c of cloudClubs) {
      map.set(c.name.trim().toLocaleLowerCase('tr-TR'), c);
    }
    return Array.from(map.values());
  }, [localClubs, cloudClubs]);

  // Unified athletes list
  const allAthletes = useMemo(() => {
    const map = new Map<string, ClubAthleteRecord>();
    for (const a of localAthletes) {
      map.set(a.id, a);
    }
    for (const a of cloudAthletes) {
      map.set(a.id, a);
    }
    return Array.from(map.values()).sort((a, b) =>
      a.athleteName.localeCompare(b.athleteName, 'tr-TR')
    );
  }, [localAthletes, cloudAthletes]);

  // Comprehensive Clubs Summary (merges registered SportsClubs, ClubAthletes, and PerformanceTests)
  const clubsSummary = useMemo(() => {
    const clubMap = new Map<
      string,
      {
        clubId: string;
        clubName: string;
        branch: string;
        records: PerformanceTestRecord[];
        rosterAthletes: ClubAthleteRecord[];
        uniqueAthleteKeys: Set<string>;
        latestDate: string;
      }
    >();

    // 1. Seed with explicitly registered SportsClubs
    for (const club of allClubs) {
      const name = club.name.trim();
      if (!name) continue;
      clubMap.set(name, {
        clubId: club.id,
        clubName: name,
        branch: club.branch || '',
        records: [],
        rosterAthletes: [],
        uniqueAthleteKeys: new Set<string>(),
        latestDate: '',
      });
    }

    // 2. Add registered ClubAthletes
    for (const ath of allAthletes) {
      const clubKey = ath.sportsClub?.trim() || UNASSIGNED_CLUB_LABEL;
      let entry = clubMap.get(clubKey);
      if (!entry) {
        entry = {
          clubId: ath.clubId || `club_${Date.now()}`,
          clubName: clubKey,
          branch: '',
          records: [],
          rosterAthletes: [],
          uniqueAthleteKeys: new Set<string>(),
          latestDate: '',
        };
        clubMap.set(clubKey, entry);
      }
      entry.rosterAthletes.push(ath);
      entry.uniqueAthleteKeys.add(
        ath.athleteName.trim().toLocaleLowerCase('tr-TR')
      );
    }

    // 3. Add PerformanceTests
    for (const rec of allRecords) {
      const clubKey = rec.sportsClub?.trim() || UNASSIGNED_CLUB_LABEL;
      let entry = clubMap.get(clubKey);
      if (!entry) {
        entry = {
          clubId: `club_auto_${clubKey.replace(/[^a-zA-Z0-9]/g, '_')}`,
          clubName: clubKey,
          branch: '',
          records: [],
          rosterAthletes: [],
          uniqueAthleteKeys: new Set<string>(),
          latestDate: rec.testDate || '',
        };
        clubMap.set(clubKey, entry);
      }
      entry.records.push(rec);
      entry.uniqueAthleteKeys.add(
        rec.athleteName.trim().toLocaleLowerCase('tr-TR')
      );
      if ((rec.testDate || '') > entry.latestDate) {
        entry.latestDate = rec.testDate;
      }
    }

    return Array.from(clubMap.values()).sort((a, b) => {
      if (a.clubName === UNASSIGNED_CLUB_LABEL) return 1;
      if (b.clubName === UNASSIGNED_CLUB_LABEL) return -1;
      return b.uniqueAthleteKeys.size - a.uniqueAthleteKeys.size;
    });
  }, [allClubs, allAthletes, allRecords]);

  // Known named clubs
  const knownClubNames = useMemo(() => {
    return clubsSummary
      .map((c) => c.clubName)
      .filter((name) => name !== UNASSIGNED_CLUB_LABEL);
  }, [clubsSummary]);

  // Athletes registered under the currently selected club in the Form (for 1-tap athlete autofill!)
  const athletesInCurrentFormClub = useMemo(() => {
    const activeClub = formValues.sportsClub.trim();
    if (!activeClub) return [];
    const found = clubsSummary.find((c) => c.clubName === activeClub);
    return found ? found.rosterAthletes : [];
  }, [formValues.sportsClub, clubsSummary]);

  // Currently selected club details in Spor Kulüpleri screen
  const activeClubSummary = useMemo(() => {
    if (selectedClubView === 'ALL') return null;
    return clubsSummary.find((c) => c.clubName === selectedClubView) || null;
  }, [selectedClubView, clubsSummary]);

  // Filtered records for Kayıt Ekranı
  const filteredRecords = useMemo(() => {
    const nameQuery = searchName.trim().toLocaleLowerCase('tr-TR');
    return allRecords.filter((rec) => {
      const matchesName =
        !nameQuery ||
        rec.athleteName.toLocaleLowerCase('tr-TR').includes(nameQuery);
      const matchesDate = !searchDate || rec.testDate === searchDate;
      const recClubLabel = rec.sportsClub?.trim() || UNASSIGNED_CLUB_LABEL;
      const matchesClub = !searchClub || recClubLabel === searchClub;
      return matchesName && matchesDate && matchesClub;
    });
  }, [allRecords, searchName, searchDate, searchClub]);

  // Filtered records for Spor Kulübüne Göre Ekranı
  const clubViewRecords = useMemo(() => {
    const queryText = clubSearchQuery.trim().toLocaleLowerCase('tr-TR');
    return allRecords.filter((rec) => {
      const recClubLabel = rec.sportsClub?.trim() || UNASSIGNED_CLUB_LABEL;
      const matchesSelectedClub =
        selectedClubView === 'ALL' || recClubLabel === selectedClubView;
      const matchesSearch =
        !queryText ||
        rec.athleteName.toLocaleLowerCase('tr-TR').includes(queryText) ||
        recClubLabel.toLocaleLowerCase('tr-TR').includes(queryText);
      return matchesSelectedClub && matchesSearch;
    });
  }, [allRecords, selectedClubView, clubSearchQuery]);

  // STEP 1 HANDLER: Add a new Sports Club ("1. Spor Kulübü Ekle")
  const handleAddSportsClub = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = newClubName
      .trim()
      .slice(0, BLUEPRINT_CONSTRAINTS.SPORTS_CLUB_MAX_LENGTH);
    const trimmedBranch = newClubBranch
      .trim()
      .slice(0, BLUEPRINT_CONSTRAINTS.CLUB_BRANCH_MAX_LENGTH);

    if (!trimmedName) {
      setStatusBanner({
        type: 'error',
        text: 'Lütfen eklenecek spor kulübünün adını girin.',
      });
      return;
    }

    const exists = clubsSummary.some(
      (c) =>
        c.clubName.toLocaleLowerCase('tr-TR') ===
        trimmedName.toLocaleLowerCase('tr-TR')
    );
    if (exists) {
      setSelectedClubView(trimmedName);
      setNewClubName('');
      setNewClubBranch('');
      setShowAddClubForm(false);
      setStatusBanner({
        type: 'info',
        text: `"${trimmedName}" kulübü zaten mevcut, kulüp seçildi.`,
      });
      return;
    }

    const clubId = `club_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const nowIso = new Date().toISOString();

    if (user) {
      try {
        await setDoc(doc(db, 'sportsClubs', clubId), {
          ownerId: user.uid,
          name: trimmedName,
          branch: trimmedBranch,
          createdAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(
          error,
          OperationType.CREATE,
          `sportsClubs/${clubId}`
        );
      }
    }

    const newClubRec: SportsClubRecord = {
      id: clubId,
      ownerId: user?.uid || 'local_user',
      name: trimmedName,
      branch: trimmedBranch,
      createdAt: nowIso,
      syncedToCloud: Boolean(user),
    };

    const nextClubs = [newClubRec, ...localClubs];
    saveLocalClubs(nextClubs);
    setLocalClubs(nextClubs);

    setSelectedClubView(trimmedName);
    setNewAthleteClubName(trimmedName);
    setNewClubName('');
    setNewClubBranch('');
    setShowAddClubForm(false);

    setStatusBanner({
      type: 'success',
      text: `"${trimmedName}" spor kulübü eklendi. Şimdi bu kulübe sporcu ekleyebilirsiniz.`,
    });
  };

  // STEP 2 HANDLER: Add a new Athlete to a Sports Club ("2. Kulübe Sporcu Ekle")
  const handleAddAthleteToClub = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetClubName = (
      selectedClubView !== 'ALL' && selectedClubView !== UNASSIGNED_CLUB_LABEL
        ? selectedClubView
        : newAthleteClubName || knownClubNames[0] || ''
    )
      .trim()
      .slice(0, BLUEPRINT_CONSTRAINTS.SPORTS_CLUB_MAX_LENGTH);

    const trimmedAthleteName = newAthleteName
      .trim()
      .slice(0, BLUEPRINT_CONSTRAINTS.ATHLETE_NAME_MAX_LENGTH);
    const trimmedBirthDate = (newAthleteBirthDate || '')
      .trim()
      .slice(0, BLUEPRINT_CONSTRAINTS.DATE_MAX_LENGTH);

    if (!targetClubName) {
      setStatusBanner({
        type: 'error',
        text: 'Lütfen önce bir spor kulübü seçin veya yeni spor kulübü ekleyin.',
      });
      return;
    }

    if (!trimmedAthleteName) {
      setStatusBanner({
        type: 'error',
        text: 'Lütfen kulübe eklenecek sporcunun Adı Soyadı bilgisini girin.',
      });
      return;
    }

    const targetClubObj = clubsSummary.find(
      (c) => c.clubName === targetClubName
    );
    const clubId =
      targetClubObj?.clubId && BLUEPRINT_CONSTRAINTS.ID_PATTERN.test(targetClubObj.clubId)
        ? targetClubObj.clubId
        : `club_${Date.now()}`;

    const athleteId = `ath_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const nowIso = new Date().toISOString();

    if (user) {
      try {
        await setDoc(doc(db, 'clubAthletes', athleteId), {
          ownerId: user.uid,
          clubId,
          sportsClub: targetClubName,
          athleteName: trimmedAthleteName,
          birthDate: trimmedBirthDate,
          createdAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(
          error,
          OperationType.CREATE,
          `clubAthletes/${athleteId}`
        );
      }
    }

    const newAthleteRec: ClubAthleteRecord = {
      id: athleteId,
      ownerId: user?.uid || 'local_user',
      clubId,
      sportsClub: targetClubName,
      athleteName: trimmedAthleteName,
      birthDate: trimmedBirthDate,
      createdAt: nowIso,
      syncedToCloud: Boolean(user),
    };

    const nextAthletes = [...localAthletes, newAthleteRec];
    saveLocalAthletes(nextAthletes);
    setLocalAthletes(nextAthletes);

    setNewAthleteName('');
    setNewAthleteBirthDate('');
    setSelectedClubView(targetClubName);

    setStatusBanner({
      type: 'success',
      text: `"${trimmedAthleteName}" sporcusu "${targetClubName}" kulüp kadrosuna eklendi.`,
    });
  };

  // Delete an athlete from club roster
  const handleConfirmDeleteAthlete = async () => {
    if (!athleteToDelete) return;
    const target = athleteToDelete;
    setAthleteToDelete(null);

    if (user) {
      try {
        await deleteDoc(doc(db, 'clubAthletes', target.id));
      } catch (error) {
        handleFirestoreError(
          error,
          OperationType.DELETE,
          `clubAthletes/${target.id}`
        );
      }
    }

    const nextAthletes = localAthletes.filter((a) => a.id !== target.id);
    saveLocalAthletes(nextAthletes);
    setLocalAthletes(nextAthletes);

    setStatusBanner({
      type: 'info',
      text: `"${target.athleteName}" kulüp sporcu listesinden kaldırıldı.`,
    });
  };

  // STEP 3 HANDLER: Open Test Form for a specific Club Athlete ("Ölçüm Gir / Test Başlat")
  const handleStartTestForAthlete = (
    clubName: string,
    athleteName: string,
    birthDate: string
  ) => {
    const autoDate = systemTestDate || getTodayIsoDate();
    setFormValues({
      ...createEmptyFormValues(clubName, athleteName, birthDate),
      testDate: autoDate,
    });
    setEditingRecordId(null);
    setFormMode('edit');
    setActiveStepSection(entryLayoutMode === 'step' ? 2 : 1);
    setActiveTab('form');
    setMobileDrawerOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setStatusBanner({
      type: 'info',
      text: `${clubName} · ${athleteName} için yeni performans test formu hazırlandı.`,
    });
  };

  // Handlers for Form Inputs (with Category Lock Verification & Real-Time Broadcast)
  const handleTextChange = (
    field: keyof PerformanceTestFormValues,
    value: string,
    maxLength: number
  ) => {
    const secId = FIELD_TO_SECTION_MAP[field] || 1;
    if (isSectionLockedByOther(secId)) {
      setStatusBanner({
        type: 'error',
        text: 'Bu veri kategorisinde şu anda başka bir kullanıcı veri girişi yapıyor. Lütfen farklı bir kategori seçiniz.',
      });
      return;
    }
    requestCategoryLock(secId);
    const sliced = value.slice(0, maxLength);
    if (field === 'testDate' && sliced) {
      setSystemTestDate(sliced);
    }
    setFormValues((prev) => ({
      ...prev,
      [field]: sliced,
    }));
    broadcastFieldUpdate(field, sliced);
  };

  const handleDecimalChange = (
    field: keyof PerformanceTestFormValues,
    value: string
  ) => {
    const secId = FIELD_TO_SECTION_MAP[field] || 2;
    if (isSectionLockedByOther(secId)) {
      setStatusBanner({
        type: 'error',
        text: 'Bu veri kategorisinde şu anda başka bir kullanıcı veri girişi yapıyor. Lütfen farklı bir kategori seçiniz.',
      });
      return;
    }
    requestCategoryLock(secId);
    const cleanVal = sanitizeDecimalInput(value);
    setFormValues((prev) => ({
      ...prev,
      [field]: cleanVal,
    }));
    broadcastFieldUpdate(field, cleanVal);
  };

  // Start a fresh new test form (optionally pre-filling a sports club)
  const handleStartNewForm = (prefillClub = '') => {
    const clubToUse =
      prefillClub && prefillClub !== UNASSIGNED_CLUB_LABEL ? prefillClub : '';
    const autoDate = systemTestDate || getTodayIsoDate();
    const emptyVals = {
      ...createEmptyFormValues(clubToUse),
      testDate: autoDate,
    };
    setFormValues(emptyVals);
    setIsManualClubInput(false);
    setIsManualAthleteInput(false);
    setEditingRecordId(null);
    setFormMode('edit');
    setActiveStepSection(1);
    setActiveTab('form');
    setMobileDrawerOpen(false);
    setCategoryLocks([]);
    releaseCategoryLock();
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'form:reset',
          sessionId: collabSessionId,
          userName: collabUserName,
          formValues: emptyVals,
        })
      );
    }
    setStatusBanner({
      type: 'info',
      text: 'Yeni boş performans test formu hazırlandı.',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => {
      const firstField = document.getElementById('field-sportsClub');
      if (firstField) {
        firstField.focus();
      }
    }, 80);
  };

  // Clear current form values
  const handleConfirmClearForm = () => {
    const autoDate = systemTestDate || getTodayIsoDate();
    const emptyVals = {
      ...createEmptyFormValues(formValues.sportsClub),
      testDate: autoDate,
    };
    setFormValues(emptyVals);
    setEditingRecordId(null);
    setFormMode('edit');
    setActiveStepSection(1);
    setConfirmClearOpen(false);
    releaseCategoryLock();
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'form:reset',
          sessionId: collabSessionId,
          userName: collabUserName,
          formValues: emptyVals,
        })
      );
    }
    setStatusBanner({
      type: 'info',
      text: 'Test formu alanları temizlendi.',
    });
  };

  // Core Save logic (also ensures club & athlete are registered in the club roster if new)
  const performSaveRecord = async (startNextAthleteSameClub: boolean) => {
    if (formMode === 'view') return;

    if (!formValues.athleteName.trim()) {
      setActiveStepSection(1);
      setStatusBanner({
        type: 'error',
        text: 'Lütfen kaydetmeden önce sporcunun "Adı Soyadı" alanını doldurun.',
      });
      return;
    }

    setIsSaving(true);
    const sanitized = sanitizeFormPayload(formValues);
    const nowIso = new Date().toISOString();
    const recordId =
      editingRecordId ||
      `rota_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    try {
      if (user) {
        const docRef = doc(db, 'performanceTests', recordId);
        const existingInCloud = cloudRecords.some((r) => r.id === recordId);

        if (editingRecordId && existingInCloud) {
          try {
            await updateDoc(docRef, {
              ...sanitized,
              updatedAt: serverTimestamp(),
            });
          } catch (error) {
            handleFirestoreError(
              error,
              OperationType.UPDATE,
              `performanceTests/${recordId}`
            );
          }
        } else {
          try {
            await setDoc(docRef, {
              ...sanitized,
              ownerId: user.uid,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          } catch (error) {
            handleFirestoreError(
              error,
              OperationType.CREATE,
              `performanceTests/${recordId}`
            );
          }
        }
      }

      // Auto-register club and athlete into local roster if not already present
      if (sanitized.sportsClub) {
        const clubExists = allClubs.some(
          (c) =>
            c.name.toLocaleLowerCase('tr-TR') ===
            sanitized.sportsClub.toLocaleLowerCase('tr-TR')
        );
        let clubIdToUse =
          allClubs.find(
            (c) =>
              c.name.toLocaleLowerCase('tr-TR') ===
              sanitized.sportsClub.toLocaleLowerCase('tr-TR')
          )?.id || `club_${Date.now()}`;

        if (!clubExists) {
          clubIdToUse = `club_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
          const newClub: SportsClubRecord = {
            id: clubIdToUse,
            ownerId: user?.uid || 'local_user',
            name: sanitized.sportsClub,
            branch: '',
            createdAt: nowIso,
            syncedToCloud: Boolean(user),
          };
          const nextClubs = [newClub, ...localClubs];
          saveLocalClubs(nextClubs);
          setLocalClubs(nextClubs);
        }

        const athleteExists = allAthletes.some(
          (a) =>
            a.sportsClub.toLocaleLowerCase('tr-TR') ===
              sanitized.sportsClub.toLocaleLowerCase('tr-TR') &&
            a.athleteName.toLocaleLowerCase('tr-TR') ===
              sanitized.athleteName.toLocaleLowerCase('tr-TR')
        );
        if (!athleteExists) {
          const newAth: ClubAthleteRecord = {
            id: `ath_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            ownerId: user?.uid || 'local_user',
            clubId: clubIdToUse,
            sportsClub: sanitized.sportsClub,
            athleteName: sanitized.athleteName,
            birthDate: sanitized.birthDate,
            createdAt: nowIso,
            syncedToCloud: Boolean(user),
          };
          const nextAthletes = [...localAthletes, newAth];
          saveLocalAthletes(nextAthletes);
          setLocalAthletes(nextAthletes);
        }
      }

      const updatedLocalRecord: PerformanceTestRecord = {
        ...sanitized,
        id: recordId,
        ownerId: user?.uid || 'local_user',
        createdAt:
          localRecords.find((r) => r.id === recordId)?.createdAt || nowIso,
        updatedAt: nowIso,
        syncedToCloud: Boolean(user),
      };

      const nextLocal = localRecords.some((r) => r.id === recordId)
        ? localRecords.map((r) =>
            r.id === recordId ? updatedLocalRecord : r
          )
        : [updatedLocalRecord, ...localRecords];

      saveLocalRecords(nextLocal);
      setLocalRecords(nextLocal);
      releaseCategoryLock();

      // Automatic Webhook Dispatch when form is saved or updated
      const eventType = editingRecordId
        ? 'performance_test.updated'
        : 'performance_test.saved';
      let autoWebhookOk: boolean | null = null;
      let autoWebhookErr = '';
      if (webhookAutoSend && webhookTargetUrl.trim()) {
        const dispatchRes = await triggerWebhookDispatch(
          [updatedLocalRecord],
          eventType,
          true,
          webhookTargetUrl.trim()
        );
        autoWebhookOk = dispatchRes.ok;
        autoWebhookErr = dispatchRes.error || '';
      }

      if (startNextAthleteSameClub) {
        const clubKeep = sanitized.sportsClub;
        const dateKeep = sanitized.testDate;
        const nextEmpty = {
          ...createEmptyFormValues(clubKeep),
          testDate: dateKeep,
        };
        setFormValues(nextEmpty);
        setEditingRecordId(null);
        setActiveStepSection(1);
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: 'form:reset',
              sessionId: collabSessionId,
              userName: collabUserName,
              formValues: nextEmpty,
            })
          );
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
        setStatusBanner({
          type: autoWebhookOk === false ? 'error' : 'success',
          text:
            autoWebhookOk === false
              ? `"${sanitized.athleteName}" kaydedildi ancak Webhook iletilemedi: ${autoWebhookErr}`
              : `"${sanitized.athleteName}" kaydedildi${autoWebhookOk ? ' (Webhook iletildi)' : ''}. "${clubKeep || 'Aynı grup'}" için yeni sporcu formu hazır!`,
        });
      } else {
        setFormValues(sanitized);
        setEditingRecordId(recordId);
        setStatusBanner({
          type: autoWebhookOk === false ? 'error' : 'success',
          text:
            autoWebhookOk === false
              ? `"${sanitized.athleteName}" kaydedildi ancak Webhook iletilemedi: ${autoWebhookErr}`
              : editingRecordId
                ? `"${sanitized.athleteName}" sporcusuna ait test kaydı güncellendi${autoWebhookOk ? ' ve Webhook ile gönderildi.' : '.'}`
                : `"${sanitized.athleteName}" sporcusuna ait yeni test formu kaydedildi${autoWebhookOk ? ' ve Webhook ile gönderildi.' : '.'}`,
        });
      }
    } finally {
      setIsSaving(false);
    }
  };

  // Persist Webhook Configuration
  useEffect(() => {
    saveWebhookConfig({
      targetUrl: webhookTargetUrl,
      autoSendOnSave: webhookAutoSend,
    });
  }, [webhookTargetUrl, webhookAutoSend]);

  // Keep server-side /api/v1/tests feed synchronized with current records
  useEffect(() => {
    if (allRecords.length === 0) return;
    fetch('/api/v1/tests/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: allRecords }),
    }).catch(() => {
      // Ignore transient network errors
    });
  }, [allRecords]);

  // Dispatch single or multiple test records via the server-side Webhook proxy (/api/webhook/dispatch)
  const triggerWebhookDispatch = async (
    recordsToSend: (PerformanceTestRecord | PerformanceTestFormValues)[],
    eventName = 'performance_test.saved',
    silent = false,
    overrideUrl?: string
  ): Promise<{ ok: boolean; error?: string }> => {
    const urlToUse = (overrideUrl ?? webhookTargetUrl).trim();
    if (!urlToUse) {
      const msg = 'Lütfen önce hedef yazılımın Webhook URL adresini girin.';
      if (!silent) {
        setLastWebhookResult({
          ok: false,
          statusCode: 0,
          sentAt: new Date().toLocaleTimeString('tr-TR'),
          count: 0,
          message: msg,
        });
      }
      return { ok: false, error: msg };
    }

    if (!silent) {
      setIsSendingWebhook(true);
    }

    try {
      const response = await fetch('/api/webhook/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUrl: urlToUse,
          event: eventName,
          records: recordsToSend,
        }),
      });
      const result = await response.json();
      const timeStr = new Date().toLocaleTimeString('tr-TR');

      if (result.ok) {
        setLastWebhookResult({
          ok: true,
          statusCode: Number(result.statusCode || 200),
          sentAt: timeStr,
          count: Number(result.count || recordsToSend.length),
          message: `${recordsToSend.length} test formu hedef yazılıma başarıyla iletildi (HTTP ${result.statusCode || 200}).`,
        });
        if (!silent) {
          setStatusBanner({
            type: 'success',
            text: `Webhook başarılı: ${recordsToSend.length} test formu hedef yazılıma iletildi.`,
          });
        }
        return { ok: true };
      } else {
        const errMsg =
          result.error ||
          `Hedef sunucu HTTP ${result.statusCode} yanıtı döndürdü.`;
        setLastWebhookResult({
          ok: false,
          statusCode: Number(result.statusCode || 0),
          sentAt: timeStr,
          count: recordsToSend.length,
          message: errMsg,
        });
        if (!silent) {
          setStatusBanner({
            type: 'error',
            text: errMsg,
          });
        }
        return { ok: false, error: errMsg };
      }
    } catch {
      const errMsg = 'Webhook isteği gönderilirken bağlantı hatası oluştu.';
      if (!silent) {
        setLastWebhookResult({
          ok: false,
          statusCode: 0,
          sentAt: new Date().toLocaleTimeString('tr-TR'),
          count: recordsToSend.length,
          message: errMsg,
        });
      }
      return { ok: false, error: errMsg };
    } finally {
      if (!silent) {
        setIsSendingWebhook(false);
      }
    }
  };

  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    await performSaveRecord(false);
  };

  // Open record in View Mode
  const handleViewRecord = (record: PerformanceTestRecord) => {
    const {
      id,
      ownerId: _o,
      createdAt: _c,
      updatedAt: _u,
      syncedToCloud: _s,
      ...fields
    } = record;
    setFormValues(fields);
    setEditingRecordId(id);
    setFormMode('view');
    setEntryLayoutMode('all');
    setActiveTab('form');
    setMobileDrawerOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Open record in Edit Mode
  const handleEditRecord = (record: PerformanceTestRecord) => {
    const {
      id,
      ownerId: _o,
      createdAt: _c,
      updatedAt: _u,
      syncedToCloud: _s,
      ...fields
    } = record;
    setFormValues(fields);
    setEditingRecordId(id);
    setFormMode('edit');
    setActiveTab('form');
    setMobileDrawerOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Print a specific record from the list or current form
  const handlePrintRecord = (record?: PerformanceTestRecord) => {
    setEntryLayoutMode('all');
    setMobileDrawerOpen(false);
    if (record) {
      const {
        id,
        ownerId: _o,
        createdAt: _c,
        updatedAt: _u,
        syncedToCloud: _s,
        ...fields
      } = record;
      setFormValues(fields);
      setEditingRecordId(id);
      setFormMode('view');
      setActiveTab('form');
      setTimeout(() => {
        window.print();
      }, 180);
    } else {
      setActiveTab('form');
      setTimeout(() => {
        window.print();
      }, 120);
    }
  };

  // Jump to a specific form section from the left sidebar or mobile bar
  const handleJumpToSection = (sectionId: number, anchorId: string) => {
    setActiveTab('form');
    setMobileDrawerOpen(false);

    if (isSectionLockedByOther(sectionId)) {
      const locker = getSectionLocker(sectionId);
      setStatusBanner({
        type: 'error',
        text: `${FORM_SECTIONS.find((s) => s.id === sectionId)?.fullTitle} kategorisinde şu anda "${locker?.userName}" veri giriyor. Farklı bir kategori seçebilirsiniz.`,
      });
      if (entryLayoutMode === 'step') {
        return;
      }
    } else if (formMode === 'edit') {
      requestCategoryLock(sectionId);
    }

    setActiveStepSection(sectionId);
    if (entryLayoutMode === 'all') {
      setTimeout(() => {
        const el = document.getElementById(anchorId);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 60);
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // Delete record after modal confirmation
  const handleConfirmDelete = async () => {
    if (!recordToDelete) return;
    const target = recordToDelete;
    setRecordToDelete(null);

    if (user) {
      const docRef = doc(db, 'performanceTests', target.id);
      try {
        await deleteDoc(docRef);
      } catch (error) {
        handleFirestoreError(
          error,
          OperationType.DELETE,
          `performanceTests/${target.id}`
        );
      }
    }

    const nextLocal = localRecords.filter((r) => r.id !== target.id);
    saveLocalRecords(nextLocal);
    setLocalRecords(nextLocal);

    if (editingRecordId === target.id) {
      setFormValues(createEmptyFormValues());
      setEditingRecordId(null);
      setFormMode('edit');
    }

    setStatusBanner({
      type: 'info',
      text: `"${target.athleteName}" (${formatTurkishDate(target.testDate)}) test kaydı silindi.`,
    });
  };

  // Google Auth Sign-In / Sign-Out
  const handleGoogleSignIn = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      setStatusBanner({
        type: 'success',
        text: 'Firebase bulut veritabanı bağlantısı aktif edildi.',
      });
    } catch (error) {
      console.error('Google Sign-In error:', error);
      setStatusBanner({
        type: 'error',
        text: 'Google ile giriş yapılırken pencere kapatıldı veya bağlantı tamamlanamadı.',
      });
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
    setStatusBanner({
      type: 'info',
      text: 'Bulut oturumu kapatıldı.',
    });
  };

  const isReadOnly = formMode === 'view';
  const showSection = (secNum: number) =>
    entryLayoutMode === 'all' || isReadOnly || activeStepSection === secNum;

  const renderSectionLockBadge = (sectionId: number, _defaultSubtitle = '') => {
    const locker = getSectionLocker(sectionId);
    const lockedOther = locker && locker.sessionId !== collabSessionId;
    const lockedMe = locker && locker.sessionId === collabSessionId;

    if (isReadOnly || (!lockedOther && !lockedMe)) return null;

    return (
      <div className="no-print flex items-center gap-1.5">
        {lockedOther && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-400 text-[#0B192C]">
            <Lock className="w-3 h-3" />
            <span>Kilitli</span>
          </span>
        )}
        {lockedMe && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-400 text-[#0B192C]">
            <Check className="w-3 h-3" />
            <span>Aktif</span>
          </span>
        )}
      </div>
    );
  };

  const renderSectionLockAlert = (sectionId: number) => {
    if (isReadOnly) return null;
    const locker = getSectionLocker(sectionId);
    if (!locker || locker.sessionId === collabSessionId) return null;

    return (
      <div className="no-print mb-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-300 text-amber-950 text-xs font-semibold flex items-center gap-2">
        <Lock className="w-3.5 h-3.5 text-amber-700 shrink-0" />
        <span>Bu kategori şu anda başka bir kullanıcı tarafından dolduruluyor.</span>
      </div>
    );
  };

  // Sidebar Content Renderer (shared between desktop collapsible sidebar and mobile slide-over drawer)
  const renderSidebarNavigation = (isMobileDrawer: boolean) => {
    const isCollapsed = !isMobileDrawer && sidebarCollapsed;

    return (
      <div className="flex flex-col h-full bg-[#0B192C] text-white select-none">
        {/* Sidebar Brand Header */}
        <div className="flex items-center justify-between gap-2 px-3.5 py-4 border-b border-white/10">
          <button
            type="button"
            onClick={() => {
              setActiveTab('form');
              setMobileDrawerOpen(false);
            }}
            className="flex items-center gap-3 min-w-0 text-left cursor-pointer"
          >
            {!logoLoadError ? (
              <img
                src={ROTA_LOGO_PATH}
                alt="ROTA Performans"
                referrerPolicy="no-referrer"
                onError={() => setLogoLoadError(true)}
                className="w-10 h-10 rounded-full object-contain bg-[#0B192C] shrink-0"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-[#0F294A] border border-[#00B4D8] flex items-center justify-center font-bold text-sm text-[#38BDF8] shrink-0">
                RP
              </div>
            )}
            {!isCollapsed && (
              <div className="min-w-0">
                <div className="text-base font-extrabold tracking-tight text-white truncate">
                  ROTA PERFORMANS
                </div>
                <div className="text-[11px] font-medium text-[#38BDF8] truncate">
                  Dijital Ölçüm Sistemi
                </div>
              </div>
            )}
          </button>

          {isMobileDrawer ? (
            <button
              type="button"
              onClick={() => setMobileDrawerOpen(false)}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              aria-label="Menüyü Kapat"
            >
              <X className="w-5 h-5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setSidebarCollapsed((prev) => !prev)}
              title={isCollapsed ? 'Menüyü Genişlet' : 'Menüyü Daralt'}
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
            >
              {isCollapsed ? (
                <PanelLeftOpen className="w-5 h-5 text-[#38BDF8]" />
              ) : (
                <PanelLeftClose className="w-5 h-5" />
              )}
            </button>
          )}
        </div>

        {/* Primary CTA: Yeni Test Formu */}
        <div className="p-3 border-b border-white/10">
          <button
            type="button"
            onClick={() => handleStartNewForm('')}
            title="Yeni Test Formu Oluştur"
            className={`w-full min-h-[46px] flex items-center ${
              isCollapsed ? 'justify-center px-2' : 'justify-start gap-3 px-4'
            } rounded-xl bg-[#0284C7] hover:bg-[#00B4D8] active:scale-[0.99] text-white font-semibold text-sm transition-all cursor-pointer`}
          >
            <Plus className="w-5 h-5 shrink-0" />
            {!isCollapsed && (
              <span className="truncate whitespace-nowrap">Yeni Test Formu</span>
            )}
          </button>
        </div>

        {/* Scrollable Navigation Categories */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5">
          {/* Category 1: Spor Kulüpleri ve Sporcular (Kulüp Ekle -> Sporcu Ekle -> Ölçüm Gir) */}
          <div>
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('clubs');
                  setMobileDrawerOpen(false);
                }}
                title="Spor Kulüpleri ve Sporcular"
                className={`flex-1 min-h-[46px] flex items-center ${
                  isCollapsed ? 'justify-center px-2' : 'justify-between px-3.5'
                } rounded-xl text-sm font-medium transition-colors cursor-pointer ${
                  activeTab === 'clubs'
                    ? 'bg-[#0F294A] text-[#38BDF8] border border-[#00B4D8]/40 font-semibold'
                    : 'text-slate-300 hover:bg-white/5 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Building2 className="w-5 h-5 shrink-0" />
                  {!isCollapsed && (
                    <span className="truncate">Spor Kulüpleri</span>
                  )}
                </div>
                {!isCollapsed && (
                  <span className="text-xs tabular-nums text-slate-400 ml-2">
                    {clubsSummary.length}
                  </span>
                )}
              </button>

              {!isCollapsed && (
                <button
                  type="button"
                  onClick={() => setSidebarClubsOpen((prev) => !prev)}
                  className="min-h-[44px] min-w-[36px] flex items-center justify-center text-slate-400 hover:text-white cursor-pointer"
                  aria-label="Spor Kulüpleri Alt Menüsünü Aç/Kapat"
                >
                  <ChevronDown
                    className={`w-4 h-4 transition-transform ${
                      sidebarClubsOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>
              )}
            </div>

            {/* Collapsible Sub-items for each Sports Club */}
            {!isCollapsed && sidebarClubsOpen && (
              <div className="mt-1 ml-4 pl-3 border-l border-white/10 space-y-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddClubForm(true);
                    setActiveTab('clubs');
                    setMobileDrawerOpen(false);
                  }}
                  className="w-full min-h-[34px] px-2.5 py-1 rounded-lg text-left text-xs font-semibold text-[#38BDF8] hover:bg-white/5 flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Yeni Spor Kulübü Ekle</span>
                </button>

                {clubsSummary.map((club) => {
                  const isSelected =
                    activeTab === 'clubs' && selectedClubView === club.clubName;
                  return (
                    <button
                      key={club.clubName}
                      type="button"
                      onClick={() => {
                        setSelectedClubView(club.clubName);
                        setActiveTab('clubs');
                        setMobileDrawerOpen(false);
                      }}
                      className={`w-full min-h-[36px] px-2.5 py-1.5 rounded-lg text-left text-xs transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                        isSelected
                          ? 'bg-[#0284C7]/30 text-[#38BDF8] font-semibold'
                          : 'text-slate-300 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      <span className="truncate">{club.clubName}</span>
                      <span className="tabular-nums text-[11px] text-slate-400 shrink-0">
                        {club.uniqueAthleteKeys.size} sp · {club.records.length} test
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Category 2: Test Formu + Collapsible Section Submenu */}
          <div>
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('form');
                  setMobileDrawerOpen(false);
                }}
                title="Test Formu"
                className={`flex-1 min-h-[46px] flex items-center ${
                  isCollapsed ? 'justify-center px-2' : 'justify-between px-3.5'
                } rounded-xl text-sm font-medium transition-colors cursor-pointer ${
                  activeTab === 'form'
                    ? 'bg-[#0F294A] text-[#38BDF8] border border-[#00B4D8]/40 font-semibold'
                    : 'text-slate-300 hover:bg-white/5 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <FileText className="w-5 h-5 shrink-0" />
                  {!isCollapsed && (
                    <span className="truncate">Test Formu</span>
                  )}
                </div>
              </button>

              {!isCollapsed && (
                <button
                  type="button"
                  onClick={() => setSidebarSectionsOpen((prev) => !prev)}
                  className="min-h-[44px] min-w-[36px] flex items-center justify-center text-slate-400 hover:text-white cursor-pointer"
                  aria-label="Form Bölümlerini Aç/Kapat"
                >
                  <ChevronDown
                    className={`w-4 h-4 transition-transform ${
                      sidebarSectionsOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>
              )}
            </div>

            {/* Collapsible Sub-items for the 7 Form Sections */}
            {!isCollapsed && sidebarSectionsOpen && (
              <div className="mt-1 ml-4 pl-3 border-l border-white/10 space-y-1">
                {FORM_SECTIONS.map((sec) => {
                  const isCurrentStep =
                    activeTab === 'form' &&
                    entryLayoutMode === 'step' &&
                    activeStepSection === sec.id;
                  return (
                    <button
                      key={sec.id}
                      type="button"
                      onClick={() => handleJumpToSection(sec.id, sec.anchor)}
                      className={`w-full min-h-[36px] px-2.5 py-1.5 rounded-lg text-left text-xs transition-colors flex items-center justify-between cursor-pointer ${
                        isCurrentStep
                          ? 'bg-[#0284C7]/30 text-[#38BDF8] font-semibold'
                          : 'text-slate-300 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      <span className="truncate">{sec.fullTitle}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Category 3: Tüm Kayıtlı Formlar */}
          <button
            type="button"
            onClick={() => {
              setActiveTab('records');
              setMobileDrawerOpen(false);
            }}
            title="Kayıtlı Formlar"
            className={`w-full min-h-[46px] flex items-center ${
              isCollapsed ? 'justify-center px-2' : 'justify-between px-3.5'
            } rounded-xl text-sm font-medium transition-colors cursor-pointer ${
              activeTab === 'records'
                ? 'bg-[#0F294A] text-[#38BDF8] border border-[#00B4D8]/40 font-semibold'
                : 'text-slate-300 hover:bg-white/5 hover:text-white'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <FolderOpen className="w-5 h-5 shrink-0" />
              {!isCollapsed && (
                <span className="truncate">Tüm Kayıtlı Formlar</span>
              )}
            </div>
            {!isCollapsed && (
              <span className="text-xs tabular-nums text-slate-400">
                {allRecords.length}
              </span>
            )}
          </button>

          {/* Divider */}
          <div className="my-3 border-t border-white/10" />

          {!isCollapsed && (
            <div className="px-3 py-1 text-[11px] font-semibold text-slate-400">
              Araçlar ve Çıktı
            </div>
          )}

          {/* Action: Formu Yazdır */}
          <button
            type="button"
            onClick={() => handlePrintRecord()}
            title="Formu Yazdır"
            className={`w-full min-h-[44px] flex items-center ${
              isCollapsed ? 'justify-center px-2' : 'justify-start gap-3 px-3.5'
            } rounded-xl text-sm font-medium text-slate-300 hover:bg-white/5 hover:text-white transition-colors cursor-pointer`}
          >
            <Printer className="w-5 h-5 shrink-0" />
            {!isCollapsed && <span className="truncate">Formu Yazdır</span>}
          </button>

          {/* Action: PDF */}
          <button
            type="button"
            onClick={() => {
              downloadPerformanceTestPdf(formValues);
              setMobileDrawerOpen(false);
            }}
            title="PDF"
            className={`w-full min-h-[42px] flex items-center ${
              isCollapsed ? 'justify-center px-2' : 'justify-start gap-3 px-3.5'
            } rounded-xl text-sm font-medium text-slate-300 hover:bg-white/5 hover:text-white transition-colors cursor-pointer`}
          >
            <Download className="w-4 h-4 shrink-0" />
            {!isCollapsed && <span className="truncate">PDF</span>}
          </button>

          {/* Action: Excel */}
          <button
            type="button"
            onClick={() => {
              exportSingleTestToExcel(formValues);
              setMobileDrawerOpen(false);
            }}
            title="Excel"
            className={`w-full min-h-[42px] flex items-center ${
              isCollapsed ? 'justify-center px-2' : 'justify-start gap-3 px-3.5'
            } rounded-xl text-sm font-medium text-slate-300 hover:bg-white/5 hover:text-white transition-colors cursor-pointer`}
          >
            <Download className="w-4 h-4 shrink-0 text-emerald-400" />
            {!isCollapsed && <span className="truncate">Excel</span>}
          </button>

          {/* Action: Tam Ekran Modu (Desktop Only) */}
          {!isMobileDrawer && (
            <button
              type="button"
              onClick={() => {
                toggleFullscreen();
                setMobileDrawerOpen(false);
              }}
              title={isFullscreen ? 'Tam Ekrandan Çık' : 'Tam Ekran Modu'}
              className={`w-full min-h-[42px] flex items-center ${
                isCollapsed ? 'justify-center px-2' : 'justify-start gap-3 px-3.5'
              } rounded-xl text-sm font-medium transition-colors cursor-pointer ${
                isFullscreen
                  ? 'bg-[#0284C7]/20 text-[#38BDF8]'
                  : 'text-slate-300 hover:bg-white/5 hover:text-white'
              }`}
            >
              {isFullscreen ? (
                <Minimize2 className="w-4 h-4 shrink-0" />
              ) : (
                <Maximize2 className="w-4 h-4 shrink-0" />
              )}
              {!isCollapsed && (
                <span className="truncate">
                  {isFullscreen ? 'Tam Ekrandan Çık' : 'Tam Ekran'}
                </span>
              )}
            </button>
          )}
        </div>

      </div>
    );
  };

  return (
    <div
      className={`min-h-screen flex bg-[#F0F6FC] text-[#0B192C] ${
        isFullscreen ? 'fixed inset-0 z-40 overflow-hidden' : ''
      }`}
    >
      {/* DESKTOP COLLAPSIBLE LEFT SIDEBAR (Hidden on Mobile & Print) */}
      <aside
        className={`no-print hidden lg:flex flex-col shrink-0 border-r border-slate-800 transition-all duration-200 ${
          sidebarCollapsed ? 'w-[76px]' : 'w-64'
        } ${isFullscreen ? 'h-screen' : 'sticky top-0 h-screen'}`}
      >
        {renderSidebarNavigation(false)}
      </aside>

      {/* MOBILE & TABLET SLIDE-OVER DRAWER (Hidden on Desktop & Print) */}
      {mobileDrawerOpen && (
        <div
          className="no-print fixed inset-0 z-50 lg:hidden flex"
          role="dialog"
          aria-modal="true"
          aria-label="Ana Menü"
        >
          <div
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs"
            onClick={() => setMobileDrawerOpen(false)}
          />
          <div className="relative z-10 w-72 max-w-[85vw] h-full shadow-2xl">
            {renderSidebarNavigation(true)}
          </div>
        </div>
      )}

      {/* RIGHT MAIN WORKSPACE COLUMN */}
      <div
        className={`flex-1 flex flex-col min-w-0 ${
          isFullscreen ? 'h-screen overflow-y-auto' : 'min-h-screen'
        }`}
      >
        {/* COMPACT TOP HEADER BAR */}
        <header className="no-print sticky top-0 z-30 bg-[#0B192C] text-white border-b-2 border-[#00B4D8] px-3 sm:px-6 h-13 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setMobileDrawerOpen(true)}
              className="lg:hidden min-h-[40px] min-w-[40px] -ml-1 flex items-center justify-center rounded-lg text-white hover:bg-white/10 transition-colors cursor-pointer"
              aria-label="Menüyü Aç"
            >
              <Menu className="w-5 h-5 text-[#38BDF8]" />
            </button>

            <span className="text-sm sm:text-base font-extrabold tracking-tight text-white truncate">
              ROTA PERFORMANS
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => handleStartNewForm('')}
              className="min-h-[36px] px-3 rounded-lg bg-[#0284C7] hover:bg-[#00B4D8] active:scale-95 text-xs font-semibold text-white inline-flex items-center gap-1 transition-all cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Yeni Form</span>
            </button>

            <button
              type="button"
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Tam Ekrandan Çık' : 'Tam Ekran'}
              className="hidden lg:inline-flex min-h-[36px] px-2.5 rounded-lg bg-[#0F294A] hover:bg-[#163760] border border-[#00B4D8]/30 text-xs font-semibold text-[#38BDF8] items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
            >
              {isFullscreen ? (
                <Minimize2 className="w-4 h-4" />
              ) : (
                <Maximize2 className="w-4 h-4" />
              )}
              <span>{isFullscreen ? 'Çık' : 'Tam Ekran'}</span>
            </button>
          </div>
        </header>

        {/* Status Notification Banner */}
        {statusBanner && (
          <div className="no-print max-w-6xl mx-auto w-full px-3 sm:px-6 pt-3">
            <div
              role="status"
              className={`flex items-center justify-between gap-3 px-4 py-3 rounded-xl border text-sm font-medium ${
                statusBanner.type === 'success'
                  ? 'bg-sky-50 border-sky-300 text-[#0B192C]'
                  : statusBanner.type === 'error'
                    ? 'bg-red-50 border-red-300 text-red-900'
                    : 'bg-white border-slate-300 text-[#0B192C]'
              }`}
            >
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-[#0284C7] shrink-0" />
                <span>{statusBanner.text}</span>
              </div>
              <button
                type="button"
                onClick={() => setStatusBanner(null)}
                className="min-h-[36px] min-w-[36px] flex items-center justify-center text-slate-500 hover:text-slate-800 cursor-pointer"
                aria-label="Bildirimi Kapat"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* MAIN VIEWPORT CONTENT */}
        <main
          className={`flex-1 w-full mx-auto px-3 sm:px-6 py-4 sm:py-6 pb-24 lg:pb-8 ${
            isFullscreen ? 'max-w-full' : 'max-w-6xl'
          }`}
        >
          {activeTab === 'form' && (
            <div>
              {/* Minimal Form Control Bar (Hidden on Print) */}
              <div className="no-print bg-white border border-slate-200 rounded-xl p-2.5 sm:p-3 mb-3 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {!isReadOnly ? (
                    <div className="flex items-center gap-1 p-0.5 bg-[#F0F6FC] border border-slate-200 rounded-lg">
                      <button
                        type="button"
                        onClick={() => setEntryLayoutMode('all')}
                        className={`min-h-[34px] px-2.5 py-1 rounded-md text-xs font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
                          entryLayoutMode === 'all'
                            ? 'bg-[#0B192C] text-white'
                            : 'text-slate-600 hover:text-[#0B192C]'
                        }`}
                      >
                        <Layers className="w-3.5 h-3.5 text-[#38BDF8]" />
                        <span>Tümü</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setEntryLayoutMode('step')}
                        className={`min-h-[34px] px-2.5 py-1 rounded-md text-xs font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
                          entryLayoutMode === 'step'
                            ? 'bg-[#0B192C] text-white'
                            : 'text-slate-600 hover:text-[#0B192C]'
                        }`}
                      >
                        <ListChecks className="w-3.5 h-3.5 text-[#38BDF8]" />
                        <span>Adım Adım</span>
                      </button>
                    </div>
                  ) : (
                    <div className="text-xs sm:text-sm font-bold text-[#0B192C] truncate">
                      {formValues.athleteName || 'Form Önizleme'}
                    </div>
                  )}

                  {/* Compact Action Buttons (All uniform h-9 rounded-lg) */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {isReadOnly ? (
                      <button
                        type="button"
                        onClick={() => setFormMode('edit')}
                        className="h-9 inline-flex items-center justify-center gap-1 px-3 text-xs font-semibold text-white bg-[#0284C7] hover:bg-[#0369A1] rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <Edit3 className="w-3.5 h-3.5 shrink-0" />
                        <span>Düzenle</span>
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => setConfirmClearOpen(true)}
                          title="Formu Temizle"
                          className="h-9 inline-flex items-center justify-center gap-1 px-2.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                        >
                          <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                          <span className="hidden sm:inline">Temizle</span>
                        </button>
                        <button
                          type="submit"
                          form="rota-performance-form"
                          disabled={isSaving}
                          className="h-9 inline-flex items-center justify-center gap-1 px-3 text-xs font-semibold text-white bg-[#0284C7] hover:bg-[#0369A1] disabled:opacity-60 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                        >
                          <Save className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            {isSaving
                              ? '...'
                              : editingRecordId
                                ? 'Güncelle'
                                : 'Kaydet'}
                          </span>
                        </button>
                      </>
                    )}

                    <button
                      type="button"
                      onClick={() => downloadPerformanceTestPdf(formValues)}
                      className="h-9 inline-flex items-center justify-center gap-1 px-2.5 text-xs font-semibold text-white bg-[#0B192C] hover:bg-[#0F294A] rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5 shrink-0" />
                      <span>PDF</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => exportSingleTestToExcel(formValues)}
                      className="h-9 inline-flex items-center justify-center gap-1 px-2.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5 shrink-0" />
                      <span>Excel</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handlePrintRecord()}
                      className="hidden sm:inline-flex h-9 items-center justify-center gap-1 px-2.5 text-xs font-semibold text-[#0B192C] bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Printer className="w-3.5 h-3.5 shrink-0" />
                      <span>Yazdır</span>
                    </button>
                  </div>
                </div>

                {/* Section Navigation Row */}
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                  {/* Section Navigation: Dropdown on Mobile / Tablet / Step Mode, Compact Pills on Wide Desktop */}
                  <div
                    className={
                      entryLayoutMode === 'step'
                        ? 'flex items-center gap-1.5 flex-1'
                        : 'flex xl:hidden items-center gap-1.5 flex-1'
                    }
                  >
                    {entryLayoutMode === 'step' && (
                      <button
                        type="button"
                        disabled={activeStepSection <= 1}
                        onClick={() =>
                          setActiveStepSection((prev) => Math.max(1, prev - 1))
                        }
                        aria-label="Önceki Bölüm"
                        className="h-9 w-9 shrink-0 rounded-lg border border-slate-300 bg-[#F0F6FC] hover:bg-[#E2EEF8] disabled:opacity-40 text-[#0B192C] flex items-center justify-center cursor-pointer"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                    )}

                    <div className="relative flex-1 min-w-0">
                      <select
                        id="mobile-section-select"
                        aria-label="Form Bölümü Seçin"
                        value={activeStepSection}
                        onChange={(e) => {
                          const nextId = Number(e.target.value);
                          const found = FORM_SECTIONS.find(
                            (s) => s.id === nextId
                          );
                          if (found) {
                            handleJumpToSection(found.id, found.anchor);
                          }
                        }}
                        className="w-full h-9 pl-3 pr-8 rounded-lg border border-[#0284C7] bg-[#F0F6FC] text-[#0B192C] text-xs sm:text-sm font-bold appearance-none focus:outline-none cursor-pointer"
                      >
                        {FORM_SECTIONS.map((sec) => {
                          const locker = getSectionLocker(sec.id);
                          const lockedOther =
                            locker && locker.sessionId !== collabSessionId;
                          const lockedMe =
                            locker && locker.sessionId === collabSessionId;
                          return (
                            <option
                              key={sec.id}
                              value={sec.id}
                              disabled={Boolean(
                                entryLayoutMode === 'step' && lockedOther
                              )}
                            >
                              {sec.fullTitle}
                              {lockedOther
                                ? ' 🔒 (Kilitli)'
                                : lockedMe
                                  ? ' ✓'
                                  : ''}
                            </option>
                          );
                        })}
                      </select>
                      <ChevronDown className="w-4 h-4 text-[#0284C7] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>

                    {entryLayoutMode === 'step' && (
                      <button
                        type="button"
                        disabled={activeStepSection >= FORM_SECTIONS.length}
                        onClick={() =>
                          setActiveStepSection((prev) =>
                            Math.min(FORM_SECTIONS.length, prev + 1)
                          )
                        }
                        aria-label="Sonraki Bölüm"
                        className="h-9 w-9 shrink-0 rounded-lg border border-slate-300 bg-[#F0F6FC] hover:bg-[#E2EEF8] disabled:opacity-40 text-[#0B192C] flex items-center justify-center cursor-pointer"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  {entryLayoutMode === 'all' && (
                    <div className="hidden xl:flex flex-wrap items-center gap-1">
                      {FORM_SECTIONS.map((sec) => {
                        const locker = getSectionLocker(sec.id);
                        const lockedOther =
                          locker && locker.sessionId !== collabSessionId;
                        const lockedMe =
                          locker && locker.sessionId === collabSessionId;
                        return (
                          <button
                            key={sec.id}
                            type="button"
                            onClick={() =>
                              handleJumpToSection(sec.id, sec.anchor)
                            }
                            className={`min-h-[32px] px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer inline-flex items-center gap-1 ${
                              lockedOther
                                ? 'bg-amber-50 text-amber-900 border border-amber-300'
                                : lockedMe
                                  ? 'bg-[#0284C7] text-white'
                                  : 'bg-[#F0F6FC] text-[#0B192C] hover:bg-[#E2EEF8]'
                            }`}
                          >
                            {lockedOther && <Lock className="w-3 h-3" />}
                            <span>{sec.shortTitle}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* THE PAPER-FAITHFUL DIGITAL TEST FORM SHEET */}
              <form
                id="rota-performance-form"
                onSubmit={handleSaveForm}
                className="print-only-sheet bg-white border-2 border-[#0B192C] rounded-2xl overflow-hidden"
              >
                {/* Form Sheet Header Banner */}
                <div className="bg-[#0B192C] text-white px-4 sm:px-6 py-4 sm:py-5 border-b-4 border-[#00B4D8] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 print-compact-pad">
                  <div className="flex items-center gap-3.5">
                    {!logoLoadError ? (
                      <img
                        src={ROTA_LOGO_PATH}
                        alt="ROTA Performans Logo"
                        referrerPolicy="no-referrer"
                        onError={() => setLogoLoadError(true)}
                        className="w-14 h-14 sm:w-20 sm:h-20 object-contain rounded-full bg-[#0B192C] p-0.5 shrink-0"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-full bg-[#0F294A] border-2 border-[#00B4D8] flex items-center justify-center font-bold text-xl text-[#38BDF8] shrink-0">
                        ROTA
                      </div>
                    )}

                    <div>
                      <div className="text-xl sm:text-3xl font-extrabold tracking-tight text-white">
                        ROTA PERFORMANS
                      </div>
                      <h1 className="text-xs sm:text-base font-semibold tracking-wide text-[#38BDF8] mt-0.5">
                        PERFORMANS TEST FORMU
                      </h1>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between sm:flex-col sm:items-end gap-1.5 border-t border-white/10 sm:border-0 pt-2 sm:pt-0">
                    <label
                      htmlFor="header-test-date"
                      className="text-xs font-medium text-slate-300"
                    >
                      {formValues.sportsClub
                        ? `${formValues.sportsClub} · Test Tarihi`
                        : 'Test Tarihi'}
                    </label>
                    {!isReadOnly ? (
                      <input
                        id="header-test-date"
                        type="date"
                        value={
                          formValues.testDate ||
                          systemTestDate ||
                          getTodayIsoDate()
                        }
                        onChange={(e) =>
                          handleTextChange(
                            'testDate',
                            e.target.value,
                            BLUEPRINT_CONSTRAINTS.DATE_MAX_LENGTH
                          )
                        }
                        className="h-9 px-2.5 rounded-lg bg-[#0F294A] border border-[#00B4D8]/50 text-white font-bold tabular-nums text-sm focus:outline-none focus:border-[#38BDF8] cursor-pointer"
                      />
                    ) : (
                      <span className="text-base sm:text-xl font-bold tabular-nums text-white">
                        {formatTurkishDate(
                          formValues.testDate ||
                            systemTestDate ||
                            getTodayIsoDate()
                        )}
                      </span>
                    )}
                  </div>
                </div>

                <div className="p-4 sm:p-7 space-y-6 print-compact-pad">
                  {/* SECTION 1: GENEL BİLGİLER */}
                  {showSection(1) && (
                    <section
                      id="section-1"
                      aria-labelledby="section-genel-bilgiler"
                      onFocusCapture={() => {
                        if (!isReadOnly && !isSectionLockedByOther(1)) {
                          requestCategoryLock(1);
                        }
                      }}
                      className={`scroll-mt-20 ${
                        !isReadOnly && isSectionLockedByOther(1)
                          ? 'opacity-75'
                          : ''
                      }`}
                    >
                      <div className="bg-[#0F294A] text-white px-4 py-2.5 rounded-t-xl border-b-2 border-[#00B4D8] flex flex-wrap items-center justify-between gap-2">
                        <h2
                          id="section-genel-bilgiler"
                          className="text-sm sm:text-base font-bold tracking-wide"
                        >
                          1. Genel Bilgiler
                        </h2>
                        {renderSectionLockBadge(
                          1,
                          'Spor Kulübü, Sporcu ve Tarih'
                        )}
                      </div>

                      <fieldset
                        disabled={isReadOnly || isSectionLockedByOther(1)}
                        className="border border-t-0 border-slate-300 rounded-b-xl p-4 sm:p-5 bg-[#F0F6FC]/70 space-y-4 disabled:cursor-not-allowed"
                      >
                        {renderSectionLockAlert(1)}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 print-compact-gap">
                          {/* SPOR KULÜBÜ SEÇİMİ */}
                          <div>
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                              <label
                                htmlFor="field-sportsClub"
                                className="block text-xs font-bold text-[#0B192C]"
                              >
                                Spor Kulübü
                              </label>
                              {!isReadOnly && knownClubNames.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setIsManualClubInput((prev) => !prev)
                                  }
                                  className="no-print text-[11px] font-semibold text-[#0284C7] hover:underline cursor-pointer"
                                >
                                  {isManualClubInput
                                    ? 'Listeden Seç'
                                    : '+ Manuel'}
                                </button>
                              )}
                            </div>

                            {!isReadOnly &&
                            !isManualClubInput &&
                            knownClubNames.length > 0 ? (
                              <div className="relative">
                                <select
                                  id="field-sportsClub"
                                  value={
                                    knownClubNames.includes(
                                      formValues.sportsClub
                                    )
                                      ? formValues.sportsClub
                                      : ''
                                  }
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    if (val === '__MANUAL_CLUB__') {
                                      setIsManualClubInput(true);
                                      handleTextChange(
                                        'sportsClub',
                                        '',
                                        BLUEPRINT_CONSTRAINTS.SPORTS_CLUB_MAX_LENGTH
                                      );
                                      return;
                                    }
                                    requestCategoryLock(1);
                                    setIsManualAthleteInput(false);
                                    const slicedClub = val.slice(
                                      0,
                                      BLUEPRINT_CONSTRAINTS.SPORTS_CLUB_MAX_LENGTH
                                    );
                                    const clubChanged =
                                      formValues.sportsClub !== slicedClub;
                                    setFormValues((prev) => ({
                                      ...prev,
                                      sportsClub: slicedClub,
                                      athleteName: clubChanged
                                        ? ''
                                        : prev.athleteName,
                                      birthDate: clubChanged
                                        ? ''
                                        : prev.birthDate,
                                    }));
                                    broadcastFieldUpdate(
                                      'sportsClub',
                                      slicedClub
                                    );
                                    if (clubChanged) {
                                      broadcastFieldUpdate('athleteName', '');
                                      broadcastFieldUpdate('birthDate', '');
                                    }
                                  }}
                                  className="w-full h-12 pl-3.5 pr-9 rounded-xl border-2 border-[#0284C7] bg-white text-[#0B192C] text-base sm:text-sm font-semibold appearance-none focus:outline-none focus:border-[#00B4D8] focus:ring-2 focus:ring-[#00B4D8]/20 cursor-pointer"
                                >
                                  <option value="">Kulüp Seçiniz</option>
                                  {knownClubNames.map((club) => (
                                    <option key={club} value={club}>
                                      {club}
                                    </option>
                                  ))}
                                  <option value="__MANUAL_CLUB__">
                                    + Yeni Kulüp Yaz...
                                  </option>
                                </select>
                                <ChevronDown className="no-print w-4 h-4 text-[#0284C7] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                              </div>
                            ) : (
                              <input
                                id="field-sportsClub"
                                type="text"
                                disabled={isReadOnly}
                                placeholder="Kulüp adı..."
                                value={formValues.sportsClub}
                                onChange={(e) =>
                                  handleTextChange(
                                    'sportsClub',
                                    e.target.value,
                                    BLUEPRINT_CONSTRAINTS.SPORTS_CLUB_MAX_LENGTH
                                  )
                                }
                                className="w-full h-12 px-3.5 rounded-xl border border-slate-300 bg-white text-[#0B192C] text-base sm:text-sm font-semibold focus:outline-none focus:border-[#00B4D8] focus:ring-2 focus:ring-[#00B4D8]/20 disabled:bg-slate-100"
                              />
                            )}
                          </div>

                          {/* SPORCU SEÇİMİ */}
                          <div>
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                              <label
                                htmlFor="field-athleteName"
                                className="block text-xs font-bold text-[#0B192C]"
                              >
                                Adı Soyadı
                              </label>
                              {!isReadOnly &&
                                athletesInCurrentFormClub.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setIsManualAthleteInput((prev) => !prev)
                                    }
                                    className="no-print text-[11px] font-semibold text-[#0284C7] hover:underline cursor-pointer"
                                  >
                                    {isManualAthleteInput
                                      ? 'Listeden Seç'
                                      : '+ Manuel'}
                                  </button>
                                )}
                            </div>

                            {!isReadOnly &&
                            !isManualAthleteInput &&
                            athletesInCurrentFormClub.length > 0 ? (
                              <div className="relative">
                                <select
                                  id="field-athleteName"
                                  value={
                                    athletesInCurrentFormClub.some(
                                      (a) =>
                                        a.athleteName === formValues.athleteName
                                    )
                                      ? formValues.athleteName
                                      : ''
                                  }
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    if (val === '__MANUAL_ATHLETE__') {
                                      setIsManualAthleteInput(true);
                                      setFormValues((prev) => ({
                                        ...prev,
                                        athleteName: '',
                                        birthDate: '',
                                      }));
                                      broadcastFieldUpdate('athleteName', '');
                                      broadcastFieldUpdate('birthDate', '');
                                      return;
                                    }
                                    requestCategoryLock(1);
                                    const matchedAth =
                                      athletesInCurrentFormClub.find(
                                        (a) => a.athleteName === val
                                      );
                                    const nextName = val.slice(
                                      0,
                                      BLUEPRINT_CONSTRAINTS.ATHLETE_NAME_MAX_LENGTH
                                    );
                                    const nextBirth =
                                      matchedAth?.birthDate ||
                                      formValues.birthDate;
                                    setFormValues((prev) => ({
                                      ...prev,
                                      athleteName: nextName,
                                      birthDate: nextBirth,
                                    }));
                                    broadcastFieldUpdate(
                                      'athleteName',
                                      nextName
                                    );
                                    broadcastFieldUpdate(
                                      'birthDate',
                                      nextBirth
                                    );
                                  }}
                                  className="w-full h-12 pl-3.5 pr-9 rounded-xl border-2 border-[#0284C7] bg-white text-[#0B192C] text-base sm:text-sm font-semibold appearance-none focus:outline-none focus:border-[#00B4D8] focus:ring-2 focus:ring-[#00B4D8]/20 cursor-pointer"
                                >
                                  <option value="">Sporcu Seçiniz</option>
                                  {athletesInCurrentFormClub.map((ath) => (
                                    <option
                                      key={ath.id}
                                      value={ath.athleteName}
                                    >
                                      {ath.athleteName}
                                      {ath.birthDate
                                        ? ` (${formatTurkishDate(ath.birthDate)})`
                                        : ''}
                                    </option>
                                  ))}
                                  <option value="__MANUAL_ATHLETE__">
                                    + Yeni Sporcu Yaz...
                                  </option>
                                </select>
                                <ChevronDown className="no-print w-4 h-4 text-[#0284C7] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                              </div>
                            ) : (
                              <input
                                id="field-athleteName"
                                type="text"
                                disabled={isReadOnly}
                                placeholder="Adı Soyadı..."
                                value={formValues.athleteName}
                                onChange={(e) =>
                                  handleTextChange(
                                    'athleteName',
                                    e.target.value,
                                    BLUEPRINT_CONSTRAINTS.ATHLETE_NAME_MAX_LENGTH
                                  )
                                }
                                className="w-full h-12 px-3.5 rounded-xl border border-slate-300 bg-white text-[#0B192C] text-base sm:text-sm font-semibold focus:outline-none focus:border-[#00B4D8] focus:ring-2 focus:ring-[#00B4D8]/20 disabled:bg-slate-100"
                              />
                            )}
                          </div>

                          <div>
                            <label
                              htmlFor="field-birthDate"
                              className="block text-xs font-bold text-[#0B192C] mb-1.5"
                            >
                              Doğum Tarihi
                            </label>
                            <input
                              id="field-birthDate"
                              type="date"
                              disabled={isReadOnly}
                              value={formValues.birthDate}
                              onChange={(e) =>
                                handleTextChange(
                                  'birthDate',
                                  e.target.value,
                                  BLUEPRINT_CONSTRAINTS.DATE_MAX_LENGTH
                                )
                              }
                              className="w-full h-12 px-3.5 rounded-xl border border-slate-300 bg-white text-[#0B192C] tabular-nums text-base sm:text-sm font-medium focus:outline-none focus:border-[#00B4D8] focus:ring-2 focus:ring-[#00B4D8]/20 disabled:bg-slate-100"
                            />
                          </div>

                          <div>
                            <label
                              htmlFor="field-testDate"
                              className="block text-xs font-bold text-[#0B192C] mb-1.5"
                            >
                              Test Tarihi
                            </label>
                            <input
                              id="field-testDate"
                              type="date"
                              disabled={isReadOnly}
                              value={
                                formValues.testDate ||
                                systemTestDate ||
                                getTodayIsoDate()
                              }
                              onChange={(e) =>
                                handleTextChange(
                                  'testDate',
                                  e.target.value,
                                  BLUEPRINT_CONSTRAINTS.DATE_MAX_LENGTH
                                )
                              }
                              className="w-full h-12 px-3.5 rounded-xl border border-slate-300 bg-white text-[#0B192C] tabular-nums text-base sm:text-sm font-medium focus:outline-none focus:border-[#00B4D8] focus:ring-2 focus:ring-[#00B4D8]/20 disabled:bg-slate-100"
                            />
                          </div>
                        </div>
                      </fieldset>
                    </section>
                  )}

                  {/* ROW: SECTION 2 (FİZİKSEL ÖLÇÜMLER) & SECTION 3 (PENÇE KUVVETİ) */}
                  {(showSection(2) || showSection(3)) && (
                    <div
                      className={`grid grid-cols-1 ${
                        showSection(2) && showSection(3) ? 'lg:grid-cols-2' : ''
                      } gap-6 print-compact-gap`}
                    >
                      {/* SECTION 2: FİZİKSEL ÖLÇÜMLER */}
                      {showSection(2) && (
                        <section
                          id="section-2"
                          aria-labelledby="section-fiziksel-olcumler"
                          onFocusCapture={() => {
                            if (!isReadOnly && !isSectionLockedByOther(2)) {
                              requestCategoryLock(2);
                            }
                          }}
                          className={`scroll-mt-20 ${
                            !isReadOnly && isSectionLockedByOther(2)
                              ? 'opacity-75'
                              : ''
                          }`}
                        >
                          <div className="bg-[#0F294A] text-white px-4 py-2.5 rounded-t-xl border-b-2 border-[#00B4D8] flex flex-wrap items-center justify-between gap-2">
                            <h2
                              id="section-fiziksel-olcumler"
                              className="text-sm sm:text-base font-bold tracking-wide"
                            >
                              2. Fiziksel Ölçümler
                            </h2>
                            {renderSectionLockBadge(2, 'Antropometri')}
                          </div>

                          <fieldset
                            disabled={isReadOnly || isSectionLockedByOther(2)}
                            className="border border-t-0 border-slate-300 rounded-b-xl p-4 sm:p-5 bg-[#F0F6FC]/70 disabled:cursor-not-allowed"
                          >
                            {renderSectionLockAlert(2)}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                              <label
                                htmlFor="field-heightCm"
                                className="block text-xs font-semibold text-slate-700 mb-1.5"
                              >
                                Boy (cm)
                              </label>
                              <div className="relative">
                                <input
                                  id="field-heightCm"
                                  type="text"
                                  inputMode="decimal"
                                  disabled={isReadOnly}
                                  placeholder="0.0"
                                  value={formValues.heightCm}
                                  onChange={(e) =>
                                    handleDecimalChange(
                                      'heightCm',
                                      e.target.value
                                    )
                                  }
                                  className="w-full h-12 pl-3.5 pr-12 rounded-xl border border-slate-300 bg-white text-[#0B192C] tabular-nums text-base sm:text-sm font-semibold focus:outline-none focus:border-[#00B4D8] focus:ring-2 focus:ring-[#00B4D8]/20 disabled:bg-slate-100"
                                />
                                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#0284C7] pointer-events-none">
                                  cm
                                </span>
                              </div>
                            </div>

                            <div>
                              <label
                                htmlFor="field-weightKg"
                                className="block text-xs font-semibold text-slate-700 mb-1.5"
                              >
                                Ağırlık (kg)
                              </label>
                              <div className="relative">
                                <input
                                  id="field-weightKg"
                                  type="text"
                                  inputMode="decimal"
                                  disabled={isReadOnly}
                                  placeholder="0.0"
                                  value={formValues.weightKg}
                                  onChange={(e) =>
                                    handleDecimalChange(
                                      'weightKg',
                                      e.target.value
                                    )
                                  }
                                  className="w-full h-12 pl-3.5 pr-12 rounded-xl border border-slate-300 bg-white text-[#0B192C] tabular-nums text-base sm:text-sm font-semibold focus:outline-none focus:border-[#00B4D8] focus:ring-2 focus:ring-[#00B4D8]/20 disabled:bg-slate-100"
                                />
                                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#0284C7] pointer-events-none">
                                  kg
                                </span>
                              </div>
                            </div>
                            </div>
                          </fieldset>
                        </section>
                      )}

                      {/* SECTION 3: PENÇE KUVVETİ (kg) */}
                      {showSection(3) && (
                        <section
                          id="section-3"
                          aria-labelledby="section-pence-kuvveti"
                          onFocusCapture={() => {
                            if (!isReadOnly && !isSectionLockedByOther(3)) {
                              requestCategoryLock(3);
                            }
                          }}
                          className={`scroll-mt-20 ${
                            !isReadOnly && isSectionLockedByOther(3)
                              ? 'opacity-75'
                              : ''
                          }`}
                        >
                          <div className="bg-[#0F294A] text-white px-4 py-2.5 rounded-t-xl border-b-2 border-[#00B4D8] flex flex-wrap items-center justify-between gap-2">
                            <h2
                              id="section-pence-kuvveti"
                              className="text-sm sm:text-base font-bold tracking-wide"
                            >
                              3. Pençe Kuvveti (kg)
                            </h2>
                            {renderSectionLockBadge(3, 'Sağ / Sol El')}
                          </div>

                          <fieldset
                            disabled={isReadOnly || isSectionLockedByOther(3)}
                            className="border border-t-0 border-slate-300 rounded-b-xl p-4 sm:p-5 bg-[#F0F6FC]/70 disabled:cursor-not-allowed"
                          >
                            {renderSectionLockAlert(3)}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                              <label
                                htmlFor="field-gripRightKg"
                                className="block text-xs font-semibold text-slate-700 mb-1.5"
                              >
                                Sağ
                              </label>
                              <div className="relative">
                                <input
                                  id="field-gripRightKg"
                                  type="text"
                                  inputMode="decimal"
                                  disabled={isReadOnly}
                                  placeholder="0.0"
                                  value={formValues.gripRightKg}
                                  onChange={(e) =>
                                    handleDecimalChange(
                                      'gripRightKg',
                                      e.target.value
                                    )
                                  }
                                  className="w-full h-12 pl-3.5 pr-12 rounded-xl border border-slate-300 bg-white text-[#0B192C] tabular-nums text-base sm:text-sm font-semibold focus:outline-none focus:border-[#00B4D8] focus:ring-2 focus:ring-[#00B4D8]/20 disabled:bg-slate-100"
                                />
                                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#0284C7] pointer-events-none">
                                  kg
                                </span>
                              </div>
                            </div>

                            <div>
                              <label
                                htmlFor="field-gripLeftKg"
                                className="block text-xs font-semibold text-slate-700 mb-1.5"
                              >
                                Sol
                              </label>
                              <div className="relative">
                                <input
                                  id="field-gripLeftKg"
                                  type="text"
                                  inputMode="decimal"
                                  disabled={isReadOnly}
                                  placeholder="0.0"
                                  value={formValues.gripLeftKg}
                                  onChange={(e) =>
                                    handleDecimalChange(
                                      'gripLeftKg',
                                      e.target.value
                                    )
                                  }
                                  className="w-full h-12 pl-3.5 pr-12 rounded-xl border border-slate-300 bg-white text-[#0B192C] tabular-nums text-base sm:text-sm font-semibold focus:outline-none focus:border-[#00B4D8] focus:ring-2 focus:ring-[#00B4D8]/20 disabled:bg-slate-100"
                                />
                                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#0284C7] pointer-events-none">
                                  kg
                                </span>
                              </div>
                            </div>
                            </div>
                          </fieldset>
                        </section>
                      )}
                    </div>
                  )}

                  {/* SECTION 4: FLAMİNGO DENGE (sn) */}
                  {showSection(4) && (
                    <section
                      id="section-4"
                      aria-labelledby="section-flamingo-denge"
                      onFocusCapture={() => {
                        if (!isReadOnly && !isSectionLockedByOther(4)) {
                          requestCategoryLock(4);
                        }
                      }}
                      className={`scroll-mt-20 ${
                        !isReadOnly && isSectionLockedByOther(4)
                          ? 'opacity-75'
                          : ''
                      }`}
                    >
                      <div className="bg-[#0F294A] text-white px-4 py-2.5 rounded-t-xl border-b-2 border-[#00B4D8] flex flex-wrap items-center justify-between gap-2">
                        <h2
                          id="section-flamingo-denge"
                          className="text-sm sm:text-base font-bold tracking-wide"
                        >
                          4. Flamingo Denge (sn)
                        </h2>
                        {renderSectionLockBadge(4, '1. ve 2. Deneme Değerleri')}
                      </div>

                      <fieldset
                        disabled={isReadOnly || isSectionLockedByOther(4)}
                        className="border border-t-0 border-slate-300 rounded-b-xl overflow-hidden bg-white disabled:cursor-not-allowed"
                      >
                        {renderSectionLockAlert(4) && (
                          <div className="p-3 pb-0">
                            {renderSectionLockAlert(4)}
                          </div>
                        )}
                        <div className="grid grid-cols-12 bg-[#E2EEF8] border-b border-slate-300 px-3 sm:px-4 py-2.5 text-xs font-bold text-[#0B192C]">
                          <div className="col-span-2 sm:col-span-4">Yön</div>
                          <div className="col-span-5 sm:col-span-4">
                            1. Deneme
                          </div>
                          <div className="col-span-5 sm:col-span-4">
                            2. Deneme
                          </div>
                        </div>

                        {/* Sağ Row */}
                        <div className="grid grid-cols-12 items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 border-b border-slate-200 bg-[#F0F6FC]/50">
                          <div className="col-span-2 sm:col-span-4 text-sm font-bold text-[#0B192C]">
                            Sağ
                          </div>
                          <div className="col-span-5 sm:col-span-4">
                            <div className="relative">
                              <input
                                aria-label="Flamingo Denge Sağ 1. Deneme"
                                type="text"
                                inputMode="decimal"
                                disabled={isReadOnly}
                                placeholder="1. Deneme"
                                value={formValues.flamingoRight1}
                                onChange={(e) =>
                                  handleDecimalChange(
                                    'flamingoRight1',
                                    e.target.value
                                  )
                                }
                                className="w-full h-12 pl-3 pr-9 rounded-xl border border-slate-300 bg-white text-[#0B192C] tabular-nums text-base sm:text-sm font-semibold focus:outline-none focus:border-[#00B4D8] focus:ring-2 focus:ring-[#00B4D8]/20 disabled:bg-slate-100"
                              />
                              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#0284C7] pointer-events-none">
                                sn
                              </span>
                            </div>
                          </div>
                          <div className="col-span-5 sm:col-span-4">
                            <div className="relative">
                              <input
                                aria-label="Flamingo Denge Sağ 2. Deneme"
                                type="text"
                                inputMode="decimal"
                                disabled={isReadOnly}
                                placeholder="2. Deneme"
                                value={formValues.flamingoRight2}
                                onChange={(e) =>
                                  handleDecimalChange(
                                    'flamingoRight2',
                                    e.target.value
                                  )
                                }
                                className="w-full h-12 pl-3 pr-9 rounded-xl border border-slate-300 bg-white text-[#0B192C] tabular-nums text-base sm:text-sm font-semibold focus:outline-none focus:border-[#00B4D8] focus:ring-2 focus:ring-[#00B4D8]/20 disabled:bg-slate-100"
                              />
                              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#0284C7] pointer-events-none">
                                sn
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Sol Row */}
                        <div className="grid grid-cols-12 items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 bg-white">
                          <div className="col-span-2 sm:col-span-4 text-sm font-bold text-[#0B192C]">
                            Sol
                          </div>
                          <div className="col-span-5 sm:col-span-4">
                            <div className="relative">
                              <input
                                aria-label="Flamingo Denge Sol 1. Deneme"
                                type="text"
                                inputMode="decimal"
                                disabled={isReadOnly}
                                placeholder="1. Deneme"
                                value={formValues.flamingoLeft1}
                                onChange={(e) =>
                                  handleDecimalChange(
                                    'flamingoLeft1',
                                    e.target.value
                                  )
                                }
                                className="w-full h-12 pl-3 pr-9 rounded-xl border border-slate-300 bg-white text-[#0B192C] tabular-nums text-base sm:text-sm font-semibold focus:outline-none focus:border-[#00B4D8] focus:ring-2 focus:ring-[#00B4D8]/20 disabled:bg-slate-100"
                              />
                              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#0284C7] pointer-events-none">
                                sn
                              </span>
                            </div>
                          </div>
                          <div className="col-span-5 sm:col-span-4">
                            <div className="relative">
                              <input
                                aria-label="Flamingo Denge Sol 2. Deneme"
                                type="text"
                                inputMode="decimal"
                                disabled={isReadOnly}
                                placeholder="2. Deneme"
                                value={formValues.flamingoLeft2}
                                onChange={(e) =>
                                  handleDecimalChange(
                                    'flamingoLeft2',
                                    e.target.value
                                  )
                                }
                                className="w-full h-12 pl-3 pr-9 rounded-xl border border-slate-300 bg-white text-[#0B192C] tabular-nums text-base sm:text-sm font-semibold focus:outline-none focus:border-[#00B4D8] focus:ring-2 focus:ring-[#00B4D8]/20 disabled:bg-slate-100"
                              />
                              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#0284C7] pointer-events-none">
                                sn
                              </span>
                            </div>
                          </div>
                        </div>
                      </fieldset>
                    </section>
                  )}

                  {/* SECTION 5: PERFORMANS TESTLERİ */}
                  {showSection(5) && (
                    <section
                      id="section-5"
                      aria-labelledby="section-performans-testleri"
                      onFocusCapture={() => {
                        if (!isReadOnly && !isSectionLockedByOther(5)) {
                          requestCategoryLock(5);
                        }
                      }}
                      className={`scroll-mt-20 ${
                        !isReadOnly && isSectionLockedByOther(5)
                          ? 'opacity-75'
                          : ''
                      }`}
                    >
                      <div className="bg-[#0F294A] text-white px-4 py-2.5 rounded-t-xl border-b-2 border-[#00B4D8] flex flex-wrap items-center justify-between gap-2">
                        <h2
                          id="section-performans-testleri"
                          className="text-sm sm:text-base font-bold tracking-wide"
                        >
                          5. Performans Testleri
                        </h2>
                        {renderSectionLockBadge(
                          5,
                          'Sürat, Esneklik, Sıçrama ve Reaksiyon'
                        )}
                      </div>

                      <fieldset
                        disabled={isReadOnly || isSectionLockedByOther(5)}
                        className="border border-t-0 border-slate-300 rounded-b-xl p-4 sm:p-5 bg-[#F0F6FC]/70 disabled:cursor-not-allowed"
                      >
                        {renderSectionLockAlert(5)}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 print-compact-gap">
                        {[
                          {
                            key: 'sprint20m' as const,
                            label: '20M Sprint (sn)',
                            unit: 'sn',
                          },
                          {
                            key: 'sitAndReachCm' as const,
                            label: 'Esneklik Otur Eriş (cm)',
                            unit: 'cm',
                          },
                          {
                            key: 'armSpeedRightSec' as const,
                            label: 'Kol Sürat Sağ (sn)',
                            unit: 'sn',
                          },
                          {
                            key: 'armSpeedLeftSec' as const,
                            label: 'Kol Sürat Sol (sn)',
                            unit: 'sn',
                          },
                          {
                            key: 'standingLongJumpCm' as const,
                            label: 'Durarak Uzun Atlama (cm)',
                            unit: 'cm',
                          },
                          {
                            key: 'shuttleRun10x5Sec' as const,
                            label: '10x5 Sürat (sn)',
                            unit: 'sn',
                          },
                          {
                            key: 'verticalJumpCm' as const,
                            label: 'Dikey Sıçrama (cm)',
                            unit: 'cm',
                          },
                          {
                            key: 'reactionTestSec' as const,
                            label: 'Reaksiyon Testi (sn)',
                            unit: 'sn',
                          },
                        ].map((item) => (
                          <div key={item.key}>
                            <label
                              htmlFor={`field-${item.key}`}
                              className="block text-xs font-semibold text-slate-700 mb-1.5"
                            >
                              {item.label}
                            </label>
                            <div className="relative">
                              <input
                                id={`field-${item.key}`}
                                type="text"
                                inputMode="decimal"
                                disabled={isReadOnly}
                                placeholder="0.00"
                                value={formValues[item.key]}
                                onChange={(e) =>
                                  handleDecimalChange(item.key, e.target.value)
                                }
                                className="w-full h-12 pl-3.5 pr-11 rounded-xl border border-slate-300 bg-white text-[#0B192C] tabular-nums text-base sm:text-sm font-semibold focus:outline-none focus:border-[#00B4D8] focus:ring-2 focus:ring-[#00B4D8]/20 disabled:bg-slate-100"
                              />
                              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#0284C7] pointer-events-none">
                                {item.unit}
                              </span>
                            </div>
                          </div>
                        ))}
                        </div>
                      </fieldset>
                    </section>
                  )}

                  {/* SECTION 6: DERİ KIVRIM KALINLIKLARI (mm) */}
                  {showSection(6) && (
                    <section
                      id="section-6"
                      aria-labelledby="section-deri-kivrim"
                      onFocusCapture={() => {
                        if (!isReadOnly && !isSectionLockedByOther(6)) {
                          requestCategoryLock(6);
                        }
                      }}
                      className={`scroll-mt-20 ${
                        !isReadOnly && isSectionLockedByOther(6)
                          ? 'opacity-75'
                          : ''
                      }`}
                    >
                      <div className="bg-[#0F294A] text-white px-4 py-2.5 rounded-t-xl border-b-2 border-[#00B4D8] flex flex-wrap items-center justify-between gap-2">
                        <h2
                          id="section-deri-kivrim"
                          className="text-sm sm:text-base font-bold tracking-wide"
                        >
                          6. Deri Kıvrım Kalınlıkları (mm)
                        </h2>
                        {renderSectionLockBadge(6, 'Skinfold Ölçümleri')}
                      </div>

                      <fieldset
                        disabled={isReadOnly || isSectionLockedByOther(6)}
                        className="border border-t-0 border-slate-300 rounded-b-xl p-4 sm:p-5 bg-[#F0F6FC]/70 disabled:cursor-not-allowed"
                      >
                        {renderSectionLockAlert(6)}
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 print-compact-gap">
                        {[
                          { key: 'skinfoldTricepsMm' as const, label: 'Triceps' },
                          { key: 'skinfoldBicepsMm' as const, label: 'Biceps' },
                          { key: 'skinfoldIliacMm' as const, label: 'Iliac' },
                          { key: 'skinfoldCalfMm' as const, label: 'Calf' },
                        ].map((item) => (
                          <div key={item.key}>
                            <label
                              htmlFor={`field-${item.key}`}
                              className="block text-xs font-semibold text-slate-700 mb-1.5"
                            >
                              {item.label}
                            </label>
                            <div className="relative">
                              <input
                                id={`field-${item.key}`}
                                type="text"
                                inputMode="decimal"
                                disabled={isReadOnly}
                                placeholder="0.0"
                                value={formValues[item.key]}
                                onChange={(e) =>
                                  handleDecimalChange(item.key, e.target.value)
                                }
                                className="w-full h-12 pl-3.5 pr-12 rounded-xl border border-slate-300 bg-white text-[#0B192C] tabular-nums text-base sm:text-sm font-semibold focus:outline-none focus:border-[#00B4D8] focus:ring-2 focus:ring-[#00B4D8]/20 disabled:bg-slate-100"
                              />
                              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#0284C7] pointer-events-none">
                                mm
                              </span>
                            </div>
                          </div>
                        ))}
                        </div>
                      </fieldset>
                    </section>
                  )}

                  {/* SECTION 7: AİLE BİLGİLERİ */}
                  {showSection(7) && (
                    <section
                      id="section-7"
                      aria-labelledby="section-aile-bilgileri"
                      onFocusCapture={() => {
                        if (!isReadOnly && !isSectionLockedByOther(7)) {
                          requestCategoryLock(7);
                        }
                      }}
                      className={`scroll-mt-20 ${
                        !isReadOnly && isSectionLockedByOther(7)
                          ? 'opacity-75'
                          : ''
                      }`}
                    >
                      <div className="bg-[#0F294A] text-white px-4 py-2.5 rounded-t-xl border-b-2 border-[#00B4D8] flex flex-wrap items-center justify-between gap-2">
                        <h2
                          id="section-aile-bilgileri"
                          className="text-sm sm:text-base font-bold tracking-wide"
                        >
                          7. Aile Bilgileri
                        </h2>
                        {renderSectionLockBadge(7, 'Anne ve Baba Bilgileri')}
                      </div>

                      <fieldset
                        disabled={isReadOnly || isSectionLockedByOther(7)}
                        className="border border-t-0 border-slate-300 rounded-b-xl p-4 sm:p-5 bg-[#F0F6FC]/70 disabled:cursor-not-allowed"
                      >
                        {renderSectionLockAlert(7)}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 print-compact-gap">
                          {/* Anne */}
                          <div className="bg-white border border-slate-300 rounded-xl p-4 space-y-4">
                            <div className="border-b border-slate-200 pb-2">
                              <h3 className="text-sm font-bold text-[#0B192C]">
                                Anne
                              </h3>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label
                                  htmlFor="field-motherHeightCm"
                                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                                >
                                  Boy (cm)
                                </label>
                                <div className="relative">
                                  <input
                                    id="field-motherHeightCm"
                                    type="text"
                                    inputMode="decimal"
                                    disabled={isReadOnly}
                                    placeholder="0.0"
                                    value={formValues.motherHeightCm}
                                    onChange={(e) =>
                                      handleDecimalChange(
                                        'motherHeightCm',
                                        e.target.value
                                      )
                                    }
                                    className="w-full h-12 pl-3 pr-10 rounded-xl border border-slate-300 bg-white text-[#0B192C] tabular-nums text-base sm:text-sm font-semibold focus:outline-none focus:border-[#00B4D8] focus:ring-2 focus:ring-[#00B4D8]/20 disabled:bg-slate-100"
                                  />
                                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#0284C7] pointer-events-none">
                                    cm
                                  </span>
                                </div>
                              </div>

                              <div>
                                <label
                                  htmlFor="field-motherWeightKg"
                                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                                >
                                  Kilo (kg)
                                </label>
                                <div className="relative">
                                  <input
                                    id="field-motherWeightKg"
                                    type="text"
                                    inputMode="decimal"
                                    disabled={isReadOnly}
                                    placeholder="0.0"
                                    value={formValues.motherWeightKg}
                                    onChange={(e) =>
                                      handleDecimalChange(
                                        'motherWeightKg',
                                        e.target.value
                                      )
                                    }
                                    className="w-full h-12 pl-3 pr-10 rounded-xl border border-slate-300 bg-white text-[#0B192C] tabular-nums text-base sm:text-sm font-semibold focus:outline-none focus:border-[#00B4D8] focus:ring-2 focus:ring-[#00B4D8]/20 disabled:bg-slate-100"
                                  />
                                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#0284C7] pointer-events-none">
                                    kg
                                  </span>
                                </div>
                              </div>
                            </div>

                            <div>
                              <label
                                htmlFor="field-motherSportsHistory"
                                className="block text-xs font-semibold text-slate-700 mb-1.5"
                              >
                                Spor Geçmişi
                              </label>
                              <input
                                id="field-motherSportsHistory"
                                type="text"
                                disabled={isReadOnly}
                                placeholder="En az 1 yıl yapılan spor branşı / düzey belirtiniz"
                                value={formValues.motherSportsHistory}
                                onChange={(e) =>
                                  handleTextChange(
                                    'motherSportsHistory',
                                    e.target.value,
                                    BLUEPRINT_CONSTRAINTS.SPORTS_HISTORY_MAX_LENGTH
                                  )
                                }
                                className="w-full h-12 px-3.5 rounded-xl border border-slate-300 bg-white text-[#0B192C] text-base sm:text-sm focus:outline-none focus:border-[#00B4D8] focus:ring-2 focus:ring-[#00B4D8]/20 disabled:bg-slate-100"
                              />
                              <p className="mt-1.5 text-[11px] font-semibold text-[#0284C7]">
                                * Koşul: En az (min.) 1 yıl herhangi bir spor
                                branşı yapmış olması gerekmektedir.
                              </p>
                            </div>
                          </div>

                          {/* Baba */}
                          <div className="bg-white border border-slate-300 rounded-xl p-4 space-y-4">
                            <div className="border-b border-slate-200 pb-2">
                              <h3 className="text-sm font-bold text-[#0B192C]">
                                Baba
                              </h3>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label
                                  htmlFor="field-fatherHeightCm"
                                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                                >
                                  Boy (cm)
                                </label>
                                <div className="relative">
                                  <input
                                    id="field-fatherHeightCm"
                                    type="text"
                                    inputMode="decimal"
                                    disabled={isReadOnly}
                                    placeholder="0.0"
                                    value={formValues.fatherHeightCm}
                                    onChange={(e) =>
                                      handleDecimalChange(
                                        'fatherHeightCm',
                                        e.target.value
                                      )
                                    }
                                    className="w-full h-12 pl-3 pr-10 rounded-xl border border-slate-300 bg-white text-[#0B192C] tabular-nums text-base sm:text-sm font-semibold focus:outline-none focus:border-[#00B4D8] focus:ring-2 focus:ring-[#00B4D8]/20 disabled:bg-slate-100"
                                  />
                                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#0284C7] pointer-events-none">
                                    cm
                                  </span>
                                </div>
                              </div>

                              <div>
                                <label
                                  htmlFor="field-fatherWeightKg"
                                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                                >
                                  Kilo (kg)
                                </label>
                                <div className="relative">
                                  <input
                                    id="field-fatherWeightKg"
                                    type="text"
                                    inputMode="decimal"
                                    disabled={isReadOnly}
                                    placeholder="0.0"
                                    value={formValues.fatherWeightKg}
                                    onChange={(e) =>
                                      handleDecimalChange(
                                        'fatherWeightKg',
                                        e.target.value
                                      )
                                    }
                                    className="w-full h-12 pl-3 pr-10 rounded-xl border border-slate-300 bg-white text-[#0B192C] tabular-nums text-base sm:text-sm font-semibold focus:outline-none focus:border-[#00B4D8] focus:ring-2 focus:ring-[#00B4D8]/20 disabled:bg-slate-100"
                                  />
                                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#0284C7] pointer-events-none">
                                    kg
                                  </span>
                                </div>
                              </div>
                            </div>

                            <div>
                              <label
                                htmlFor="field-fatherSportsHistory"
                                className="block text-xs font-semibold text-slate-700 mb-1.5"
                              >
                                Spor Geçmişi
                              </label>
                              <input
                                id="field-fatherSportsHistory"
                                type="text"
                                disabled={isReadOnly}
                                placeholder="En az 1 yıl yapılan spor branşı / düzey belirtiniz"
                                value={formValues.fatherSportsHistory}
                                onChange={(e) =>
                                  handleTextChange(
                                    'fatherSportsHistory',
                                    e.target.value,
                                    BLUEPRINT_CONSTRAINTS.SPORTS_HISTORY_MAX_LENGTH
                                  )
                                }
                                className="w-full h-12 px-3.5 rounded-xl border border-slate-300 bg-white text-[#0B192C] text-base sm:text-sm focus:outline-none focus:border-[#00B4D8] focus:ring-2 focus:ring-[#00B4D8]/20 disabled:bg-slate-100"
                              />
                              <p className="mt-1.5 text-[11px] font-semibold text-[#0284C7]">
                                * Koşul: En az (min.) 1 yıl herhangi bir spor
                                branşı yapmış olması gerekmektedir.
                              </p>
                            </div>
                          </div>
                        </div>
                      </fieldset>
                    </section>
                  )}

                  {/* Stepper Navigation Buttons when in Mobil Hızlı Giriş (Step) Mode */}
                  {!isReadOnly && entryLayoutMode === 'step' && (
                    <div className="no-print flex items-center justify-between gap-3 pt-2 border-t border-slate-200">
                      <button
                        type="button"
                        disabled={activeStepSection <= 1}
                        onClick={() =>
                          setActiveStepSection((prev) => Math.max(1, prev - 1))
                        }
                        className="min-h-[46px] px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-sm font-semibold text-[#0B192C] inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <ChevronLeft className="w-4 h-4" />
                        Önceki Bölüm
                      </button>

                      <span className="text-xs font-bold tabular-nums text-slate-500">
                        Bölüm {activeStepSection} / 7
                      </span>

                      {activeStepSection < 7 ? (
                        <button
                          type="button"
                          onClick={() =>
                            setActiveStepSection((prev) => Math.min(7, prev + 1))
                          }
                          className="min-h-[46px] px-5 py-2.5 rounded-xl bg-[#0B192C] hover:bg-[#0F294A] text-sm font-semibold text-white inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          Sonraki Bölüm
                          <ChevronRight className="w-4 h-4 text-[#38BDF8]" />
                        </button>
                      ) : (
                        <button
                          type="submit"
                          disabled={isSaving}
                          className="min-h-[46px] px-5 py-2.5 rounded-xl bg-[#0284C7] hover:bg-[#0369A1] text-sm font-semibold text-white inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <Save className="w-4 h-4" />
                          Formu Kaydet
                        </button>
                      )}
                    </div>
                  )}

                  {/* Bottom Form Action Bar (All uniform h-10 rounded-xl) */}
                  <div className="no-print pt-4 border-t border-slate-200 flex flex-wrap items-center justify-end gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {!isReadOnly && (
                        <>
                          <button
                            type="button"
                            onClick={() => setConfirmClearOpen(true)}
                            className="h-10 inline-flex items-center justify-center gap-1.5 px-3.5 text-xs sm:text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <RotateCcw className="w-4 h-4 shrink-0" />
                            <span>Formu Temizle</span>
                          </button>

                          <button
                            type="button"
                            disabled={isSaving}
                            onClick={() => performSaveRecord(true)}
                            className="h-10 inline-flex items-center justify-center gap-1.5 px-3.5 text-xs sm:text-sm font-semibold text-[#0B192C] bg-[#E2EEF8] hover:bg-[#00B4D8]/30 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <Plus className="w-4 h-4 text-[#0284C7] shrink-0" />
                            <span>Kaydet ve Yeni Sporcuya Geç</span>
                          </button>

                          <button
                            type="submit"
                            disabled={isSaving}
                            className="h-10 inline-flex items-center justify-center gap-1.5 px-5 text-xs sm:text-sm font-semibold text-white bg-[#0284C7] hover:bg-[#0369A1] disabled:opacity-60 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <Save className="w-4 h-4 shrink-0" />
                            <span>
                              {isSaving
                                ? 'Kaydediliyor...'
                                : editingRecordId
                                  ? 'Değişiklikleri Kaydet'
                                  : 'Formu Kaydet'}
                            </span>
                          </button>
                        </>
                      )}

                      <button
                        type="button"
                        onClick={() => handlePrintRecord()}
                        className="h-10 inline-flex items-center justify-center gap-1.5 px-3.5 text-xs sm:text-sm font-semibold text-[#0B192C] bg-white border border-slate-300 hover:bg-slate-50 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Printer className="w-4 h-4 shrink-0" />
                        <span>Yazdır</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => downloadPerformanceTestPdf(formValues)}
                        className="h-10 inline-flex items-center justify-center gap-1.5 px-3.5 text-xs sm:text-sm font-semibold text-white bg-[#0B192C] hover:bg-[#0F294A] rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Download className="w-4 h-4 shrink-0" />
                        <span>PDF</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => exportSingleTestToExcel(formValues)}
                        className="h-10 inline-flex items-center justify-center gap-1.5 px-3.5 text-xs sm:text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Download className="w-4 h-4 shrink-0" />
                        <span>Excel</span>
                      </button>
                    </div>
                  </div>

                  {/* Sheet Footer Branding (Print Only so screen has only 1 Powered By in the main footer) */}
                  <div className="hidden print:flex pt-3 border-t border-slate-200/80 flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                    <span>ROTA Performans – Dijital Performans Test Formu</span>
                    <span className="font-semibold text-[#0B192C]">
                      Powered by{' '}
                      <span className="text-[#0284C7]">
                        Sporsepeti Bilişim Teknolojileri
                      </span>
                    </span>
                  </div>
                </div>
              </form>
            </div>
          )}

          {/* SPOR KULÜPLERİ VE SPORCU YÖNETİMİ EKRANI */}
          {activeTab === 'clubs' && (
            <div className="no-print space-y-4">
              {/* SPOR KULÜPLERİ */}
              <section className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
                  <h1 className="text-base sm:text-lg font-bold text-[#0B192C]">
                    Spor Kulüpleri
                  </h1>

                  <button
                    type="button"
                    onClick={() => setShowAddClubForm((prev) => !prev)}
                    className="min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-2 text-xs sm:text-sm font-semibold text-white bg-[#0284C7] hover:bg-[#0369A1] rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Building2 className="w-4 h-4" />
                    {showAddClubForm ? 'Kapat' : '+ Kulüp Ekle'}
                  </button>
                </div>

                {/* Collapsible Form: Yeni Spor Kulübü Ekle */}
                {showAddClubForm && (
                  <form
                    onSubmit={handleAddSportsClub}
                    className="bg-[#F0F6FC] border border-[#00B4D8]/40 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-12 gap-3 items-end"
                  >
                    <div className="sm:col-span-5">
                      <label
                        htmlFor="new-club-name"
                        className="block text-xs font-semibold text-[#0B192C] mb-1"
                      >
                        Spor Kulübü Adı
                      </label>
                      <input
                        id="new-club-name"
                        type="text"
                        placeholder="Örn: Karşıyaka Akademi SK"
                        value={newClubName}
                        onChange={(e) => setNewClubName(e.target.value)}
                        className="w-full h-12 px-3.5 rounded-xl border border-slate-300 bg-white text-base sm:text-sm font-semibold text-[#0B192C] focus:outline-none focus:border-[#00B4D8]"
                      />
                    </div>

                    <div className="sm:col-span-4">
                      <label
                        htmlFor="new-club-branch"
                        className="block text-xs font-semibold text-[#0B192C] mb-1"
                      >
                        Branş / Yaş Grubu (İsteğe Bağlı)
                      </label>
                      <input
                        id="new-club-branch"
                        type="text"
                        placeholder="Örn: U14 Futbol / Basketbol"
                        value={newClubBranch}
                        onChange={(e) => setNewClubBranch(e.target.value)}
                        className="w-full h-12 px-3.5 rounded-xl border border-slate-300 bg-white text-base sm:text-sm text-[#0B192C] focus:outline-none focus:border-[#00B4D8]"
                      />
                    </div>

                    <div className="sm:col-span-3 flex items-center gap-2">
                      <button
                        type="submit"
                        className="w-full h-12 px-4 rounded-xl bg-[#0B192C] hover:bg-[#0F294A] text-white text-sm font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Plus className="w-4 h-4 text-[#38BDF8]" />
                        Kulübü Kaydet
                      </button>
                    </div>
                  </form>
                )}

                {/* Sports Club Selector Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {clubsSummary.map((club) => {
                    const isSelected = selectedClubView === club.clubName;
                    return (
                      <button
                        key={club.clubName}
                        type="button"
                        onClick={() => {
                          setSelectedClubView(club.clubName);
                          setNewAthleteClubName(club.clubName);
                        }}
                        className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-[#0B192C] text-white border-[#00B4D8] ring-2 ring-[#00B4D8]/30'
                            : 'bg-[#F0F6FC]/60 text-[#0B192C] border-slate-200 hover:border-[#00B4D8] hover:bg-white'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`text-xs font-semibold truncate ${
                              isSelected ? 'text-[#38BDF8]' : 'text-[#0284C7]'
                            }`}
                          >
                            {club.branch || 'Spor Kulübü'}
                          </span>
                          <Building2 className="w-4 h-4 text-[#00B4D8] shrink-0" />
                        </div>
                        <div className="text-base font-bold mt-1 truncate">
                          {club.clubName}
                        </div>
                        <div
                          className={`text-xs mt-2 tabular-nums ${
                            isSelected ? 'text-slate-300' : 'text-slate-500'
                          }`}
                        >
                          {club.uniqueAthleteKeys.size} Sporcu ·{' '}
                          {club.records.length} Test Formu
                        </div>
                      </button>
                    );
                  })}

                  <button
                    type="button"
                    onClick={() => setSelectedClubView('ALL')}
                    className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                      selectedClubView === 'ALL'
                        ? 'bg-[#0B192C] text-white border-[#00B4D8]'
                        : 'bg-white text-[#0B192C] border-slate-200 hover:border-[#00B4D8]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`text-xs font-semibold ${
                          selectedClubView === 'ALL'
                            ? 'text-[#38BDF8]'
                            : 'text-slate-500'
                        }`}
                      >
                        Genel Liste
                      </span>
                      <Layers className="w-4 h-4 text-[#00B4D8]" />
                    </div>
                    <div className="text-base font-bold mt-1 truncate">
                      Tüm Spor Kulüpleri
                    </div>
                    <div
                      className={`text-xs mt-2 tabular-nums ${
                        selectedClubView === 'ALL'
                          ? 'text-slate-300'
                          : 'text-slate-500'
                      }`}
                    >
                      Toplam {allRecords.length} Test Kaydı
                    </div>
                  </button>
                </div>
              </section>

              {/* SEÇİLİ KULÜBE SPORCU EKLE VE ÖLÇÜM BAŞLAT */}
              <section className="bg-white border border-slate-200 rounded-2xl p-4 space-y-4">
                <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                  <h2 className="text-base font-bold text-[#0B192C]">
                    {selectedClubView !== 'ALL'
                      ? `${selectedClubView} – Sporcular`
                      : 'Kulübe Sporcu Ekle'}
                  </h2>

                  {selectedClubView !== 'ALL' && (
                    <span className="text-xs tabular-nums text-slate-500">
                      {activeClubSummary?.rosterAthletes.length || 0} Sporcu
                    </span>
                  )}
                </div>

                {/* Add Athlete to Club Form */}
                <form
                  onSubmit={handleAddAthleteToClub}
                  className="bg-[#F0F6FC] border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-12 gap-3 items-end"
                >
                  {selectedClubView === 'ALL' && (
                    <div className="sm:col-span-3">
                      <label
                        htmlFor="athlete-club-select"
                        className="block text-xs font-semibold text-[#0B192C] mb-1"
                      >
                        Spor Kulübü Seçin
                      </label>
                      <select
                        id="athlete-club-select"
                        value={newAthleteClubName || knownClubNames[0] || ''}
                        onChange={(e) => setNewAthleteClubName(e.target.value)}
                        className="w-full h-12 px-3 rounded-xl border border-slate-300 bg-white text-base sm:text-sm font-semibold text-[#0B192C] focus:outline-none focus:border-[#00B4D8]"
                      >
                        {knownClubNames.map((cName) => (
                          <option key={cName} value={cName}>
                            {cName}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div
                    className={
                      selectedClubView === 'ALL'
                        ? 'sm:col-span-4'
                        : 'sm:col-span-5'
                    }
                  >
                    <label
                      htmlFor="new-athlete-name"
                      className="block text-xs font-semibold text-[#0B192C] mb-1"
                    >
                      Sporcu Adı Soyadı
                    </label>
                    <input
                      id="new-athlete-name"
                      type="text"
                      placeholder="Örn: Arda Güler"
                      value={newAthleteName}
                      onChange={(e) => setNewAthleteName(e.target.value)}
                      className="w-full h-12 px-3.5 rounded-xl border border-slate-300 bg-white text-base sm:text-sm font-semibold text-[#0B192C] focus:outline-none focus:border-[#00B4D8]"
                    />
                  </div>

                  <div
                    className={
                      selectedClubView === 'ALL'
                        ? 'sm:col-span-2'
                        : 'sm:col-span-4'
                    }
                  >
                    <label
                      htmlFor="new-athlete-birthdate"
                      className="block text-xs font-semibold text-[#0B192C] mb-1"
                    >
                      Doğum Tarihi
                    </label>
                    <input
                      id="new-athlete-birthdate"
                      type="date"
                      value={newAthleteBirthDate}
                      onChange={(e) => setNewAthleteBirthDate(e.target.value)}
                      className="w-full h-12 px-3 rounded-xl border border-slate-300 bg-white tabular-nums text-base sm:text-sm text-[#0B192C] focus:outline-none focus:border-[#00B4D8]"
                    />
                  </div>

                  <div className="sm:col-span-3">
                    <button
                      type="submit"
                      className="w-full h-12 px-4 rounded-xl bg-[#0284C7] hover:bg-[#0369A1] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
                    >
                      <UserPlus className="w-4 h-4" />
                      Kulübe Sporcu Ekle
                    </button>
                  </div>
                </form>

                {/* Club Roster Athletes List with 1-Click "Ölçüm Gir / Test Başlat" */}
                {activeClubSummary &&
                activeClubSummary.rosterAthletes.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {activeClubSummary.rosterAthletes.map((ath) => {
                      const athleteTests = activeClubSummary.records.filter(
                        (r) =>
                          r.athleteName.trim().toLocaleLowerCase('tr-TR') ===
                          ath.athleteName.trim().toLocaleLowerCase('tr-TR')
                      );
                      const lastTest = athleteTests[0];

                      return (
                        <div
                          key={ath.id}
                          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl border border-slate-200 bg-white hover:border-[#00B4D8] transition-colors"
                        >
                          <div className="min-w-0">
                            <div className="text-sm sm:text-base font-bold text-[#0B192C] truncate">
                              {ath.athleteName}
                            </div>
                            <div className="text-xs text-slate-500 tabular-nums mt-0.5">
                              D.T: {formatTurkishDate(ath.birthDate)} ·{' '}
                              {athleteTests.length} Test Kaydı
                              {lastTest
                                ? ` (Son: ${formatTurkishDate(lastTest.testDate)})`
                                : ''}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() =>
                                handleStartTestForAthlete(
                                  ath.sportsClub,
                                  ath.athleteName,
                                  ath.birthDate
                                )
                              }
                              className="min-h-[42px] px-3.5 py-2 rounded-xl bg-[#0B192C] hover:bg-[#0F294A] text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                            >
                              <Play className="w-3.5 h-3.5 text-[#38BDF8]" />
                              Ölçüm Gir / Test Başlat
                            </button>

                            <button
                              type="button"
                              onClick={() => setAthleteToDelete(ath)}
                              title="Sporcuyu Kadrodan Kaldır"
                              className="min-h-[42px] min-w-[42px] flex items-center justify-center rounded-xl bg-red-50 hover:bg-red-100 text-red-700 transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
                    Kayıtlı sporcu bulunmuyor.
                  </div>
                )}
              </section>

              {/* KULÜBÜN KAYITLI TEST FORMLARI */}
              <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="p-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <h2 className="text-base font-bold text-[#0B192C] flex items-center gap-2">
                    <ClipboardList className="w-4 h-4 text-[#0284C7]" />
                    <span>
                      {selectedClubView === 'ALL'
                        ? 'Tüm Test Formları'
                        : `${selectedClubView} – Test Formları`}
                    </span>
                    <span className="text-xs tabular-nums text-slate-500">
                      ({clubViewRecords.length})
                    </span>
                  </h2>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={clubViewRecords.length === 0}
                      onClick={() =>
                        exportMultipleTestsToExcel(
                          clubViewRecords,
                          selectedClubView === 'ALL'
                            ? 'Tum_Kulupler'
                            : selectedClubView,
                          activeClubSummary?.rosterAthletes || allAthletes
                        )
                      }
                      className="h-8 px-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Excel</span>
                    </button>

                    <div className="relative w-full sm:w-64">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        placeholder="Sporcu ara..."
                        value={clubSearchQuery}
                        onChange={(e) => setClubSearchQuery(e.target.value)}
                        className="w-full h-11 pl-10 pr-4 rounded-xl border border-slate-300 bg-white text-sm text-[#0B192C] focus:outline-none focus:border-[#00B4D8]"
                      />
                    </div>
                  </div>
                </div>

                {clubViewRecords.length === 0 ? (
                  <div className="p-8 text-center text-sm font-medium text-slate-500">
                    Kayıtlı test formu bulunmuyor.
                  </div>
                ) : (
                  <>
                    {/* Mobile Card List (< md) */}
                    <div className="md:hidden divide-y divide-slate-200">
                      {clubViewRecords.map((record) => (
                        <div key={record.id} className="p-4 space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-base font-bold text-[#0B192C] truncate">
                                {record.athleteName}
                              </div>
                              <div className="text-xs text-[#0284C7] font-semibold mt-0.5 truncate">
                                {record.sportsClub || UNASSIGNED_CLUB_LABEL}
                              </div>
                            </div>
                            <div className="text-right tabular-nums text-xs text-slate-600 shrink-0">
                              <div>Test: {formatTurkishDate(record.testDate)}</div>
                              <div className="text-slate-400">
                                D.T: {formatTurkishDate(record.birthDate)}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 pt-1">
                            <button
                              type="button"
                              onClick={() => handleViewRecord(record)}
                              className="flex-1 h-9 px-2.5 inline-flex items-center justify-center gap-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-[#0B192C] text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
                            >
                              <Eye className="w-3.5 h-3.5 shrink-0" />
                              <span>Aç</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleEditRecord(record)}
                              className="flex-1 h-9 px-2.5 inline-flex items-center justify-center gap-1 rounded-lg bg-[#0284C7] hover:bg-[#0369A1] text-white text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
                            >
                              <Edit3 className="w-3.5 h-3.5 shrink-0" />
                              <span>Düzenle</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => exportSingleTestToExcel(record)}
                              className="flex-1 h-9 px-2.5 inline-flex items-center justify-center gap-1 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
                            >
                              <Download className="w-3.5 h-3.5 shrink-0" />
                              <span>Excel</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handlePrintRecord(record)}
                              title="Yazdır"
                              aria-label="Yazdır"
                              className="h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-[#0B192C] text-xs font-semibold transition-colors cursor-pointer"
                            >
                              <Printer className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setRecordToDelete(record)}
                              title="Sil"
                              aria-label="Sil"
                              className="h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-lg bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Desktop Table (md+) */}
                    <div className="hidden md:block overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-[#0B192C] text-white text-xs font-semibold border-b-2 border-[#00B4D8]">
                            <th className="py-3.5 px-5">Sporcu Adı Soyadı</th>
                            <th className="py-3.5 px-5">Spor Kulübü</th>
                            <th className="py-3.5 px-5">Doğum Tarihi</th>
                            <th className="py-3.5 px-5">Test Tarihi</th>
                            <th className="py-3.5 px-5 text-right">İşlemler</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 text-sm">
                          {clubViewRecords.map((record) => (
                            <tr
                              key={record.id}
                              className="hover:bg-[#F0F6FC] transition-colors"
                            >
                              <td className="py-3.5 px-5 font-semibold text-[#0B192C]">
                                {record.athleteName}
                              </td>
                              <td className="py-3.5 px-5 text-[#0284C7] font-medium">
                                {record.sportsClub || UNASSIGNED_CLUB_LABEL}
                              </td>
                              <td className="py-3.5 px-5 tabular-nums text-slate-600">
                                {formatTurkishDate(record.birthDate)}
                              </td>
                              <td className="py-3.5 px-5 tabular-nums font-medium text-[#0B192C]">
                                {formatTurkishDate(record.testDate)}
                              </td>
                              <td className="py-3.5 px-5">
                                <div className="flex items-center justify-end gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => handleViewRecord(record)}
                                    className="h-8 inline-flex items-center justify-center gap-1 px-2.5 text-xs font-semibold text-[#0B192C] bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                                  >
                                    <Eye className="w-3.5 h-3.5 shrink-0" />
                                    <span>Görüntüle</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleEditRecord(record)}
                                    className="h-8 inline-flex items-center justify-center gap-1 px-2.5 text-xs font-semibold text-white bg-[#0284C7] hover:bg-[#0369A1] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                                  >
                                    <Edit3 className="w-3.5 h-3.5 shrink-0" />
                                    <span>Düzenle</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      exportSingleTestToExcel(record)
                                    }
                                    className="h-8 inline-flex items-center justify-center gap-1 px-2.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                                  >
                                    <Download className="w-3.5 h-3.5 shrink-0" />
                                    <span>Excel</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handlePrintRecord(record)}
                                    className="h-8 inline-flex items-center justify-center gap-1 px-2.5 text-xs font-semibold text-[#0B192C] bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                                  >
                                    <Printer className="w-3.5 h-3.5 shrink-0" />
                                    <span>Yazdır</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setRecordToDelete(record)}
                                    className="h-8 inline-flex items-center justify-center gap-1 px-2.5 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5 shrink-0" />
                                    <span>Sil</span>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </section>
            </div>
          )}

          {/* TÜM KAYITLI FORMLAR EKRANI */}
          {activeTab === 'records' && (
            <div className="no-print space-y-4">
              <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <h1 className="text-base sm:text-lg font-bold text-[#0B192C]">
                  Kayıtlı Test Formları ({filteredRecords.length})
                </h1>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setWebhookModalOpen(true)}
                    className="h-9 inline-flex items-center justify-center gap-1.5 px-3 text-xs font-semibold text-[#0B192C] bg-[#E2EEF8] hover:bg-[#00B4D8]/30 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Webhook className="w-3.5 h-3.5 text-[#0284C7] shrink-0" />
                    <span>Webhook</span>
                  </button>

                  <button
                    type="button"
                    disabled={filteredRecords.length === 0}
                    onClick={() =>
                      exportMultipleTestsToExcel(
                        filteredRecords,
                        searchClub || 'Filtrelenen_Veriler',
                        allAthletes
                      )
                    }
                    className="h-9 inline-flex items-center justify-center gap-1.5 px-3 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 shrink-0" />
                    <span>Excel</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleStartNewForm('')}
                    className="h-9 inline-flex items-center justify-center gap-1.5 px-3.5 text-xs font-semibold text-white bg-[#0284C7] hover:bg-[#0369A1] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5 shrink-0" />
                    <span>Yeni Form</span>
                  </button>
                </div>
              </div>

              {/* Search, Club & Date Filter Bar */}
              <div className="bg-white border border-slate-200 rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                <div className="sm:col-span-4">
                  <label
                    htmlFor="search-athlete-name"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Sporcu Adı Soyadı ile Ara
                  </label>
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="search-athlete-name"
                      type="text"
                      placeholder="Sporcu adı veya soyadı..."
                      value={searchName}
                      onChange={(e) => setSearchName(e.target.value)}
                      className="w-full h-11 pl-10 pr-4 rounded-xl border border-slate-300 bg-white text-sm text-[#0B192C] focus:outline-none focus:border-[#00B4D8]"
                    />
                  </div>
                </div>

                <div className="sm:col-span-3">
                  <label
                    htmlFor="search-sports-club"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Spor Kulübü
                  </label>
                  <select
                    id="search-sports-club"
                    value={searchClub}
                    onChange={(e) => setSearchClub(e.target.value)}
                    className="w-full h-11 px-3 rounded-xl border border-slate-300 bg-white text-sm text-[#0B192C] focus:outline-none focus:border-[#00B4D8]"
                  >
                    <option value="">Tüm Kulüpler</option>
                    {clubsSummary.map((c) => (
                      <option key={c.clubName} value={c.clubName}>
                        {c.clubName} ({c.records.length})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-3">
                  <label
                    htmlFor="search-test-date"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Test Tarihi
                  </label>
                  <div className="relative">
                    <Calendar className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="search-test-date"
                      type="date"
                      value={searchDate}
                      onChange={(e) => setSearchDate(e.target.value)}
                      className="w-full h-11 pl-10 pr-3 rounded-xl border border-slate-300 bg-white text-sm tabular-nums text-[#0B192C] focus:outline-none focus:border-[#00B4D8]"
                    />
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSearchName('');
                      setSearchDate('');
                      setSearchClub('');
                    }}
                    className="w-full h-11 px-3 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Filtreyi Temizle
                  </button>
                </div>
              </div>

              {/* Records List (Mobile Cards + Desktop Table) */}
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                {filteredRecords.length === 0 ? (
                  <div className="p-8 text-center space-y-3">
                    <div className="text-sm font-semibold text-slate-500">
                      Kayıt bulunamadı.
                    </div>
                    <button
                      type="button"
                      onClick={() => handleStartNewForm()}
                      className="min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#0284C7] hover:bg-[#0369A1] rounded-xl transition-colors cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      Yeni Form Oluştur
                    </button>
                  </div>
                ) : (
                  <>
                    {/* Mobile Cards (< md) */}
                    <div className="md:hidden divide-y divide-slate-200">
                      {filteredRecords.map((record) => (
                        <div key={record.id} className="p-4 space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-base font-bold text-[#0B192C] truncate">
                                {record.athleteName}
                              </div>
                              <div className="text-xs text-[#0284C7] font-semibold mt-0.5 truncate">
                                {record.sportsClub || UNASSIGNED_CLUB_LABEL}
                              </div>
                            </div>
                            <div className="text-right tabular-nums text-xs text-slate-600 shrink-0">
                              <div>Test: {formatTurkishDate(record.testDate)}</div>
                              <div className="text-slate-400">
                                D.T: {formatTurkishDate(record.birthDate)}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 pt-1">
                            <button
                              type="button"
                              onClick={() => handleViewRecord(record)}
                              className="flex-1 h-9 px-2.5 inline-flex items-center justify-center gap-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-[#0B192C] text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
                            >
                              <Eye className="w-3.5 h-3.5 shrink-0" />
                              <span>Aç</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleEditRecord(record)}
                              className="flex-1 h-9 px-2.5 inline-flex items-center justify-center gap-1 rounded-lg bg-[#0284C7] hover:bg-[#0369A1] text-white text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
                            >
                              <Edit3 className="w-3.5 h-3.5 shrink-0" />
                              <span>Düzenle</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => exportSingleTestToExcel(record)}
                              className="flex-1 h-9 px-2.5 inline-flex items-center justify-center gap-1 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
                            >
                              <Download className="w-3.5 h-3.5 shrink-0" />
                              <span>Excel</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handlePrintRecord(record)}
                              title="Yazdır"
                              aria-label="Yazdır"
                              className="h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-[#0B192C] text-xs font-semibold transition-colors cursor-pointer"
                            >
                              <Printer className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setRecordToDelete(record)}
                              title="Sil"
                              aria-label="Sil"
                              className="h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-lg bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Desktop Table (md+) */}
                    <div className="hidden md:block overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-[#0B192C] text-white text-xs font-semibold border-b-2 border-[#00B4D8]">
                            <th className="py-3.5 px-5">Sporcu Adı Soyadı</th>
                            <th className="py-3.5 px-5">Spor Kulübü</th>
                            <th className="py-3.5 px-5">Doğum Tarihi</th>
                            <th className="py-3.5 px-5">
                              <button
                                type="button"
                                onClick={() =>
                                  setSortDirection((prev) =>
                                    prev === 'desc' ? 'asc' : 'desc'
                                  )
                                }
                                className="inline-flex items-center gap-1 hover:text-[#38BDF8] transition-colors cursor-pointer"
                              >
                                Test Tarihi (
                                {sortDirection === 'desc'
                                  ? 'Yeni → Eski'
                                  : 'Eski → Yeni'}
                                )
                              </button>
                            </th>
                            <th className="py-3.5 px-5 text-right">İşlemler</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 text-sm">
                          {filteredRecords.map((record) => (
                            <tr
                              key={record.id}
                              className="hover:bg-[#F0F6FC] transition-colors"
                            >
                              <td className="py-3.5 px-5 font-semibold text-[#0B192C]">
                                {record.athleteName}
                              </td>
                              <td className="py-3.5 px-5 text-[#0284C7] font-medium">
                                {record.sportsClub || UNASSIGNED_CLUB_LABEL}
                              </td>
                              <td className="py-3.5 px-5 tabular-nums text-slate-600">
                                {formatTurkishDate(record.birthDate)}
                              </td>
                              <td className="py-3.5 px-5 tabular-nums font-medium text-[#0B192C]">
                                {formatTurkishDate(record.testDate)}
                              </td>
                              <td className="py-3.5 px-5">
                                <div className="flex items-center justify-end gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => handleViewRecord(record)}
                                    className="h-8 inline-flex items-center justify-center gap-1 px-2.5 text-xs font-semibold text-[#0B192C] bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                                  >
                                    <Eye className="w-3.5 h-3.5 shrink-0" />
                                    <span>Görüntüle</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleEditRecord(record)}
                                    className="h-8 inline-flex items-center justify-center gap-1 px-2.5 text-xs font-semibold text-white bg-[#0284C7] hover:bg-[#0369A1] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                                  >
                                    <Edit3 className="w-3.5 h-3.5 shrink-0" />
                                    <span>Düzenle</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      exportSingleTestToExcel(record)
                                    }
                                    className="h-8 inline-flex items-center justify-center gap-1 px-2.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                                  >
                                    <Download className="w-3.5 h-3.5 shrink-0" />
                                    <span>Excel</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handlePrintRecord(record)}
                                    className="h-8 inline-flex items-center justify-center gap-1 px-2.5 text-xs font-semibold text-[#0B192C] bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                                  >
                                    <Printer className="w-3.5 h-3.5 shrink-0" />
                                    <span>Yazdır</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setRecordToDelete(record)}
                                    className="h-8 inline-flex items-center justify-center gap-1 px-2.5 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5 shrink-0" />
                                    <span>Sil</span>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </main>

        {/* MOBILE FIXED BOTTOM THUMB-ZONE NAVIGATION BAR (< lg, Hidden on Print) */}
        <nav
          aria-label="Mobil Hızlı Menü"
          className="no-print lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200 grid grid-cols-4 items-center h-16 px-2"
        >
          <button
            type="button"
            onClick={() => setActiveTab('clubs')}
            className={`min-h-[48px] flex flex-col items-center justify-center rounded-xl transition-colors cursor-pointer ${
              activeTab === 'clubs'
                ? 'text-[#0284C7] font-bold'
                : 'text-slate-500 hover:text-[#0B192C]'
            }`}
          >
            <Building2 className="w-5 h-5" />
            <span className="text-[11px] mt-0.5">Kulüp & Sporcu</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('form')}
            className={`min-h-[48px] flex flex-col items-center justify-center rounded-xl transition-colors cursor-pointer ${
              activeTab === 'form'
                ? 'text-[#0284C7] font-bold'
                : 'text-slate-500 hover:text-[#0B192C]'
            }`}
          >
            <FileText className="w-5 h-5" />
            <span className="text-[11px] mt-0.5">Test Formu</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('records')}
            className={`min-h-[48px] flex flex-col items-center justify-center rounded-xl transition-colors cursor-pointer ${
              activeTab === 'records'
                ? 'text-[#0284C7] font-bold'
                : 'text-slate-500 hover:text-[#0B192C]'
            }`}
          >
            <FolderOpen className="w-5 h-5" />
            <span className="text-[11px] mt-0.5">
              Kayıtlar ({allRecords.length})
            </span>
          </button>

          <button
            type="button"
            onClick={() => setMobileDrawerOpen(true)}
            className="min-h-[48px] flex flex-col items-center justify-center rounded-xl text-slate-500 hover:text-[#0B192C] transition-colors cursor-pointer"
          >
            <Menu className="w-5 h-5" />
            <span className="text-[11px] mt-0.5">Menü</span>
          </button>
        </nav>

        {/* Quiet Footer (Hidden on Print) */}
        <footer className="no-print border-t border-slate-200 bg-white mt-auto pb-16 lg:pb-0">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3.5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
            <span>ROTA Performans – Dijital Performans Test Formu</span>
            <span className="font-semibold text-[#0B192C]">
              Powered by{' '}
              <span className="text-[#0284C7]">
                Sporsepeti Bilişim Teknolojileri
              </span>
            </span>
          </div>
        </footer>
      </div>

      {/* DELETE TEST RECORD CONFIRMATION MODAL */}
      {recordToDelete && (
        <div
          className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-delete-title"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 space-y-4">
            <h3
              id="modal-delete-title"
              className="text-lg font-bold text-[#0B192C]"
            >
              Test Kaydını Silmeyi Onaylıyor musunuz?
            </h3>
            <p className="text-sm text-slate-600">
              <strong className="text-[#0B192C]">
                {recordToDelete.athleteName}
              </strong>{' '}
              sporcusuna ait{' '}
              <strong className="tabular-nums text-[#0B192C]">
                {formatTurkishDate(recordToDelete.testDate)}
              </strong>{' '}
              tarihli performans test formu kalıcı olarak silinecektir.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setRecordToDelete(null)}
                className="min-h-[44px] px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="min-h-[44px] px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors cursor-pointer"
              >
                Evet, Kaydı Sil
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE ATHLETE CONFIRMATION MODAL */}
      {athleteToDelete && (
        <div
          className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-delete-athlete-title"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 space-y-4">
            <h3
              id="modal-delete-athlete-title"
              className="text-lg font-bold text-[#0B192C]"
            >
              Sporcuyu Kadrodan Kaldırmak İstiyor musunuz?
            </h3>
            <p className="text-sm text-slate-600">
              <strong className="text-[#0B192C]">
                {athleteToDelete.athleteName}
              </strong>{' '}
              sporcusu{' '}
              <strong className="text-[#0B192C]">
                {athleteToDelete.sportsClub}
              </strong>{' '}
              kulüp kadro listesinden kaldırılacaktır (mevcut test formları
              silinmez).
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setAthleteToDelete(null)}
                className="min-h-[44px] px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteAthlete}
                className="min-h-[44px] px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors cursor-pointer"
              >
                Kadrodan Kaldır
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CLEAR FORM CONFIRMATION MODAL */}
      {confirmClearOpen && (
        <div
          className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-clear-title"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 space-y-4">
            <h3
              id="modal-clear-title"
              className="text-lg font-bold text-[#0B192C]"
            >
              Formu Temizlemek İstiyor musunuz?
            </h3>
            <p className="text-sm text-slate-600">
              Form üzerindeki mevcut alanlar sıfırlanarak boş bir test formu
              açılacaktır.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmClearOpen(false)}
                className="min-h-[44px] px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={handleConfirmClearForm}
                className="min-h-[44px] px-4 py-2 text-sm font-semibold text-white bg-[#0284C7] hover:bg-[#0369A1] rounded-xl transition-colors cursor-pointer"
              >
                Formu Temizle
              </button>
            </div>
          </div>
        </div>
      )}

      {/* WEBHOOK INTEGRATION MODAL */}
      {webhookModalOpen && (
        <div
          className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 sm:p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-webhook-title"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-xl w-full p-5 sm:p-6 space-y-4 my-auto">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#0B192C] text-[#38BDF8] flex items-center justify-center shrink-0">
                  <Webhook className="w-5 h-5" />
                </div>
                <div>
                  <h3
                    id="modal-webhook-title"
                    className="text-base sm:text-lg font-bold text-[#0B192C]"
                  >
                    Webhook Otomatik Veri Aktarımı
                  </h3>
                  <p className="text-xs text-slate-500">
                    Test kaydedildiğinde verileri farklı yazılıma HTTP POST (JSON) ile otomatik iletir.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setWebhookModalOpen(false)}
                className="h-9 w-9 rounded-lg flex items-center justify-center text-slate-400 hover:text-[#0B192C] hover:bg-slate-100 cursor-pointer"
                aria-label="Kapat"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Target Webhook URL Input */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor="webhook-target-url"
                  className="text-xs font-bold text-[#0B192C]"
                >
                  Hedef Yazılım Webhook URL Adresi (POST)
                </label>
                <div className="flex items-center gap-3">
                  {webhookTargetUrl.includes('https://ais-dev-') && (
                    <button
                      type="button"
                      onClick={() =>
                        setWebhookTargetUrl((prev) =>
                          prev.replace('https://ais-dev-', 'https://ais-pre-')
                        )
                      }
                      className="text-[11px] font-bold text-amber-700 hover:underline cursor-pointer"
                    >
                      ais-pre Adresine Çevir
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setWebhookTargetUrl(DEFAULT_WEBHOOK_URL)}
                    className="text-[11px] font-semibold text-[#0284C7] hover:underline cursor-pointer"
                  >
                    Sportsfly Lab URL Sıfırla
                  </button>
                </div>
              </div>

              <input
                id="webhook-target-url"
                type="url"
                placeholder={DEFAULT_WEBHOOK_URL}
                value={webhookTargetUrl}
                onChange={(e) => setWebhookTargetUrl(e.target.value)}
                className="w-full h-11 px-3.5 rounded-xl border border-slate-300 bg-[#F0F6FC] text-xs sm:text-sm font-medium text-[#0B192C] focus:outline-none focus:border-[#0284C7] focus:bg-white"
              />

              {webhookTargetUrl.includes('https://ais-dev-') && (
                <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-300 text-[11px] text-amber-950 leading-relaxed">
                  <strong>Önemli:</strong> <code>ais-dev-</code> adresleri AI Studio oturum koruması altındadır ve dış sunucu Webhook isteklerini <code>302</code> yönlendirmesiyle engeller. Karşı uygulamayı yayınlayıp (Share) <code>ais-pre-</code> veya Cloud Run URL&apos;sini kullanın.
                </div>
              )}
            </div>

            {/* ROTA Pull API URL Box */}
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold text-[#0B192C]">
                  ROTA Performans JSON API (Karşı Yazılım Çekme Adresi - GET)
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const pullUrl = `${window.location.origin.replace('https://ais-dev-', 'https://ais-pre-')}/api/v1/tests`;
                    navigator.clipboard?.writeText(pullUrl);
                    setStatusBanner({
                      type: 'info',
                      text: 'JSON API adresi panoya kopyalandı.',
                    });
                  }}
                  className="text-[11px] font-semibold text-[#0284C7] hover:underline cursor-pointer"
                >
                  Adresi Kopyala
                </button>
              </div>
              <div className="text-[11px] text-slate-600 break-all select-all">
                {`${window.location.origin.replace('https://ais-dev-', 'https://ais-pre-')}/api/v1/tests`}
              </div>
            </div>

            {/* Auto-send Toggle */}
            <label className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[#F0F6FC] border border-slate-200 cursor-pointer">
              <div>
                <div className="text-xs sm:text-sm font-bold text-[#0B192C]">
                  Form Kaydedildiğinde Otomatik Gönder
                </div>
                <div className="text-[11px] text-slate-500">
                  Yeni test kaydedildiğinde veya güncellendiğinde anında hedef URL&apos;ye iletilir.
                </div>
              </div>
              <input
                type="checkbox"
                checked={webhookAutoSend}
                onChange={(e) => setWebhookAutoSend(e.target.checked)}
                className="w-5 h-5 accent-[#0284C7] rounded cursor-pointer shrink-0"
              />
            </label>

            {/* Manual Test & Bulk Send Buttons */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={isSendingWebhook}
                onClick={() =>
                  triggerWebhookDispatch(
                    [
                      {
                        ...formValues,
                        id: editingRecordId || `rota_preview_${Date.now()}`,
                      },
                    ],
                    'performance_test.test_ping',
                    false
                  )
                }
                className="h-10 px-3.5 rounded-xl bg-[#0B192C] hover:bg-[#0F294A] disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Send className="w-3.5 h-3.5 text-[#38BDF8]" />
                <span>
                  {isSendingWebhook ? 'Gönderiliyor...' : 'Aktif Formu Test Gönder'}
                </span>
              </button>

              <button
                type="button"
                disabled={isSendingWebhook || allRecords.length === 0}
                onClick={() =>
                  triggerWebhookDispatch(
                    allRecords,
                    'performance_test.bulk_sync',
                    false
                  )
                }
                className="h-10 px-3.5 rounded-xl bg-[#0284C7] hover:bg-[#0369A1] disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Webhook className="w-3.5 h-3.5" />
                <span>Tüm Kayıtları Gönder ({allRecords.length})</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const samplePayload = {
                    event: 'performance_test.saved',
                    source: 'ROTA Performans - Dijital Performans Test Formu',
                    provider: 'Sporsepeti Bilişim Teknolojileri',
                    sentAt: new Date().toISOString(),
                    count: 1,
                    data: [
                      {
                        id: 'rota_test_1001',
                        testDate: formValues.testDate || getTodayIsoDate(),
                        athlete: {
                          athleteName:
                            formValues.athleteName || 'Kerem Aktürkoğlu',
                          sportsClub:
                            formValues.sportsClub || 'ROTA Akademi SK',
                          birthDate: formValues.birthDate || '2011-04-12',
                        },
                        physicalMeasurements: {
                          heightCm: 168.5,
                          weightKg: 57.4,
                        },
                        gripStrengthKg: { rightKg: 34.2, leftKg: 31.8 },
                        flamingoBalanceSec: {
                          rightAttempt1Sec: 4,
                          rightAttempt2Sec: 3,
                          leftAttempt1Sec: 5,
                          leftAttempt2Sec: 4,
                        },
                        performanceTests: {
                          sprint20mSec: 3.18,
                          sitAndReachCm: 24.5,
                          armSpeedRightSec: 6.42,
                          armSpeedLeftSec: 6.78,
                          standingLongJumpCm: 208,
                          shuttleRun10x5Sec: 18.35,
                          verticalJumpCm: 42.5,
                          reactionTestSec: 0.24,
                        },
                        skinfoldThicknessMm: {
                          tricepsMm: 8.2,
                          bicepsMm: 5.4,
                          iliacMm: 9.6,
                          calfMm: 7.8,
                        },
                        familyInfo: {
                          mother: {
                            heightCm: 165,
                            weightKg: 62,
                            sportsHistoryMin1Year: 'Voleybol',
                          },
                          father: {
                            heightCm: 181,
                            weightKg: 80,
                            sportsHistoryMin1Year: 'Futbol',
                          },
                        },
                      },
                    ],
                  };
                  navigator.clipboard?.writeText(
                    JSON.stringify(samplePayload, null, 2)
                  );
                  setCopiedSchema(true);
                  setTimeout(() => setCopiedSchema(false), 2500);
                }}
                className="h-10 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-[#0B192C] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                {copiedSchema ? (
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>
                  {copiedSchema ? 'JSON Kopyalandı' : 'JSON Şemasını Kopyala'}
                </span>
              </button>
            </div>

            {/* Delivery Result Status Box */}
            {lastWebhookResult && (
              <div
                className={`p-3 rounded-xl border text-xs font-medium flex items-center justify-between gap-2 ${
                  lastWebhookResult.ok
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                    : 'bg-red-50 border-red-300 text-red-900'
                }`}
              >
                <span>{lastWebhookResult.message}</span>
                <span className="tabular-nums text-[11px] opacity-75 shrink-0">
                  {lastWebhookResult.sentAt}
                </span>
              </div>
            )}

            <div className="flex items-center justify-end pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setWebhookModalOpen(false)}
                className="h-10 px-5 rounded-xl bg-[#0284C7] hover:bg-[#0369A1] text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                Tamam
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AppErrorBoundary>
      <RotaPerformansApp />
    </AppErrorBoundary>
  );
}
