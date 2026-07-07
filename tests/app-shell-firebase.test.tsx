import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
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
  saveFirebaseEvent: vi.fn(),
  saveFirebaseParticipant: vi.fn(),
  saveFirebaseScorecard: vi.fn(),
  signInWithGoogle: vi.fn(async () => firebaseUser),
  signOutOfGoogle: vi.fn(),
  subscribeToFirebaseAppData: vi.fn(async (onData: (data: unknown) => void) => {
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
  it("updates the current user role from Firestore and routes to the matching view", async () => {
    const { AppShell } = await import("@/components/app-shell");

    render(<AppShell />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Developer tools" })).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: "Sign in with Google" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });
});
