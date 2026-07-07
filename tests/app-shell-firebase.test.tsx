import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Event, Participant, Role, StoredRole, User } from "@/lib/types";

const firebaseUser = {
  uid: "firebase-user-1",
  email: "firebase@example.com",
  displayName: "Firebase User",
  photoURL: null
};

const guestUser: User = {
  uid: firebaseUser.uid,
  email: firebaseUser.email,
  displayName: firebaseUser.displayName,
  role: "guest",
  createdAt: "2026-07-01T00:00:00.000Z"
};

const organizerUser: User = {
  ...guestUser,
  role: "dev",
  updatedAt: "2026-07-02T00:00:00.000Z"
};

const event: Event = {
  id: "firebase-event-1",
  name: "Firebase Event",
  description: "Synced event",
  status: "draft",
  gradingType: "rubric",
  ownerId: organizerUser.uid,
  ownerEmail: organizerUser.email,
  criteria: [],
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z"
};

const participant: Participant = {
  id: "team-1",
  name: "Team One",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z"
};

const firebaseHarness = vi.hoisted(() => ({
  appDataListener: undefined as ((data: unknown) => void) | undefined,
  saveFirebaseEvent: vi.fn()
}));

vi.mock("@/lib/firebase", () => ({
  getFirebaseErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "Firebase request failed."),
  isFirebaseConfigured: () => true,
  normalizeRole: (role: StoredRole | undefined): Role => {
    const normalizedRole = role?.trim().toLowerCase();
    if (normalizedRole === "admin") return "organizer";
    if (normalizedRole === "dev") return "developer";
    if (normalizedRole === "judge" || normalizedRole === "organizer" || normalizedRole === "developer" || normalizedRole === "guest") return normalizedRole;
    return "guest";
  },
  onFirebaseUserChanged: vi.fn(async (callback: (user: typeof firebaseUser) => void) => {
    void callback(firebaseUser);
    return vi.fn();
  }),
  saveFirebaseEvent: firebaseHarness.saveFirebaseEvent,
  saveFirebaseParticipant: vi.fn(),
  saveFirebaseScorecard: vi.fn(),
  signInWithGoogle: vi.fn(async () => firebaseUser),
  signOutOfGoogle: vi.fn(),
  subscribeToFirebaseAppData: vi.fn(async (onData: (data: unknown) => void) => {
    firebaseHarness.appDataListener = onData;
    onData({
      users: [organizerUser],
      events: [],
      participantsByEvent: {},
      scorecards: []
    });
    return vi.fn();
  }),
  updateFirebaseUserRole: vi.fn(),
  upsertAuthenticatedUser: vi.fn(async () => guestUser)
}));

describe("AppShell Firebase role sync", () => {
  beforeEach(() => {
    firebaseHarness.appDataListener = undefined;
    firebaseHarness.saveFirebaseEvent.mockReset();
    firebaseHarness.saveFirebaseEvent.mockResolvedValue(undefined);
    window.localStorage.clear();
    window.localStorage.setItem("grading-program-language", "en");
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
});
