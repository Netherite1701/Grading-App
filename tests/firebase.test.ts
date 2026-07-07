import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockAuth = {};
const mockDb = {};
const mockUserRef = {};
const collectionMock = vi.fn((_: unknown, name: string) => ({ name }));
const getDocMock = vi.fn();
const firestoreOnSnapshotMock = vi.fn();
const deleteDocMock = vi.fn();
const setDocMock = vi.fn();
const signInWithPopupMock = vi.fn();
const signOutMock = vi.fn();
const onAuthStateChangedMock = vi.fn();

vi.mock("firebase/app", () => ({
  getApps: vi.fn(() => []),
  initializeApp: vi.fn(() => ({}))
}));

vi.mock("firebase/auth", () => ({
  getAuth: vi.fn(() => mockAuth),
  GoogleAuthProvider: vi.fn(),
  onAuthStateChanged: onAuthStateChangedMock,
  signInWithPopup: signInWithPopupMock,
  signOut: signOutMock
}));

vi.mock("firebase/firestore", () => ({
  collection: collectionMock,
  doc: vi.fn(() => mockUserRef),
  deleteDoc: deleteDocMock,
  getDoc: getDocMock,
  getFirestore: vi.fn(() => mockDb),
  onSnapshot: firestoreOnSnapshotMock,
  setDoc: setDocMock
}));

describe("Firebase helpers", () => {
  let firebase: typeof import("@/lib/firebase");

  beforeAll(async () => {
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_API_KEY", "test-key");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", "test.firebaseapp.com");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "test-project");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_APP_ID", "test-app");
    firebase = await import("@/lib/firebase");
  });

  beforeEach(() => {
    getDocMock.mockReset();
    collectionMock.mockClear();
    firestoreOnSnapshotMock.mockReset();
    deleteDocMock.mockReset();
    setDocMock.mockReset();
    signInWithPopupMock.mockReset();
    signOutMock.mockReset();
    onAuthStateChangedMock.mockReset();
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

  it("signs out through Firebase Auth", async () => {
    signOutMock.mockResolvedValue(undefined);

    await firebase.signOutOfGoogle();

    expect(signOutMock).toHaveBeenCalledWith(mockAuth);
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

    expect(setDocMock).toHaveBeenCalledWith(mockUserRef, event, { merge: true });
    expect(setDocMock).toHaveBeenCalledWith(mockUserRef, { ...participant, eventId: "event-1" }, { merge: true });
    expect(setDocMock).toHaveBeenCalledWith(mockUserRef, scorecard, { merge: true });
    expect(setDocMock).toHaveBeenCalledWith(mockUserRef, expect.objectContaining({ role: "organizer" }), { merge: true });
  });

  it("deletes participants from Firestore", async () => {
    await firebase.deleteFirebaseParticipant("team-1");

    expect(deleteDocMock).toHaveBeenCalledWith(mockUserRef);
  });

  it("subscribes to app data collections and groups participants by event", async () => {
    const unsubscribe = vi.fn();
    firestoreOnSnapshotMock.mockImplementation((collectionRef, next) => {
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
        participantsByEvent: {
          "event-1": [expect.objectContaining({ id: "team-1", name: "Team One" })]
        }
      })
    );

    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(4);
  });
});
