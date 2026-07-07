import type { FirebaseApp } from "firebase/app";
import type { Auth, User as FirebaseUser } from "firebase/auth";
import type { Firestore, Unsubscribe } from "firebase/firestore";
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

export interface FirebaseAppData {
  users: User[];
  events: Event[];
  participantsByEvent: Record<string, Participant[]>;
  scorecards: Scorecard[];
}

type ParticipantRecord = Participant & { eventId?: string };

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

  return message || "Firebase request failed.";
}

export function createNewUserRecord(firebaseUser: Pick<FirebaseUser, "uid" | "email" | "displayName" | "photoURL">): User {
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

export async function getFirebaseAuth() {
  if (!auth) {
    const { getAuth } = await import("firebase/auth");
    auth = getAuth(await getFirebaseApp());
  }
  return auth;
}

export async function getFirebaseDb() {
  if (!db) {
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
  const result = await signInWithPopup(await getFirebaseAuth(), provider);
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
    scorecards: []
  };

  const emit = () => onData({ ...data, participantsByEvent: { ...data.participantsByEvent } });
  const fail = (error: unknown) => onError?.(error instanceof Error ? error : new Error("Firebase sync failed."));
  const { collection, onSnapshot } = await import("firebase/firestore");
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

export async function upsertAuthenticatedUser(firebaseUser: Pick<FirebaseUser, "uid" | "email" | "displayName" | "photoURL">): Promise<User> {
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
