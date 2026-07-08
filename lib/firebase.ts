import type { FirebaseApp } from "firebase/app";
import type { Auth, User as FirebaseUser } from "firebase/auth";
import type { Firestore, Unsubscribe } from "firebase/firestore";
import type { TranslationOverrides } from "@/lib/i18n";
import type { Event, Participant, Role, Scorecard, StoredRole, User } from "@/lib/types";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
};

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;
let appCheckPromise: Promise<void> | undefined;

export interface FirebaseAppData {
  users: User[];
  events: Event[];
  participantsByEvent: Record<string, Participant[]>;
  scorecards: Scorecard[];
  translationOverrides: TranslationOverrides;
}

type ParticipantRecord = Participant & { eventId?: string };
type FirebaseUserProfile = Pick<FirebaseUser, "uid" | "email" | "displayName" | "photoURL">;
type AuthorizedFirebaseUser = FirebaseUserProfile & Pick<FirebaseUser, "emailVerified">;
export interface TeacherQrProfile {
  displayName?: string;
}

function getAllowedEmailDomain() {
  return process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN?.trim().toLowerCase() ?? "";
}

function getAppCheckSiteKey() {
  return process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY?.trim() ?? "";
}

function createFirebaseError(code: string, message: string) {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

function isLocalhost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function hasAllowedEmailDomain(email: string, allowedDomain: string) {
  const normalizedEmail = email.trim().toLowerCase();
  return normalizedEmail.endsWith(`@${allowedDomain}`);
}

function isAnonymousFirebaseUser(firebaseUser: Pick<FirebaseUser, "isAnonymous">) {
  return firebaseUser.isAnonymous === true;
}

export function isFirebaseConfigured() {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId);
}

export function normalizeRole(role: StoredRole | undefined): Role {
  const normalizedRole = role?.trim().toLowerCase();
  if (normalizedRole === "admin") return "organizer";
  if (normalizedRole === "dev") return "developer";
  if (normalizedRole === "judge" || normalizedRole === "organizer" || normalizedRole === "developer" || normalizedRole === "guest") return normalizedRole;
  return "guest";
}

export function getFirebaseErrorMessage(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : "";

  if (code === "auth/configuration-not-found" || message.includes("auth/configuration-not-found")) {
    return "Firebase Authentication is not enabled for this project yet. In Firebase Console, open Authentication, click Get started, enable Google sign-in, and add localhost to Authorized domains.";
  }

  if (code === "permission-denied" || message.includes("permission-denied")) {
    return "Firestore rejected this request. Confirm firestore.rules are deployed and that your canonical users/{auth.uid} document has role developer, dev, organizer, or admin.";
  }

  if (code === "unavailable" || message.includes("client is offline")) {
    return "Firestore is not reachable yet. Make sure the Firestore database exists, your network allows Firebase, and refresh after it is enabled.";
  }

  if (code === "auth/missing-allowed-domain") {
    return "NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN 환경 변수가 필요합니다.";
  }

  if (code === "auth/invalid-email-domain") {
    return "학교 Google Workspace 계정(@soongsil.net)으로만 로그인할 수 있습니다.";
  }

  if (code === "auth/unverified-email") {
    return "이메일 인증이 완료된 soongsil.net 계정으로만 로그인할 수 있습니다.";
  }

  if (code === "auth/missing-email") {
    return "Google 계정 이메일을 확인할 수 없어 로그인할 수 없습니다.";
  }

  if (code === "app-check/missing-site-key") {
    return "NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY 환경 변수가 필요합니다.";
  }

  return message || "Firebase request failed.";
}

export function assertAuthorizedFirebaseUser(firebaseUser: Pick<FirebaseUser, "email" | "emailVerified">) {
  const allowedEmailDomain = getAllowedEmailDomain();
  if (!allowedEmailDomain) {
    throw createFirebaseError("auth/missing-allowed-domain", "NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN is required.");
  }

  if (!firebaseUser.email) {
    throw createFirebaseError("auth/missing-email", "Google account email is required.");
  }

  if (!firebaseUser.emailVerified) {
    throw createFirebaseError("auth/unverified-email", "Google account email must be verified.");
  }

  if (!hasAllowedEmailDomain(firebaseUser.email, allowedEmailDomain)) {
    throw createFirebaseError("auth/invalid-email-domain", `Google account must use @${allowedEmailDomain}.`);
  }
}

export function assertAuthorizedAppUser(firebaseUser: Pick<FirebaseUser, "email" | "emailVerified" | "isAnonymous">) {
  if (isAnonymousFirebaseUser(firebaseUser)) return;
  assertAuthorizedFirebaseUser(firebaseUser);
}

export function createNewUserRecord(firebaseUser: FirebaseUserProfile): User {
  const now = new Date().toISOString();
  return {
    uid: firebaseUser.uid,
    email: firebaseUser.email ?? "",
    displayName: firebaseUser.displayName ?? undefined,
    photoURL: firebaseUser.photoURL ?? undefined,
    role: "guest",
    createdAt: now,
    updatedAt: now
  };
}

export async function getFirebaseApp() {
  if (app) return app;
  if (!isFirebaseConfigured()) {
    throw new Error("Missing Firebase env vars. Set NEXT_PUBLIC_FIREBASE_* values to enable live sync.");
  }
  const { getApps, initializeApp } = await import("firebase/app");
  app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  return app;
}

export async function initializeFirebaseAppCheck() {
  if (typeof window === "undefined" || !isFirebaseConfigured()) return;
  if (appCheckPromise) return appCheckPromise;

  appCheckPromise = (async () => {
    const siteKey = getAppCheckSiteKey();
    if (!siteKey) {
      throw createFirebaseError("app-check/missing-site-key", "NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY is required.");
    }

    const [{ ReCaptchaEnterpriseProvider, initializeAppCheck }, firebaseApp] = await Promise.all([
      import("firebase/app-check"),
      getFirebaseApp()
    ]);

    if (isLocalhost(window.location.hostname)) {
      (globalThis as typeof globalThis & { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }

    initializeAppCheck(firebaseApp, {
      provider: new ReCaptchaEnterpriseProvider(siteKey),
      isTokenAutoRefreshEnabled: true
    });
  })().catch((error) => {
    appCheckPromise = undefined;
    throw error;
  });

  return appCheckPromise;
}

export async function getFirebaseAuth() {
  if (!auth) {
    const { getAuth } = await import("firebase/auth");
    auth = getAuth(await getFirebaseApp());
  }
  return auth;
}

export async function getFirebaseDb() {
  if (!db) {
    await initializeFirebaseAppCheck();
    const { getFirestore } = await import("firebase/firestore");
    db = getFirestore(await getFirebaseApp());
  }
  return db;
}

export async function onFirebaseUserChanged(callback: (user: FirebaseUser | null) => void) {
  const { onAuthStateChanged } = await import("firebase/auth");
  return onAuthStateChanged(await getFirebaseAuth(), callback);
}

export async function signInWithGoogle() {
  const { GoogleAuthProvider, signInWithPopup } = await import("firebase/auth");
  const provider = new GoogleAuthProvider();
  const allowedEmailDomain = getAllowedEmailDomain();
  if (allowedEmailDomain) {
    provider.setCustomParameters({
      hd: allowedEmailDomain,
      prompt: "select_account"
    });
  }

  const firebaseAuth = await getFirebaseAuth();
  const result = await signInWithPopup(firebaseAuth, provider);
  try {
    assertAuthorizedFirebaseUser(result.user as AuthorizedFirebaseUser);
  } catch (error) {
    const { signOut } = await import("firebase/auth");
    await signOut(firebaseAuth);
    throw error;
  }
  return result.user;
}

export async function signInWithTeacherQr() {
  const { signInAnonymously } = await import("firebase/auth");
  const result = await signInAnonymously(await getFirebaseAuth());
  return result.user;
}

export async function signOutOfGoogle() {
  const { signOut } = await import("firebase/auth");
  return signOut(await getFirebaseAuth());
}

export async function subscribeToFirebaseAppData(onData: (data: FirebaseAppData) => void, onError?: (error: Error) => void) {
  const data: FirebaseAppData = {
    users: [],
    events: [],
    participantsByEvent: {},
    scorecards: [],
    translationOverrides: {}
  };

  const emit = () => onData({ ...data, participantsByEvent: { ...data.participantsByEvent } });
  const fail = (error: unknown) => onError?.(error instanceof Error ? error : new Error("Firebase sync failed."));
  const { collection, doc, onSnapshot } = await import("firebase/firestore");
  const firestore = await getFirebaseDb();

  const unsubscribers: Unsubscribe[] = [
    onSnapshot(
      collection(firestore, "users"),
      (snapshot) => {
        data.users = snapshot.docs.map((item) => {
          const user = item.data() as User;
          return { ...user, uid: item.id };
        });
        emit();
      },
      fail
    ),
    onSnapshot(
      collection(firestore, "events"),
      (snapshot) => {
        data.events = snapshot.docs.map((item) => ({ id: item.id, ...(item.data() as Omit<Event, "id">) }));
        emit();
      },
      fail
    ),
    onSnapshot(
      collection(firestore, "participants"),
      (snapshot) => {
        data.participantsByEvent = snapshot.docs.reduce<Record<string, Participant[]>>((grouped, item) => {
          const { eventId, ...participantData } = item.data() as ParticipantRecord;
          if (!eventId) return grouped;
          const participant = { ...participantData, id: item.id };
          grouped[eventId] = [...(grouped[eventId] ?? []), participant];
          return grouped;
        }, {});
        emit();
      },
      fail
    ),
    onSnapshot(
      collection(firestore, "scorecards"),
      (snapshot) => {
        data.scorecards = snapshot.docs.map((item) => ({ id: item.id, ...(item.data() as Omit<Scorecard, "id">) }));
        emit();
      },
      fail
    ),
    onSnapshot(
      doc(firestore, "appConfig", "translations"),
      (snapshot) => {
        data.translationOverrides = snapshot.exists()
          ? ((snapshot.data().overrides ?? {}) as TranslationOverrides)
          : {};
        emit();
      },
      fail
    )
  ];

  return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
}

export async function saveFirebaseEvent(event: Event) {
  const { doc, setDoc } = await import("firebase/firestore");
  return setDoc(doc(await getFirebaseDb(), "events", event.id), event, { merge: true });
}

export async function saveFirebaseParticipant(eventId: string, participant: Participant) {
  const { doc, setDoc } = await import("firebase/firestore");
  return setDoc(doc(await getFirebaseDb(), "participants", participant.id), { ...participant, eventId }, { merge: true });
}

export async function deleteFirebaseParticipant(participantId: string) {
  const { deleteDoc, doc } = await import("firebase/firestore");
  return deleteDoc(doc(await getFirebaseDb(), "participants", participantId));
}

export async function saveFirebaseScorecard(scorecard: Scorecard) {
  const { doc, setDoc } = await import("firebase/firestore");
  return setDoc(doc(await getFirebaseDb(), "scorecards", scorecard.id), scorecard, { merge: true });
}

export async function updateFirebaseUserRole(uid: string, role: Role) {
  const { doc, setDoc } = await import("firebase/firestore");
  return setDoc(doc(await getFirebaseDb(), "users", uid), { role, updatedAt: new Date().toISOString() }, { merge: true });
}

export async function saveFirebaseTranslationOverrides(overrides: TranslationOverrides) {
  const { doc, setDoc } = await import("firebase/firestore");
  return setDoc(
    doc(await getFirebaseDb(), "appConfig", "translations"),
    {
      overrides,
      updatedAt: new Date().toISOString()
    },
    { merge: true }
  );
}

export async function upsertAuthenticatedUser(firebaseUser: FirebaseUserProfile): Promise<User> {
  const { doc, getDoc, setDoc } = await import("firebase/firestore");
  const userRef = doc(await getFirebaseDb(), "users", firebaseUser.uid);
  const existing = await getDoc(userRef);
  const now = new Date().toISOString();

  if (existing.exists()) {
    const data = existing.data() as Partial<User>;
    const user: User = {
      uid: firebaseUser.uid,
      email: data.email ?? firebaseUser.email ?? "",
      displayName: data.displayName ?? firebaseUser.displayName ?? undefined,
      photoURL: data.photoURL ?? firebaseUser.photoURL ?? undefined,
      role: data.role ?? "guest",
      createdAt: data.createdAt ?? now,
      updatedAt: now
    };
    await setDoc(userRef, user, { merge: true });
    return user;
  }

  const user: User = createNewUserRecord(firebaseUser);
  await setDoc(userRef, user, { merge: true });
  return user;
}

export async function upsertTeacherQrUser(firebaseUser: FirebaseUserProfile, profile: TeacherQrProfile = {}): Promise<User> {
  const { doc, getDoc, setDoc } = await import("firebase/firestore");
  const userRef = doc(await getFirebaseDb(), "users", firebaseUser.uid);
  const existing = await getDoc(userRef);
  const now = new Date().toISOString();
  const displayName = profile.displayName?.trim() || firebaseUser.displayName || "Teacher Judge";

  const user: User = existing.exists()
    ? {
        uid: firebaseUser.uid,
        email: "",
        displayName,
        photoURL: firebaseUser.photoURL ?? undefined,
        role: "judge",
        createdAt: (existing.data() as Partial<User>).createdAt ?? now,
        updatedAt: now
      }
    : {
        uid: firebaseUser.uid,
        email: "",
        displayName,
        photoURL: firebaseUser.photoURL ?? undefined,
        role: "judge",
        createdAt: now,
        updatedAt: now
      };

  await setDoc(userRef, user, { merge: true });
  return user;
}
