import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAuth = {};
const mockDb = {};
const mockUserRef = {};
const collectionMock = vi.fn((_: unknown, name: string) => ({ name }));
const getDocMock = vi.fn();
const firestoreOnSnapshotMock = vi.fn();
const deleteDocMock = vi.fn();
const setDocMock = vi.fn();
const signInAnonymouslyMock = vi.fn();
const signInWithPopupMock = vi.fn();
const signOutMock = vi.fn();
const onAuthStateChangedMock = vi.fn();
const initializeAppCheckMock = vi.fn();
const appCheckProviderMock = vi.fn((siteKey: string) => ({ siteKey }));
const googleProviderInstances: Array<{ setCustomParameters: ReturnType<typeof vi.fn> }> = [];

const GoogleAuthProviderMock = vi.fn(() => {
  const instance = {
    setCustomParameters: vi.fn()
  };
  googleProviderInstances.push(instance);
  return instance;
});

vi.mock("firebase/app", () => ({
  getApps: vi.fn(() => []),
  initializeApp: vi.fn(() => ({}))
}));

vi.mock("firebase/auth", () => ({
  getAuth: vi.fn(() => mockAuth),
  GoogleAuthProvider: GoogleAuthProviderMock,
  onAuthStateChanged: onAuthStateChangedMock,
  signInAnonymously: signInAnonymouslyMock,
  signInWithPopup: signInWithPopupMock,
  signOut: signOutMock
}));

vi.mock("firebase/app-check", () => ({
  ReCaptchaEnterpriseProvider: appCheckProviderMock,
  initializeAppCheck: initializeAppCheckMock
}));

vi.mock("firebase/firestore", () => ({
  collection: collectionMock,
  doc: vi.fn((_: unknown, name: string, id: string) => (name === "appConfig" ? { name, id } : mockUserRef)),
  deleteDoc: deleteDocMock,
  getDoc: getDocMock,
  getFirestore: vi.fn(() => mockDb),
  onSnapshot: firestoreOnSnapshotMock,
  setDoc: setDocMock
}));

describe("Firebase helpers", () => {
  let firebase: typeof import("@/lib/firebase");

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_API_KEY", "test-key");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", "test.firebaseapp.com");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "test-project");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_APP_ID", "test-app");
    vi.stubEnv("NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN", "soongsil.net");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY", "site-key");
    firebase = await import("@/lib/firebase");
    getDocMock.mockReset();
    collectionMock.mockClear();
    firestoreOnSnapshotMock.mockReset();
    deleteDocMock.mockReset();
    setDocMock.mockReset();
    signInAnonymouslyMock.mockReset();
    signInWithPopupMock.mockReset();
    signOutMock.mockReset();
    onAuthStateChangedMock.mockReset();
    initializeAppCheckMock.mockReset();
    appCheckProviderMock.mockClear();
    GoogleAuthProviderMock.mockClear();
    googleProviderInstances.length = 0;
    delete (globalThis as typeof globalThis & { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN;
  });

  it("normalizes legacy admin records to organizer", () => {
    expect(firebase.normalizeRole("admin")).toBe("organizer");
    expect(firebase.normalizeRole("dev")).toBe("developer");
    expect(firebase.normalizeRole(" Developer ")).toBe("developer");
    expect(firebase.normalizeRole("JUDGE")).toBe("judge");
    expect(firebase.normalizeRole(undefined)).toBe("guest");
  });

  it("explains missing Firebase Auth configuration", () => {
    expect(firebase.getFirebaseErrorMessage({ code: "auth/configuration-not-found" })).toContain("enable Google sign-in");
  });

  it("explains event write permission failures using the canonical user document", () => {
    expect(firebase.getFirebaseErrorMessage({ code: "permission-denied" })).toContain("users/{auth.uid}");
  });

  it("rejects missing, unverified, or non-school Google accounts", () => {
    expect(() => firebase.assertAuthorizedFirebaseUser({ email: null, emailVerified: true })).toThrow("Google account email is required.");
    expect(() => firebase.assertAuthorizedFirebaseUser({ email: "judge@soongsil.net", emailVerified: false })).toThrow("Google account email must be verified.");
    expect(() => firebase.assertAuthorizedFirebaseUser({ email: "judge@example.com", emailVerified: true })).toThrow("Google account must use @soongsil.net.");
    expect(() => firebase.assertAuthorizedFirebaseUser({ email: "judge@soongsil.net", emailVerified: true })).not.toThrow();
  });

  it("allows anonymous teacher QR accounts through the app-level auth check", () => {
    expect(() => firebase.assertAuthorizedAppUser({ email: null, emailVerified: false, isAnonymous: true })).not.toThrow();
  });

  it("reuses an existing user record and preserves its role", async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({
        uid: "user-1",
        email: "existing@example.com",
        displayName: "Existing User",
        role: "developer",
        createdAt: "2026-01-01T00:00:00.000Z"
      })
    });

    const user = await firebase.upsertAuthenticatedUser({
      uid: "user-1",
      email: "new@example.com",
      displayName: "New Name",
      photoURL: null
    });

    expect(user.role).toBe("developer");
    expect(user.email).toBe("existing@example.com");
    expect(setDocMock).toHaveBeenCalledOnce();
  });

  it("reuses a legacy dev role without rewriting it on sign-in", async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({
        uid: "user-2",
        email: "dev@example.com",
        displayName: "Legacy Dev",
        role: "dev",
        createdAt: "2026-01-01T00:00:00.000Z"
      })
    });

    const user = await firebase.upsertAuthenticatedUser({
      uid: "user-2",
      email: "dev@example.com",
      displayName: "Legacy Dev",
      photoURL: null
    });

    expect(user.role).toBe("dev");
    expect(setDocMock).toHaveBeenCalledWith(mockUserRef, expect.objectContaining({ role: "dev" }), { merge: true });
  });

  it("creates missing users as guests", async () => {
    getDocMock.mockResolvedValue({
      exists: () => false
    });

    const user = await firebase.upsertAuthenticatedUser({
      uid: "user-2",
      email: "guest@example.com",
      displayName: "Guest User",
      photoURL: "https://example.com/avatar.png"
    });

    expect(user.role).toBe("guest");
    expect(setDocMock).toHaveBeenCalledWith(mockUserRef, expect.objectContaining({ role: "guest", uid: "user-2" }), { merge: true });
  });

  it("creates teacher QR users as judges", async () => {
    getDocMock.mockResolvedValue({
      exists: () => false
    });

    const user = await firebase.upsertTeacherQrUser(
      {
        uid: "teacher-qr-2",
        email: null,
        displayName: null,
        photoURL: null
      },
      { displayName: "Professor Kim" }
    );

    expect(user.role).toBe("judge");
    expect(user.displayName).toBe("Professor Kim");
    expect(setDocMock).toHaveBeenCalledWith(mockUserRef, expect.objectContaining({ email: "", role: "judge", uid: "teacher-qr-2" }), { merge: true });
  });

  it("signs out through Firebase Auth", async () => {
    signOutMock.mockResolvedValue(undefined);

    await firebase.signOutOfGoogle();

    expect(signOutMock).toHaveBeenCalledWith(mockAuth);
  });

  it("hints Google sign-in to the school domain without requiring App Check before the popup", async () => {
    signInWithPopupMock.mockResolvedValue({
      user: {
        uid: "school-user-1",
        email: "judge@soongsil.net",
        emailVerified: true,
        displayName: "Judge",
        photoURL: null
      }
    });

    const user = await firebase.signInWithGoogle();

    expect(user.email).toBe("judge@soongsil.net");
    expect(initializeAppCheckMock).not.toHaveBeenCalled();
    expect(googleProviderInstances[0]?.setCustomParameters).toHaveBeenCalledWith({
      hd: "soongsil.net",
      prompt: "select_account"
    });
  });

  it("signs in teacher QR users anonymously", async () => {
    signInAnonymouslyMock.mockResolvedValue({
      user: {
        uid: "teacher-qr-1",
        email: null,
        emailVerified: false,
        isAnonymous: true,
        displayName: null,
        photoURL: null
      }
    });

    const user = await firebase.signInWithTeacherQr();

    expect(user.uid).toBe("teacher-qr-1");
    expect(signInAnonymouslyMock).toHaveBeenCalledWith(mockAuth);
  });

  it("signs out rejected Google accounts before creating a user record", async () => {
    signInWithPopupMock.mockResolvedValue({
      user: {
        uid: "external-user-1",
        email: "judge@example.com",
        emailVerified: true,
        displayName: "External Judge",
        photoURL: null
      }
    });
    signOutMock.mockResolvedValue(undefined);

    await expect(firebase.signInWithGoogle()).rejects.toThrow("Google account must use @soongsil.net.");
    expect(signOutMock).toHaveBeenCalledWith(mockAuth);
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it("writes events, participants, scorecards, and role updates to Firestore", async () => {
    const event = {
      id: "event-1",
      name: "Backend Test",
      description: "Firestore-backed event",
      status: "draft" as const,
      gradingType: "rubric" as const,
      ownerId: "organizer-1",
      ownerEmail: "organizer@example.com",
      criteria: [],
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z"
    };
    const participant = {
      id: "team-1",
      name: "Team One",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z"
    };
    const scorecard = {
      id: "judge-1_team-1",
      eventId: "event-1",
      participantId: "team-1",
      judgeId: "judge-1",
      judgeName: "Judge One",
      judgeEmail: "judge@example.com",
      scores: {},
      totalScore: 0,
      updatedAt: "2026-07-01T00:00:00.000Z"
    };

    await firebase.saveFirebaseEvent(event);
    await firebase.saveFirebaseParticipant("event-1", participant);
    await firebase.saveFirebaseScorecard(scorecard);
    await firebase.updateFirebaseUserRole("user-1", "organizer");
    await firebase.saveFirebaseTranslationOverrides({ ko: { appTitle: "게시된 제목" } });

    expect(setDocMock).toHaveBeenCalledWith(mockUserRef, event, { merge: true });
    expect(setDocMock).toHaveBeenCalledWith(mockUserRef, { ...participant, eventId: "event-1" }, { merge: true });
    expect(setDocMock).toHaveBeenCalledWith(mockUserRef, scorecard, { merge: true });
    expect(setDocMock).toHaveBeenCalledWith(mockUserRef, expect.objectContaining({ role: "organizer" }), { merge: true });
    expect(setDocMock).toHaveBeenCalledWith(expect.objectContaining({ name: "appConfig", id: "translations" }), expect.objectContaining({ overrides: { ko: { appTitle: "게시된 제목" } } }), { merge: true });
  });

  it("deletes participants from Firestore", async () => {
    await firebase.deleteFirebaseParticipant("team-1");

    expect(deleteDocMock).toHaveBeenCalledWith(mockUserRef);
  });

  it("subscribes to app data collections and groups participants by event", async () => {
    const unsubscribe = vi.fn();
    firestoreOnSnapshotMock.mockImplementation((collectionRef, next) => {
      if (collectionRef.name === "appConfig") {
        next({
          exists: () => true,
          data: () => ({ overrides: { en: { appTitle: "Published title" } } })
        });
        return unsubscribe;
      }

      const docsByCollection = {
        users: [{ id: "user-1", data: () => ({ uid: "wrong-user-id", email: "user@example.com", role: "guest", createdAt: "now" }) }],
        events: [{ id: "event-1", data: () => ({ name: "Event One", status: "draft", gradingType: "rubric", ownerId: "user-1", ownerEmail: "user@example.com", criteria: [], createdAt: "now", updatedAt: "now" }) }],
        participants: [{ id: "team-1", data: () => ({ eventId: "event-1", name: "Team One", createdAt: "now", updatedAt: "now" }) }],
        scorecards: [{ id: "score-1", data: () => ({ eventId: "event-1", participantId: "team-1", judgeId: "judge-1", judgeName: "Judge", judgeEmail: "judge@example.com", scores: {}, totalScore: 0, updatedAt: "now" }) }]
      };
      next({ docs: docsByCollection[collectionRef.name as keyof typeof docsByCollection] });
      return unsubscribe;
    });

    const onData = vi.fn();
    const stop = await firebase.subscribeToFirebaseAppData(onData);

    expect(onData).toHaveBeenLastCalledWith(
      expect.objectContaining({
        users: [expect.objectContaining({ uid: "user-1", email: "user@example.com" })],
        translationOverrides: { en: { appTitle: "Published title" } },
        participantsByEvent: {
          "event-1": [expect.objectContaining({ id: "team-1", name: "Team One" })]
        }
      })
    );

    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(5);
  });
});
