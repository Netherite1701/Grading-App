import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role, StoredRole, User } from "@/lib/types";

interface FirebaseTestUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
  isAnonymous: boolean;
}

const firebaseUser: FirebaseTestUser = {
  uid: "firebase-user-1",
  email: "firebase@soongsil.net",
  displayName: "Firebase User",
  photoURL: null,
  emailVerified: true,
  isAnonymous: false
};

const guestUser: User = {
  uid: firebaseUser.uid,
  email: firebaseUser.email ?? "",
  displayName: firebaseUser.displayName ?? undefined,
  role: "guest",
  createdAt: "2026-07-01T00:00:00.000Z"
};

const organizerUser: User = {
  ...guestUser,
  role: "dev",
  updatedAt: "2026-07-02T00:00:00.000Z"
};

const firebaseHarness = vi.hoisted(() => ({
  appDataListener: undefined as ((data: unknown) => void) | undefined,
  authStateUser: undefined as FirebaseTestUser | null | undefined,
  assertAuthorizedAppUser: vi.fn(),
  saveFirebaseEvent: vi.fn(),
  saveFirebaseScorecard: vi.fn(),
  saveFirebaseTranslationOverrides: vi.fn(),
  signInWithTeacherQr: vi.fn(),
  signOutOfGoogle: vi.fn(),
  upsertAuthenticatedUser: vi.fn()
}));

vi.mock("@/lib/firebase", () => ({
  assertAuthorizedAppUser: firebaseHarness.assertAuthorizedAppUser,
  createNewUserRecord: (user: FirebaseTestUser) => ({
    uid: user.uid,
    email: user.email ?? "",
    displayName: user.displayName ?? undefined,
    photoURL: user.photoURL ?? undefined,
    role: "guest",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z"
  }),
  getFirebaseErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "Firebase request failed."),
  isFirebaseConfigured: () => true,
  normalizeRole: (role: StoredRole | undefined): Role => {
    const normalizedRole = role?.trim().toLowerCase();
    if (normalizedRole === "admin") return "organizer";
    if (normalizedRole === "dev") return "developer";
    if (normalizedRole === "judge" || normalizedRole === "organizer" || normalizedRole === "developer" || normalizedRole === "guest") return normalizedRole;
    return "guest";
  },
  onFirebaseUserChanged: vi.fn(async (callback: (user: FirebaseTestUser | null) => void) => {
    void callback(firebaseHarness.authStateUser === undefined ? firebaseUser : firebaseHarness.authStateUser);
    return vi.fn();
  }),
  saveFirebaseEvent: firebaseHarness.saveFirebaseEvent,
  saveFirebaseParticipant: vi.fn(),
  saveFirebaseScorecard: firebaseHarness.saveFirebaseScorecard,
  saveFirebaseTranslationOverrides: firebaseHarness.saveFirebaseTranslationOverrides,
  signInWithGoogle: vi.fn(async () => firebaseUser),
  signInWithTeacherQr: firebaseHarness.signInWithTeacherQr,
  signOutOfGoogle: firebaseHarness.signOutOfGoogle,
  subscribeToFirebaseAppData: vi.fn(async (onData: (data: unknown) => void) => {
    firebaseHarness.appDataListener = onData;
    onData({
      users: [organizerUser],
      events: [],
      participantsByEvent: {},
      scorecards: [],
      translationOverrides: {}
    });
    return vi.fn();
  }),
  updateFirebaseUserRole: vi.fn(),
  upsertAuthenticatedUser: firebaseHarness.upsertAuthenticatedUser,
  upsertTeacherQrUser: vi.fn(async (user: FirebaseTestUser, profile: { displayName?: string }) => ({
    uid: user.uid,
    email: "",
    displayName: profile.displayName || "Teacher Judge",
    role: "judge",
    createdAt: "2026-07-01T00:00:00.000Z"
  }))
}));

describe("AppShell Firebase role sync", () => {
  beforeEach(() => {
    firebaseHarness.appDataListener = undefined;
    firebaseHarness.authStateUser = undefined;
    firebaseHarness.assertAuthorizedAppUser.mockReset();
    firebaseHarness.saveFirebaseEvent.mockReset();
    firebaseHarness.saveFirebaseEvent.mockResolvedValue(undefined);
    firebaseHarness.saveFirebaseScorecard.mockReset();
    firebaseHarness.saveFirebaseScorecard.mockResolvedValue(undefined);
    firebaseHarness.saveFirebaseTranslationOverrides.mockReset();
    firebaseHarness.saveFirebaseTranslationOverrides.mockResolvedValue(undefined);
    firebaseHarness.signInWithTeacherQr.mockReset();
    firebaseHarness.signInWithTeacherQr.mockResolvedValue({
      uid: "teacher-qr-1",
      email: null,
      displayName: null,
      photoURL: null,
      emailVerified: false,
      isAnonymous: true
    });
    firebaseHarness.signOutOfGoogle.mockReset();
    firebaseHarness.signOutOfGoogle.mockResolvedValue(undefined);
    firebaseHarness.upsertAuthenticatedUser.mockReset();
    firebaseHarness.upsertAuthenticatedUser.mockResolvedValue(guestUser);
    window.localStorage.clear();
    window.localStorage.setItem("grading-program-language", "en");
    window.history.pushState({}, "", "/");
    document.documentElement.lang = "";
  });

  it("updates the current user role from Firestore and routes to the matching view", async () => {
    const { AppShell } = await import("@/components/app-shell");

    render(<AppShell />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Developer tools" })).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: "Sign in with Google" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("keeps a valid Google session signed in when Firestore user sync fails", async () => {
    firebaseHarness.upsertAuthenticatedUser.mockRejectedValueOnce(new Error("permission-denied"));
    const { AppShell } = await import("@/components/app-shell");

    render(<AppShell />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    });

    expect(firebaseHarness.signOutOfGoogle).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Sign in with Google" })).not.toBeInTheDocument();
  });

  it("keeps a locally created event selected while Firebase snapshots catch up", async () => {
    const user = userEvent.setup();
    const { AppShell } = await import("@/components/app-shell");

    render(<AppShell />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Developer tools" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Organizer View" }));
    const eventName = screen.getByLabelText("Event name");
    await user.clear(eventName);
    await user.type(eventName, "Persistent Firebase Event");
    await user.click(screen.getByRole("button", { name: "Create event" }));

    expect(screen.getByRole("option", { name: "Persistent Firebase Event" })).toBeInTheDocument();
    expect(screen.getByLabelText("Event name")).toHaveValue("Persistent Firebase Event");
    await waitFor(() => {
      expect(firebaseHarness.saveFirebaseEvent).toHaveBeenCalledWith(expect.objectContaining({ name: "Persistent Firebase Event" }));
    });
    expect(await screen.findByText("Event saved to Firebase.")).toBeInTheDocument();

    act(() => {
      firebaseHarness.appDataListener?.({
        users: [organizerUser],
        events: [],
        participantsByEvent: {},
        scorecards: []
      });
    });

    expect(screen.getByRole("option", { name: "Persistent Firebase Event" })).toBeInTheDocument();
    expect(screen.getByLabelText("Event name")).toHaveValue("Persistent Firebase Event");
  });

  it("keeps a developer-created event visible and shows the Firebase rejection reason", async () => {
    const user = userEvent.setup();
    firebaseHarness.saveFirebaseEvent.mockRejectedValueOnce(new Error("permission-denied"));
    const { AppShell } = await import("@/components/app-shell");

    render(<AppShell />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Developer tools" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Organizer View" }));
    const eventName = screen.getByLabelText("Event name");
    await user.clear(eventName);
    await user.type(eventName, "Rejected But Visible Event");
    await user.click(screen.getByRole("button", { name: "Create event" }));

    expect(screen.getByRole("option", { name: "Rejected But Visible Event" })).toBeInTheDocument();
    expect(screen.getByLabelText("Event name")).toHaveValue("Rejected But Visible Event");
    expect(await screen.findByText(/Event stayed as a local draft because Firebase rejected the save/)).toBeInTheDocument();
  });

  it("generates a teacher QR login link for the selected event", async () => {
    const user = userEvent.setup();
    const { AppShell } = await import("@/components/app-shell");

    render(<AppShell />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Developer tools" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Organizer View" }));
    await user.type(screen.getByLabelText("Teacher display name"), "Professor Kim");

    const qrLink = screen.getByLabelText("Teacher QR link") as HTMLInputElement;
    const qrUrl = new URL(qrLink.value);
    expect(qrUrl.searchParams.get("teacherQr")).toBe("1");
    expect(qrUrl.searchParams.get("eventId")).toBe("launchpad-2026");
    expect(qrUrl.searchParams.get("teacherName")).toBe("Professor Kim");
    expect(qrUrl.searchParams.get("judgeKey")).toMatch(/^qr-/);
    expect(screen.getByLabelText("Teacher QR login")).toBeInTheDocument();
  });

  it("signs teachers in from a QR URL as judges", async () => {
    firebaseHarness.authStateUser = null;
    const { AppShell } = await import("@/components/app-shell");
    window.history.pushState({}, "", "/?teacherQr=1&eventId=launchpad-2026&teacherName=Professor%20Kim");

    render(<AppShell />);

    await waitFor(() => {
      expect(firebaseHarness.signInWithTeacherQr).toHaveBeenCalled();
    });
    expect(await screen.findByRole("heading", { name: "Judge workspace" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Event grading console" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Professor Kim" })).not.toBeInTheDocument();

    const sessionSummary = screen.getByText("Session / login");
    const sessionPanel = sessionSummary.closest("details") as HTMLDetailsElement;
    expect(sessionPanel.open).toBe(false);

    fireEvent.click(sessionSummary);
    expect(sessionPanel.open).toBe(true);
    expect(await screen.findByRole("heading", { name: "Professor Kim" })).toBeInTheDocument();
  });

  it("does not restore anonymous QR sessions as judges on non-QR URLs", async () => {
    firebaseHarness.authStateUser = {
      uid: "teacher-qr-previous",
      email: null,
      displayName: null,
      photoURL: null,
      emailVerified: false,
      isAnonymous: true
    };
    const { AppShell } = await import("@/components/app-shell");

    render(<AppShell />);

    expect(await screen.findByRole("button", { name: "Sign in with Google" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Judge workspace" })).not.toBeInTheDocument();
    expect(firebaseHarness.signOutOfGoogle).toHaveBeenCalled();
  });

  it("keeps separate QR judge scorecards isolated even when they share one anonymous auth UID", async () => {
    const sharedAnonymousUser = {
      uid: "shared-anon-uid",
      email: null,
      displayName: null,
      photoURL: null,
      emailVerified: false,
      isAnonymous: true
    };
    const user = userEvent.setup();
    const { AppShell } = await import("@/components/app-shell");

    firebaseHarness.authStateUser = sharedAnonymousUser;
    firebaseHarness.signInWithTeacherQr.mockResolvedValue(sharedAnonymousUser);
    window.history.pushState({}, "", `/?teacherQr=1&eventId=launchpad-2026&teacherName=${encodeURIComponent("심사1")}&judgeKey=qr-judge-1`);
    const firstRender = render(<AppShell />);

    await screen.findByRole("heading", { name: "Judge workspace" });
    await user.click(screen.getByRole("button", { name: "Team Helios" }));
    await user.click(screen.getByRole("button", { name: "Innovation grade E" }));

    await waitFor(() => {
      expect(firebaseHarness.saveFirebaseScorecard).toHaveBeenCalledWith(expect.objectContaining({
        id: "launchpad-2026_qr-judge-1_helios",
        eventId: "launchpad-2026",
        participantId: "helios",
        judgeId: "qr-judge-1",
        authUid: "shared-anon-uid",
        judgeName: "심사1"
      }));
    });

    firstRender.unmount();
    firebaseHarness.saveFirebaseScorecard.mockClear();
    window.history.pushState({}, "", `/?teacherQr=1&eventId=launchpad-2026&teacherName=${encodeURIComponent("심사2")}&judgeKey=qr-judge-2`);
    render(<AppShell />);

    await screen.findByRole("heading", { name: "Judge workspace" });
    await user.click(screen.getByRole("button", { name: "Team Helios" }));
    await user.click(screen.getByRole("button", { name: "Innovation grade A" }));

    await waitFor(() => {
      expect(firebaseHarness.saveFirebaseScorecard).toHaveBeenCalledWith(expect.objectContaining({
        id: "launchpad-2026_qr-judge-2_helios",
        eventId: "launchpad-2026",
        participantId: "helios",
        judgeId: "qr-judge-2",
        authUid: "shared-anon-uid",
        judgeName: "심사2"
      }));
    });
  });

  it("publishes translation overrides to Firebase", async () => {
    const { AppShell } = await import("@/components/app-shell");

    render(<AppShell />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Developer tools" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Translations" }));
    fireEvent.change(screen.getByLabelText("Edit language"), { target: { value: "en" } });
    fireEvent.change(await screen.findByLabelText("Translation en appTitle"), { target: { value: "Published Console" } });
    fireEvent.click(screen.getByRole("button", { name: "Publish translations" }));

    expect(firebaseHarness.saveFirebaseTranslationOverrides).toHaveBeenCalledWith(expect.objectContaining({ en: expect.objectContaining({ appTitle: "Published Console" }) }));
    expect(await screen.findByText("Translations published.")).toBeInTheDocument();
  }, 30000);

  it("signs the session back out when Firebase rejects the restored account", async () => {
    firebaseHarness.assertAuthorizedAppUser.mockImplementation(() => {
      throw new Error("학교 Google Workspace 계정(@soongsil.net)으로만 로그인할 수 있습니다.");
    });

    const { AppShell } = await import("@/components/app-shell");

    render(<AppShell />);

    expect(await screen.findByText("학교 Google Workspace 계정(@soongsil.net)으로만 로그인할 수 있습니다.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
    expect(firebaseHarness.signOutOfGoogle).toHaveBeenCalled();
  });
});
