import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/app-shell";
import type { User } from "@/lib/types";

const judgeUser: User = {
  uid: "judge-test",
  email: "judge@example.com",
  displayName: "Judge Test",
  role: "judge",
  createdAt: "2026-07-01T00:00:00.000Z"
};

const organizerUser: User = {
  uid: "organizer-test",
  email: "organizer@example.com",
  displayName: "Organizer Test",
  role: "organizer",
  createdAt: "2026-07-01T00:00:00.000Z"
};

const guestUser: User = {
  uid: "guest-test",
  email: "guest@example.com",
  displayName: "Guest Test",
  role: "guest",
  createdAt: "2026-07-01T00:00:00.000Z"
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("AppShell", () => {
  it("routes a judge directly to scoring and persists a scorecard into standings", async () => {
    const user = userEvent.setup();
    render(<AppShell initialUser={judgeUser} />);

    expect(screen.getByRole("heading", { name: "Judge workspace" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Score breakdown" })).toBeInTheDocument();
    expect(screen.getByLabelText("Choose team")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Organizer View" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in with Google" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Team Helios" }));
    await user.click(screen.getByRole("button", { name: "Innovation grade E" }));

    expect(screen.getByText("39.0")).toBeInTheDocument();

    const notes = screen.getByLabelText("Feedback notes");
    await user.clear(notes);
    await user.type(notes, "Needs a sharper opening and stronger demo pacing.");
    await user.click(screen.getByRole("button", { name: "Save scorecard" }));
  });

  it("routes an organizer to the event builder and clarifies scoring setup", async () => {
    const user = userEvent.setup();
    render(<AppShell initialUser={organizerUser} />);

    expect(screen.getByRole("heading", { name: "Event builder" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Scoring preview" })).toBeInTheDocument();

    const eventName = screen.getByLabelText("Event name");
    await user.clear(eventName);
    await user.type(eventName, "Spring Showcase");
    await user.selectOptions(screen.getByLabelText("Scoring model"), "manual");
    await user.click(screen.getByRole("button", { name: "Create event" }));
    expect(screen.getByRole("option", { name: "Spring Showcase" })).toBeInTheDocument();
    expect(eventName).toHaveValue("Spring Showcase");

    expect(screen.getByText("Direct")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add criterion" })).toBeInTheDocument();
    expect(screen.queryByText("A 5/5")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Scoring model"), "rubric");

    const maxInputs = screen.getAllByLabelText("Maximum points");
    const weightInputs = screen.getAllByLabelText("Weight multiplier");
    fireEvent.change(maxInputs[0], { target: { value: "10" } });
    fireEvent.change(weightInputs[0], { target: { value: "5" } });

    expect(screen.getAllByText("50.0").length).toBeGreaterThan(0);
    await user.type(screen.getByLabelText("Team name"), "Team Aurora");
    expect(screen.getByRole("button", { name: "Add team" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Add team" }));
    await user.click(screen.getByRole("button", { name: "Add criterion" }));
    expect(screen.getAllByLabelText("Maximum points")).toHaveLength(5);

    await user.clear(eventName);
    await user.type(eventName, "LaunchPad Demo Night Updated");
    await user.click(screen.getByRole("button", { name: "Save event" }));

    expect(eventName).toHaveValue("LaunchPad Demo Night Updated");
  });

  it("keeps guests in read-only standings", () => {
    render(<AppShell initialUser={guestUser} />);

    expect(screen.getByRole("heading", { name: "Live standings" })).toBeInTheDocument();
    expect(screen.getByText("View only")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save scorecard" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create event" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Developer tools" })).not.toBeInTheDocument();
  });

  it("shows the Google sign-in action only when signed out", () => {
    render(<AppShell initialUser={null} />);

    expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
  });

  it("gives developers tabbed access to all views and role management", async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    expect(screen.getByRole("heading", { name: "Developer tools" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Judge View" }));
    expect(screen.getByRole("heading", { name: "Judge workspace" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Organizer View" }));
    expect(screen.getByRole("heading", { name: "Event builder" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Guest / Standings View" }));
    expect(screen.getByRole("heading", { name: "Live standings" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Developer tools" }));
    expect(screen.getByLabelText("Role for guest@hackweek.dev")).toHaveValue("guest");
  });

  it("switches the shell to Korean", async () => {
    const user = userEvent.setup();
    render(<AppShell initialUser={organizerUser} />);

    await user.selectOptions(screen.getByLabelText("Language"), "ko");

    expect(document.documentElement.lang).toBe("ko");
    expect(screen.getByRole("button", { name: "로그아웃" })).toBeInTheDocument();
    expect(screen.getByLabelText("언어")).toHaveValue("ko");
  });

  it("lets developers edit translation overrides", async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    await user.selectOptions(screen.getByLabelText("Language"), "ko");
    fireEvent.change(screen.getByLabelText("Translation ko appTitle"), { target: { value: "대회 평가 관리" } });

    expect(screen.getByRole("heading", { name: "대회 평가 관리" })).toBeInTheDocument();
    expect(window.localStorage.getItem("grading-program-translation-overrides")).toContain("대회 평가 관리");
  });
});
