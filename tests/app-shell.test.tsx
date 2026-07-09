import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import JudgePage from "@/app/judge/page";
import { AppShell } from "@/components/app-shell";
import { getBaseAppCopy, getRoleLabel } from "@/lib/i18n";
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
  vi.stubEnv("NEXT_PUBLIC_LOCAL_DEV_MODE", "1");
  window.localStorage.clear();
  window.localStorage.setItem("grading-program-language", "en");
  document.documentElement.lang = "";
});

async function renderEnglishShell(ui: React.ReactElement) {
  render(ui);
  await waitFor(() => {
    expect(document.documentElement.lang).toBe("en");
  });
}

describe("AppShell", () => {
  it("routes a judge directly to scoring and persists a scorecard into standings", async () => {
    const user = userEvent.setup();
    await renderEnglishShell(<AppShell initialUser={judgeUser} />);

    const scoring = screen.getByRole("region", { name: "Judge scoring interface" });
    const eventSelection = screen.getByRole("region", { name: "Judge event selection" });
    const sessionSummary = screen.getByText("Session / login");
    const sessionPanel = sessionSummary.closest("details") as HTMLDetailsElement;

    expect(screen.getByRole("heading", { name: "Judge workspace" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Choose team" })).toBeInTheDocument();
    expect(scoring.compareDocumentPosition(eventSelection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(eventSelection.compareDocumentPosition(sessionPanel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Event grading console" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Score breakdown" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Choose team" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Organizer View" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in with Google" })).not.toBeInTheDocument();
    expect(sessionPanel.open).toBe(false);
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();

    await user.click(sessionSummary);
    expect(sessionPanel.open).toBe(true);
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();

    const saveButton = screen.getByRole("button", { name: "Save scorecard" });
    const firstGradeButton = screen.getByRole("button", { name: "Innovation grade A" });
    expect(saveButton.compareDocumentPosition(firstGradeButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Team Helios" }));
    await user.click(screen.getByRole("button", { name: "Innovation grade E" }));

    expect(screen.getByText("Team Helios is selected for scoring.")).toBeInTheDocument();
    const headerActions = document.querySelector(".judge-header-actions") as HTMLElement;
    expect(within(headerActions).getByText("Auto saving...")).toBeInTheDocument();

    const heliosCard = screen.getByRole("button", { name: "Team Helios" });
    await waitFor(() => {
      expect(within(headerActions).getByText("Saved")).toBeInTheDocument();
      expect(within(heliosCard).getByText("Saved")).toBeInTheDocument();
    });

    const notes = screen.getByLabelText("Feedback notes");
    await user.clear(notes);
    await user.type(notes, "Needs a sharper opening and stronger demo pacing.");
    expect(within(headerActions).getByText("Auto saving...")).toBeInTheDocument();
    await waitFor(() => {
      expect(within(headerActions).getByText("Saved")).toBeInTheDocument();
    });
  });

  it("renders the dedicated judge route as a stripped tablet scoring screen", async () => {
    await renderEnglishShell(<JudgePage />);

    const scoring = await screen.findByRole("region", { name: "Judge scoring interface" });
    const eventSelection = screen.getByRole("region", { name: "Judge event selection" });
    const sessionSummary = screen.getByText("Session / login");
    const sessionPanel = sessionSummary.closest("details") as HTMLDetailsElement;

    expect(scoring.compareDocumentPosition(eventSelection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(eventSelection.compareDocumentPosition(sessionPanel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Team Solstice" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Team Helios" })).toBeInTheDocument();
    expect(screen.getAllByText("Saved").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Not scored").length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: "Event grading console" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Score breakdown" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Organizer View" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Developer tools" })).not.toBeInTheDocument();
    expect(sessionPanel.open).toBe(false);
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
  });

  it("routes an organizer to the event builder and clarifies scoring setup", async () => {
    const user = userEvent.setup();
    await renderEnglishShell(<AppShell initialUser={organizerUser} />);

    expect(screen.getByRole("heading", { name: "Event builder" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Weighted scoring summary" })).toBeInTheDocument();

    const eventName = screen.getByLabelText("Event name");
    await user.clear(eventName);
    await user.type(eventName, "Spring Showcase");
    await user.selectOptions(screen.getByLabelText("Scoring model"), "manual");
    await user.click(screen.getByRole("button", { name: "Create event" }));
    expect(screen.getByRole("option", { name: "Spring Showcase" })).toBeInTheDocument();
    expect(eventName).toHaveValue("Spring Showcase");

    expect(screen.getAllByText("Direct score").length).toBeGreaterThan(0);
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
    await user.type(screen.getByLabelText("Paste CSV rows"), '"Team name","Project title"\n"Team CSV","Imported Project"');
    await user.click(screen.getByRole("button", { name: "Import pasted CSV" }));
    expect(await screen.findByText("Imported 1 team(s) from CSV.")).toBeInTheDocument();
    expect(screen.getByText("Team CSV")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add criterion" }));
    expect(screen.getAllByRole("button", { name: /Expand criterion|Collapse criterion/i })).toHaveLength(5);
    expect(screen.getByRole("button", { name: /Collapse criterion 5: Impact/i })).toBeInTheDocument();

    await user.clear(eventName);
    await user.type(eventName, "LaunchPad Demo Night Updated");
    await user.click(screen.getByRole("button", { name: "Save event" }));

    expect(eventName).toHaveValue("LaunchPad Demo Night Updated");
  });

  it("shows organizer judge score review with every judge score and missing scorecard visible", async () => {
    const user = userEvent.setup();
    await renderEnglishShell(<AppShell initialUser={organizerUser} />);

    await user.click(screen.getByRole("tab", { name: "Judge scores" }));

    expect(screen.getByRole("heading", { name: "Judge scores" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Avery Chen" })).toBeInTheDocument();
    expect(screen.getByText("Team Solstice")).toBeInTheDocument();
    expect(screen.getByText("Team Helios")).toBeInTheDocument();
    expect(screen.getAllByText("80.0%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Missing").length).toBeGreaterThan(0);
  });

  it("shows organizer live event monitoring as a judge/team completion flow", async () => {
    const user = userEvent.setup();
    await renderEnglishShell(<AppShell initialUser={organizerUser} />);

    await user.click(screen.getByRole("tab", { name: "Event monitor" }));

    expect(screen.getByRole("heading", { name: "Event monitor" })).toBeInTheDocument();
    expect(screen.getByText("Event completion")).toBeInTheDocument();
    expect(screen.getByText("Team Solstice")).toBeInTheDocument();
    expect(screen.getByText("Team Helios")).toBeInTheDocument();
    expect(screen.getAllByText("Submitted").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Missing").length).toBeGreaterThan(0);
    expect(screen.getByText("Waiting")).toBeInTheDocument();
  });

  it("keeps organizer event draft inputs intact while criteria are edited before creation", async () => {
    const user = userEvent.setup();
    await renderEnglishShell(<AppShell initialUser={organizerUser} />);

    const eventName = screen.getByLabelText("Event name");
    await user.clear(eventName);
    await user.type(eventName, "Organizer Created Event");
    await user.selectOptions(screen.getByLabelText("Event status"), "active");
    await user.selectOptions(screen.getByLabelText("Scoring model"), "manual");
    await user.click(screen.getByRole("button", { name: "Add criterion" }));

    expect(screen.getByLabelText("Event name")).toHaveValue("Organizer Created Event");
    expect(screen.getByLabelText("Event status")).toHaveValue("active");
    expect(screen.getByLabelText("Scoring model")).toHaveValue("manual");

    await user.click(screen.getByRole("button", { name: "Create event" }));

    expect(screen.getByRole("option", { name: "Organizer Created Event" })).toBeInTheDocument();
    expect(screen.getByLabelText("Event name")).toHaveValue("Organizer Created Event");
    expect(screen.getByLabelText("Event status")).toHaveValue("active");
    expect(screen.getByLabelText("Scoring model")).toHaveValue("manual");
  });

  it("lets organizers enable trimming of the highest and lowest judge totals for an event", async () => {
    const user = userEvent.setup();
    await renderEnglishShell(<AppShell initialUser={organizerUser} />);

    const trimScores = screen.getByLabelText("Trim highest and lowest judge totals") as HTMLInputElement;
    expect(trimScores.checked).toBe(false);

    await user.click(trimScores);
    expect(trimScores.checked).toBe(true);

    const eventName = screen.getByLabelText("Event name");
    await user.clear(eventName);
    await user.type(eventName, "Trimmed Event");
    await user.click(screen.getByRole("button", { name: "Create event" }));

    expect(screen.getByRole("option", { name: "Trimmed Event" })).toBeInTheDocument();
    expect((screen.getByLabelText("Trim highest and lowest judge totals") as HTMLInputElement).checked).toBe(true);
  });

  it("lets organizers edit and delete teams", async () => {
    const user = userEvent.setup();
    await renderEnglishShell(<AppShell initialUser={organizerUser} />);

    await user.click(screen.getAllByRole("button", { name: "Edit team" })[0]);
    const teamName = screen.getByLabelText("Team name (Edit team)");
    await user.clear(teamName);
    await user.type(teamName, "Team Solstice Updated");
    await user.click(screen.getByRole("button", { name: "Save team" }));

    expect(screen.getByText("Team Solstice Updated")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Delete team" })[0]);
    expect(screen.queryByText("Team Solstice Updated")).not.toBeInTheDocument();
  });

  it("lets organizers fold and reopen criteria to save space", async () => {
    const user = userEvent.setup();
    await renderEnglishShell(<AppShell initialUser={organizerUser} />);

    const collapseButton = screen.getByRole("button", { name: /Collapse criterion 1: Innovation/i });
    await user.click(collapseButton);

    expect(screen.queryByLabelText("Maximum points")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Expand criterion 1: Innovation/i }));
    expect(screen.getByLabelText("Maximum points")).toBeInTheDocument();
  });

  it("keeps guests in read-only standings", async () => {
    await renderEnglishShell(<AppShell initialUser={guestUser} />);

    expect(screen.getByRole("heading", { name: "Live standings" })).toBeInTheDocument();
    expect(screen.getByText("View only")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save scorecard" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create event" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Developer tools" })).not.toBeInTheDocument();
  });

  it("does not show the Google sign-in action when Firebase is not configured", async () => {
    await renderEnglishShell(<AppShell initialUser={null} />);

    expect(screen.queryByRole("button", { name: "Sign in with Google" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Firebase setup required" })).toBeInTheDocument();
  });

  it("does not use the local developer demo account unless explicitly enabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_LOCAL_DEV_MODE", "0");

    await renderEnglishShell(<AppShell />);

    expect(screen.getByRole("heading", { name: "Live standings" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Developer tools" })).not.toBeInTheDocument();
  });

  it("gives developers tabbed access to all views, including translations", async () => {
    const user = userEvent.setup();
    await renderEnglishShell(<AppShell />);

    expect(screen.getByRole("heading", { name: "Developer tools" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Judge View" }));
    expect(screen.getByRole("heading", { name: "Judge workspace" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Organizer View" }));
    expect(screen.getByRole("heading", { name: "Event builder" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Guest / Standings View" }));
    expect(screen.getByRole("heading", { name: "Live standings" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Developer tools" }));
    expect(screen.getByLabelText("Role for guest@hackweek.dev")).toHaveValue("guest");

    await user.click(screen.getByRole("button", { name: "Translations" }));
    expect(screen.getByRole("heading", { name: "Translation editor" })).toBeInTheDocument();
  });

  it("lets developers open event management from Developer tools and create events", async () => {
    const user = userEvent.setup();
    await renderEnglishShell(<AppShell />);

    expect(screen.getByRole("heading", { name: "Developer tools" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open event builder" }));

    const eventName = screen.getByLabelText("Event name");
    await user.clear(eventName);
    await user.type(eventName, "Developer Created Event");
    await user.selectOptions(screen.getByLabelText("Event status"), "active");
    await user.selectOptions(screen.getByLabelText("Scoring model"), "manual");
    await user.click(screen.getByRole("button", { name: "Create event" }));

    expect(screen.getByRole("option", { name: "Developer Created Event" })).toBeInTheDocument();
    expect(screen.getByLabelText("Event name")).toHaveValue("Developer Created Event");
    expect(screen.getByLabelText("Event status")).toHaveValue("active");
    expect(screen.getByLabelText("Scoring model")).toHaveValue("manual");
  });

  it("downloads participant templates and standings CSV files", async () => {
    const user = userEvent.setup();
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });

    await renderEnglishShell(<AppShell />);

    await user.click(screen.getByRole("button", { name: "Organizer View" }));
    await user.click(screen.getByRole("button", { name: "Download CSV template" }));

    await user.click(screen.getByRole("button", { name: "Guest / Standings View" }));
    await user.click(screen.getByRole("button", { name: "Download results CSV" }));

    expect(downloads).toContain("participant-template.csv");
    expect(downloads).toContain("launchpad-demo-night-results.csv");
  });

  it("switches the shell to Korean", async () => {
    const user = userEvent.setup();
    await renderEnglishShell(<AppShell initialUser={organizerUser} />);

    await user.selectOptions(screen.getByLabelText("Language"), "ko");

    expect(document.documentElement.lang).toBe("ko");
    expect(screen.getByRole("button", { name: "로그아웃" })).toBeInTheDocument();
    expect(screen.getByLabelText("언어")).toHaveValue("ko");
    expect(screen.getByRole("heading", { name: "가중치 계산 요약" })).toBeInTheDocument();
  });

  it("loads saved language after the hydration-safe first render", async () => {
    window.localStorage.setItem("grading-program-language", "en");
    const koCopy = getBaseAppCopy("ko");
    const guestAccountLabel = koCopy.roleAccount(getRoleLabel("guest", "ko"));

    expect(renderToString(<AppShell initialUser={guestUser} />)).toContain(guestAccountLabel);

    render(<AppShell initialUser={guestUser} />);

    await waitFor(() => {
      expect(document.documentElement.lang).toBe("en");
    });
    expect(await screen.findByText("Guest account")).toBeInTheDocument();
  });

  it("lets developers edit translation overrides from the separate translations section", async () => {
    const user = userEvent.setup();
    await renderEnglishShell(<AppShell />);

    await user.click(screen.getByRole("button", { name: "Translations" }));
    await user.selectOptions(screen.getByLabelText("Edit language"), "ko");
    fireEvent.change(screen.getByLabelText("Translation ko appTitle"), { target: { value: "행사 채점 관리" } });
    expect(screen.getByText("Edited")).toBeInTheDocument();
    expect(window.localStorage.getItem("grading-program-translation-overrides")).toContain("행사 채점 관리");
  }, 30000);
});
