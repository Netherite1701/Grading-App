"use client";

import React, { useEffect, useState } from "react";
import { buildStandingsCsv } from "@/lib/export";
import {
  getFirebaseErrorMessage,
  isFirebaseConfigured,
  normalizeRole,
  onFirebaseUserChanged,
  saveFirebaseEvent,
  saveFirebaseParticipant,
  saveFirebaseScorecard,
  signInWithGoogle,
  signOutOfGoogle,
  subscribeToFirebaseAppData,
  updateFirebaseUserRole,
  upsertAuthenticatedUser
} from "@/lib/firebase";
import { demoEvents, demoParticipants, demoScorecards, demoUsers, hydrateScorecards } from "@/lib/mock-data";
import { calculateTotals, clampScore, createRubricLevels, getDefaultScores, getRubricLevelForScore } from "@/lib/scoring";
import {
  editableCopyKeys,
  getAppCopy,
  getBaseAppCopy,
  getRoleLabel,
  languageOptions,
  type AppLanguage,
  type EditableCopyKey,
  type TranslationOverrides
} from "@/lib/i18n";
import type { Criterion, Event, EventStatus, GradingType, Participant, Role, Scorecard, User } from "@/lib/types";

const initialEvents = demoEvents;
const initialScorecards = hydrateScorecards(demoEvents, demoScorecards);

const developerTabs = [
  { id: "judge", labelKey: "judgeViewTab" },
  { id: "organizer", labelKey: "organizerViewTab" },
  { id: "standings", labelKey: "standingsViewTab" },
  { id: "developer", labelKey: "developerToolsTab" }
] as const;

type SectionId = (typeof developerTabs)[number]["id"];

interface AppShellProps {
  initialUser?: User | null;
}

function loadTranslationOverrides(): TranslationOverrides {
  if (typeof window === "undefined") return {};
  try {
    const stored = window.localStorage.getItem("grading-program-translation-overrides");
    return stored ? JSON.parse(stored) as TranslationOverrides : {};
  } catch {
    return {};
  }
}

function getJudgeScorecard(eventId: string, participantId: string, judgeId: string, scorecards: Scorecard[]) {
  return scorecards.find((item) => item.eventId === eventId && item.participantId === participantId && item.judgeId === judgeId);
}

function scoreBadge(score: number) {
  if (score >= 85) return "emerald";
  if (score >= 70) return "indigo";
  if (score >= 55) return "amber";
  return "rose";
}

function defaultSectionForRole(role: Role): SectionId {
  if (role === "developer") return "developer";
  if (role === "organizer") return "organizer";
  if (role === "judge") return "judge";
  return "standings";
}

function createDefaultCriterion(): Criterion {
  return {
    id: `criterion-${Date.now().toString(36)}`,
    name: "Impact",
    description: "Value created by the project or pitch.",
    maxPoints: 5,
    weight: 2,
    rubricLevels: createRubricLevels(5, [
      { points: 5, label: "A", description: "Exceptional value and execution." },
      { points: 4, label: "B", description: "Strong value with only small gaps." },
      { points: 3, label: "C", description: "Solid value with a few weaknesses." },
      { points: 2, label: "D", description: "Limited impact or inconsistent execution." },
      { points: 1, label: "E", description: "Early, unclear, or very limited evidence." }
    ])
  };
}

function createDraftEvent(owner: User | null, draft?: Partial<Pick<Event, "name" | "description" | "status" | "gradingType" | "criteria">>): Event {
  const now = new Date().toISOString();
  const name = draft?.name?.trim() || "Untitled Event";
  const description = draft?.description?.trim() || "New event draft";
  return {
    id: `event-${Date.now().toString(36)}`,
    name,
    description,
    status: draft?.status ?? "draft",
    gradingType: draft?.gradingType ?? "rubric",
    ownerId: owner?.uid ?? "demo-owner",
    ownerEmail: owner?.email ?? "demo@local",
    criteria: draft?.criteria?.length ? draft.criteria : [createDefaultCriterion()],
    createdAt: now,
    updatedAt: now
  };
}

export function AppShell({ initialUser }: AppShellProps) {
  const firebaseAvailable = isFirebaseConfigured();
  const demoDeveloper = demoUsers.find((user) => normalizeRole(user.role) === "developer") ?? null;
  const [language, setLanguage] = useState<AppLanguage>(() => {
    if (typeof window === "undefined") return "en";
    const stored = window.localStorage.getItem("grading-program-language");
    return stored === "ko" ? "ko" : "en";
  });
  const [translationOverrides, setTranslationOverrides] = useState<TranslationOverrides>(() => loadTranslationOverrides());
  const [translationEditorLanguage, setTranslationEditorLanguage] = useState<AppLanguage>("ko");
  const [translationSearch, setTranslationSearch] = useState("");
  const copy = getAppCopy(language, translationOverrides[language]);
  const [authUser, setAuthUser] = useState<User | null>(initialUser === undefined && !firebaseAvailable ? demoDeveloper : initialUser ?? null);
  const [authStatus, setAuthStatus] = useState<string>(firebaseAvailable ? copy.checkingSession : copy.demoMode);
  const [authError, setAuthError] = useState("");
  const [users, setUsers] = useState<User[]>(demoUsers);
  const [events, setEvents] = useState<Event[]>(initialEvents);
  const [activeEventId, setActiveEventId] = useState(initialEvents[0]?.id ?? "");
  const [scorecards, setScorecards] = useState<Scorecard[]>(initialScorecards);
  const [participantsByEvent, setParticipantsByEvent] = useState<Record<string, Participant[]>>(demoParticipants);
  const [selectedParticipantId, setSelectedParticipantId] = useState(participantsByEvent[initialEvents[0]?.id ?? ""]?.[0]?.id ?? "");
  const [notes, setNotes] = useState(initialScorecards[0]?.notes ?? "");
  const [organizerName, setOrganizerName] = useState(initialEvents[0]?.name ?? "");
  const [organizerDescription, setOrganizerDescription] = useState(initialEvents[0]?.description ?? "");
  const [organizerStatus, setOrganizerStatus] = useState<EventStatus>(initialEvents[0]?.status ?? "draft");
  const [organizerGradingType, setOrganizerGradingType] = useState<GradingType>(initialEvents[0]?.gradingType ?? "rubric");
  const [newParticipantName, setNewParticipantName] = useState("");
  const [newParticipantTitle, setNewParticipantTitle] = useState("");
  const [section, setSection] = useState<SectionId>(defaultSectionForRole(normalizeRole(authUser?.role)));

  const role = normalizeRole(authUser?.role);
  const isDeveloper = role === "developer";
  const canJudge = role === "judge" || isDeveloper;
  const canOrganize = role === "organizer" || isDeveloper;
  const activeSection = isDeveloper ? section : defaultSectionForRole(role);
  const activeEvent = events.find((event) => event.id === activeEventId) ?? events[0];
  const participants = participantsByEvent[activeEvent?.id ?? ""] ?? [];
  const selectedParticipant = participants.find((participant) => participant.id === selectedParticipantId) ?? participants[0];
  const judgeId = authUser?.uid ?? "judge-1";
  const existingScorecard = activeEvent && selectedParticipant ? getJudgeScorecard(activeEvent.id, selectedParticipant.id, judgeId, scorecards) : undefined;
  const [draftScores, setDraftScores] = useState<Record<string, number>>(
    existingScorecard?.scores ?? (activeEvent ? getDefaultScores(activeEvent.criteria) : {})
  );

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = language;
    }
    if (typeof window !== "undefined") {
      window.localStorage.setItem("grading-program-language", language);
    }
  }, [language]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("grading-program-translation-overrides", JSON.stringify(translationOverrides));
    }
  }, [translationOverrides]);

  const persistFirebaseWrite = async (write: () => Promise<unknown>) => {
    if (!firebaseAvailable) return;
    try {
      await write();
    } catch (error) {
      setAuthError(getFirebaseErrorMessage(error));
    }
  };

  useEffect(() => {
    if (!firebaseAvailable || initialUser !== undefined) return;
    let unsubscribe: (() => void) | undefined;
    let disposed = false;

    void onFirebaseUserChanged(async (firebaseUser) => {
      if (!firebaseUser) {
        setAuthUser(null);
        setAuthStatus(copy.signedOut);
        setSection("standings");
        return;
      }

      try {
        const persistedUser = await upsertAuthenticatedUser(firebaseUser);
        setAuthUser(persistedUser);
        setUsers((current) => {
          const withoutUser = current.filter((user) => user.uid !== persistedUser.uid);
          return [...withoutUser, persistedUser];
        });
        setSection(defaultSectionForRole(normalizeRole(persistedUser.role)));
        setAuthStatus(copy.signedIn);
      } catch (error) {
        setAuthError(getFirebaseErrorMessage(error));
        setAuthStatus(copy.authError);
      }
    })
      .then((nextUnsubscribe) => {
        if (disposed) {
          nextUnsubscribe();
          return;
        }
        unsubscribe = nextUnsubscribe;
      })
      .catch((error) => {
        setAuthError(getFirebaseErrorMessage(error));
        setAuthStatus(copy.authError);
      });

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [firebaseAvailable, initialUser, language]);

  useEffect(() => {
    if (!firebaseAvailable || !authUser) return;
    let unsubscribe: (() => void) | undefined;
    let disposed = false;

    void subscribeToFirebaseAppData(
      (data) => {
        const nextEvents = data.events.length ? data.events : initialEvents;
        const nextParticipantsByEvent = data.events.length ? data.participantsByEvent : demoParticipants;
        const nextScorecards = data.events.length ? hydrateScorecards(nextEvents, data.scorecards) : initialScorecards;

        setUsers(data.users.length ? data.users : demoUsers);
        setAuthUser((current) => {
          if (!current) return current;
          const snapshotUser = data.users.find((user) => user.uid === current.uid);
          if (!snapshotUser) return current;
          const currentTime = Date.parse(current.updatedAt ?? current.createdAt) || 0;
          const snapshotTime = Date.parse(snapshotUser.updatedAt ?? snapshotUser.createdAt) || 0;
          return snapshotTime >= currentTime ? snapshotUser : current;
        });
        setEvents(nextEvents);
        setParticipantsByEvent(nextParticipantsByEvent);
        setScorecards(nextScorecards);
        setActiveEventId((current) => (nextEvents.some((event) => event.id === current) ? current : nextEvents[0]?.id ?? ""));
      },
      (error) => {
        setAuthError(getFirebaseErrorMessage(error));
      }
    )
      .then((nextUnsubscribe) => {
        if (disposed) {
          nextUnsubscribe();
          return;
        }
        unsubscribe = nextUnsubscribe;
      })
      .catch((error) => {
        setAuthError(getFirebaseErrorMessage(error));
      });

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [firebaseAvailable, authUser?.uid]);

  useEffect(() => {
    setSection(defaultSectionForRole(role));
  }, [role]);

  const summary = activeEvent ? calculateTotals(activeEvent, draftScores) : undefined;
  const leaderboard = activeEvent
    ? participants
        .map((participant) => {
          const participantCards = scorecards.filter((card) => card.eventId === activeEvent.id && card.participantId === participant.id);
          const totalRaw = participantCards.reduce((sum, card) => sum + calculateTotals(activeEvent, card.scores).rawScore, 0);
          const maxScore = participantCards.length * activeEvent.criteria.reduce((sum, criterion) => sum + criterion.maxPoints * criterion.weight, 0);
          const averageScore = maxScore === 0 ? 0 : (totalRaw / maxScore) * 100;

          return {
            participant,
            scorecardCount: participantCards.length,
            averageScore,
            rawScore: totalRaw,
            maxScore,
            criteriaAverages: {}
          };
        })
        .sort((a, b) => b.averageScore - a.averageScore)
    : [];

  const podium = leaderboard.slice(0, 3);
  const csvPreview = activeEvent ? buildStandingsCsv(activeEvent, participants, scorecards).split("\n").slice(0, 5).join("\n") : "";
  const weightedMaxScore = activeEvent?.criteria.reduce((sum, criterion) => sum + criterion.maxPoints * criterion.weight, 0) ?? 0;
  const exampleCriterion = activeEvent?.criteria[0];
  const exampleContribution = exampleCriterion ? exampleCriterion.maxPoints * exampleCriterion.weight : 0;
  const translationBaseCopy = getBaseAppCopy(translationEditorLanguage);
  const translationOverrideValues = translationOverrides[translationEditorLanguage] ?? {};
  const normalizedTranslationSearch = translationSearch.trim().toLowerCase();
  const visibleTranslationKeys = editableCopyKeys.filter((key) => {
    if (!normalizedTranslationSearch) return true;
    const baseValue = translationBaseCopy[key].toLowerCase();
    const overrideValue = translationOverrideValues[key]?.toLowerCase() ?? "";
    return key.toLowerCase().includes(normalizedTranslationSearch) || baseValue.includes(normalizedTranslationSearch) || overrideValue.includes(normalizedTranslationSearch);
  });

  const updateTranslationOverride = (targetLanguage: AppLanguage, key: EditableCopyKey, nextValue: string) => {
    const baseValue = getBaseAppCopy(targetLanguage)[key];
    setTranslationOverrides((current) => {
      const nextLanguageOverrides = { ...(current[targetLanguage] ?? {}) };
      if (nextValue === baseValue) {
        delete nextLanguageOverrides[key];
      } else {
        nextLanguageOverrides[key] = nextValue;
      }

      return {
        ...current,
        [targetLanguage]: nextLanguageOverrides
      };
    });
  };

  const resetTranslationOverride = (targetLanguage: AppLanguage, key: EditableCopyKey) => {
    setTranslationOverrides((current) => {
      const nextLanguageOverrides = { ...(current[targetLanguage] ?? {}) };
      delete nextLanguageOverrides[key];
      return {
        ...current,
        [targetLanguage]: nextLanguageOverrides
      };
    });
  };

  const resetLanguageOverrides = (targetLanguage: AppLanguage) => {
    setTranslationOverrides((current) => ({
      ...current,
      [targetLanguage]: {}
    }));
  };

  const syncEventForm = (event: Event) => {
    setOrganizerName(event.name);
    setOrganizerDescription(event.description ?? "");
    setOrganizerStatus(event.status);
    setOrganizerGradingType(event.gradingType);
  };

  const selectParticipant = (participantId: string) => {
    if (!activeEvent) return;
    const nextParticipant = participants.find((participant) => participant.id === participantId) ?? participants[0];
    if (!nextParticipant) return;
    setSelectedParticipantId(nextParticipant.id);
    const card = getJudgeScorecard(activeEvent.id, nextParticipant.id, judgeId, scorecards);
    setDraftScores(card?.scores ?? getDefaultScores(activeEvent.criteria));
    setNotes(card?.notes ?? "");
  };

  useEffect(() => {
    if (!activeEvent) return;
    syncEventForm(activeEvent);
    const nextParticipants = participantsByEvent[activeEvent.id] ?? [];
    const nextParticipantId = nextParticipants.some((participant) => participant.id === selectedParticipantId)
      ? selectedParticipantId
      : nextParticipants[0]?.id ?? "";
    setSelectedParticipantId(nextParticipantId);
    const scorecard = nextParticipantId ? getJudgeScorecard(activeEvent.id, nextParticipantId, judgeId, scorecards) : undefined;
    setDraftScores(scorecard?.scores ?? getDefaultScores(activeEvent.criteria));
    setNotes(scorecard?.notes ?? "");
  }, [activeEventId, activeEvent?.updatedAt]);

  const updateSelectedEvent = (eventId: string) => {
    const nextEvent = events.find((event) => event.id === eventId);
    setActiveEventId(eventId);
    if (nextEvent) {
      syncEventForm(nextEvent);
      const nextParticipants = participantsByEvent[eventId] ?? [];
      const nextParticipantId = nextParticipants[0]?.id ?? "";
      setSelectedParticipantId(nextParticipantId);
      if (nextParticipantId) {
        const scorecard = getJudgeScorecard(eventId, nextParticipantId, judgeId, scorecards);
        setDraftScores(scorecard?.scores ?? getDefaultScores(nextEvent.criteria));
        setNotes(scorecard?.notes ?? "");
      } else {
        setDraftScores(getDefaultScores(nextEvent.criteria));
        setNotes("");
      }
    }
  };

  const createEvent = () => {
    if (!canOrganize) return;
    const nextEvent = createDraftEvent(authUser, {
      name: organizerName,
      description: organizerDescription,
      status: organizerStatus,
      gradingType: organizerGradingType,
      criteria: activeEvent?.criteria.map((criterion) => ({ ...criterion })) ?? [createDefaultCriterion()]
    });
    setEvents((current) => [nextEvent, ...current]);
    setParticipantsByEvent((current) => ({ ...current, [nextEvent.id]: [] }));
    setActiveEventId(nextEvent.id);
    setSelectedParticipantId("");
    setDraftScores(getDefaultScores(nextEvent.criteria));
    syncEventForm(nextEvent);
    void persistFirebaseWrite(() => saveFirebaseEvent(nextEvent));
  };

  const updateCriterion = (criterionId: string, patch: Partial<Criterion>) => {
    if (!activeEvent || !canOrganize) return;
    const nextCriteria = activeEvent.criteria.map((criterion) => (criterion.id === criterionId ? { ...criterion, ...patch } : criterion));
    setEvents((current) =>
      current.map((event) =>
        event.id === activeEvent.id
          ? {
              ...event,
              criteria: nextCriteria,
              updatedAt: new Date().toISOString()
            }
          : event
      )
    );
  };

  const updateRubricLevel = (criterionId: string, index: number, patch: Partial<NonNullable<Criterion["rubricLevels"]>[number]>) => {
    if (!activeEvent || !canOrganize) return;
    const nextCriteria = activeEvent.criteria.map((criterion) => {
      if (criterion.id !== criterionId) return criterion;
      const rubricLevels = createRubricLevels(criterion.maxPoints, criterion.rubricLevels);
      return {
        ...criterion,
        rubricLevels: rubricLevels.map((level, levelIndex) => (levelIndex === index ? { ...level, ...patch } : level))
      };
    });
    setEvents((current) =>
      current.map((event) =>
        event.id === activeEvent.id
          ? {
              ...event,
              criteria: nextCriteria,
              updatedAt: new Date().toISOString()
            }
          : event
      )
    );
  };

  const addCriterion = () => {
    if (!activeEvent || !canOrganize) return;
    const nextCriterion = createDefaultCriterion();
    const nextEvent = {
      ...activeEvent,
      criteria: [...activeEvent.criteria, nextCriterion],
      updatedAt: new Date().toISOString()
    };
    setEvents((current) => current.map((event) => (event.id === activeEvent.id ? nextEvent : event)));
    void persistFirebaseWrite(() => saveFirebaseEvent(nextEvent));
  };

  const saveJudgeScorecard = () => {
    if (!activeEvent || !selectedParticipant || !canJudge) return;

    const totalScore = calculateTotals(activeEvent, draftScores).rawScore;
    const nextCard: Scorecard = {
      id: `${authUser?.uid ?? "judge-1"}_${selectedParticipant.id}`,
      eventId: activeEvent.id,
      participantId: selectedParticipant.id,
      judgeId: authUser?.uid ?? "judge-1",
      judgeName: authUser?.displayName ?? "Avery Chen",
      judgeEmail: authUser?.email ?? "judge1@hackweek.dev",
      scores: { ...draftScores },
      totalScore,
      notes,
      updatedAt: new Date().toISOString()
    };

    setScorecards((current) => {
      const filtered = current.filter((item) => item.id !== nextCard.id);
      return [...filtered, nextCard];
    });
    void persistFirebaseWrite(() => saveFirebaseScorecard(nextCard));
  };

  const addParticipant = () => {
    if (!activeEvent || !newParticipantName.trim() || !canOrganize) return;

    const nextParticipant: Participant = {
      id: `${newParticipantName.toLowerCase().replace(/\s+/g, "-")}-${Date.now().toString(36)}`,
      name: newParticipantName.trim(),
      title: newParticipantTitle.trim() || undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    setParticipantsByEvent((current) => ({
      ...current,
      [activeEvent.id]: [...(current[activeEvent.id] ?? []), nextParticipant]
    }));
    setSelectedParticipantId(nextParticipant.id);
    setNewParticipantName("");
    setNewParticipantTitle("");
    void persistFirebaseWrite(() => saveFirebaseParticipant(activeEvent.id, nextParticipant));
  };

  const saveOrganizerChanges = () => {
    if (!activeEvent || !canOrganize) return;
    const nextEvent = {
      ...activeEvent,
      name: organizerName,
      description: organizerDescription,
      status: organizerStatus,
      gradingType: organizerGradingType,
      updatedAt: new Date().toISOString()
    };
    setEvents((current) =>
      current.map((event) => (event.id === activeEvent.id ? nextEvent : event))
    );
    void persistFirebaseWrite(() => saveFirebaseEvent(nextEvent));
  };

  const changeUserRole = (uid: string, nextRole: Role) => {
    if (!isDeveloper) return;
    const updatedAt = new Date().toISOString();
    setUsers((current) => current.map((user) => (user.uid === uid ? { ...user, role: nextRole, updatedAt } : user)));
    if (authUser?.uid === uid) {
      setAuthUser({ ...authUser, role: nextRole, updatedAt });
    }
    void persistFirebaseWrite(() => updateFirebaseUserRole(uid, nextRole));
  };

  const handleSignIn = async () => {
    setAuthError("");
    try {
      const firebaseUser = await signInWithGoogle();
      const persistedUser = await upsertAuthenticatedUser(firebaseUser);
      setAuthUser(persistedUser);
      setUsers((current) => {
        const withoutUser = current.filter((user) => user.uid !== persistedUser.uid);
        return [...withoutUser, persistedUser];
      });
      setSection(defaultSectionForRole(normalizeRole(persistedUser.role)));
      setAuthStatus(copy.signedIn);
    } catch (error) {
      setAuthError(getFirebaseErrorMessage(error));
      setAuthStatus(copy.authError);
    }
  };

  const handleSignOut = async () => {
    setAuthError("");
    if (firebaseAvailable) {
      await signOutOfGoogle();
    }
    setAuthUser(firebaseAvailable ? null : demoDeveloper);
    setSection(firebaseAvailable ? "standings" : "developer");
    setAuthStatus(firebaseAvailable ? copy.signedOut : copy.demoMode);
  };

  return (
    <main className="app-shell">
      <header className="hero panel">
        <div className="panel-inner">
          <span className="eyebrow">
            <span className="status-dot" />
            {copy.roleAccount(getRoleLabel(role, language))}
          </span>
          <h1>{copy.appTitle}</h1>
          <p>{copy.appDescription}</p>
          <div className="hero-grid">
            <div className="metric">
              <span>{copy.selectedEvent}</span>
              <strong>{activeEvent?.name ?? copy.noEventSelected}</strong>
            </div>
            <div className="metric">
              <span>{copy.role}</span>
              <strong>{getRoleLabel(role, language)}</strong>
            </div>
            <div className="metric">
              <span>{copy.teams}</span>
              <strong>{participants.length}</strong>
            </div>
            <div className="metric">
              <span>{copy.maximumWeightedScore}</span>
              <strong>{weightedMaxScore.toFixed(1)}</strong>
            </div>
          </div>
        </div>
        <div className="panel-inner">
          <div className="stack">
            <div className="criterion-card">
              <div className="section-header">
                <div>
                  <h2>{authUser?.displayName ?? copy.demoSession}</h2>
                  <p>{authUser?.email ?? authStatus}</p>
                </div>
                <span className={`badge ${firebaseAvailable ? "emerald" : "amber"}`}>{firebaseAvailable ? copy.firebase : copy.local}</span>
              </div>
              {authError ? <div className="footer-note">{authError}</div> : null}
              <div className="button-row">
                {!authUser ? (
                  <button className="button" onClick={handleSignIn} disabled={!firebaseAvailable}>
                    {copy.signIn}
                  </button>
                ) : null}
                {authUser ? (
                  <button className="button secondary" onClick={handleSignOut}>
                    {copy.signOut}
                  </button>
                ) : null}
              </div>
              <div className="footer-note">
                {authUser ? copy.signedInNotice : copy.signInNotice}
              </div>
              {!firebaseAvailable ? <div className="footer-note">{copy.firebaseMissing}</div> : null}
              <div className="field" style={{ marginTop: 12 }}>
                <label className="label" htmlFor="language-select">
                  {copy.language}
                </label>
                <select id="language-select" className="select" value={language} onChange={(event) => setLanguage(event.target.value as AppLanguage)}>
                  {languageOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>
      </header>

      <section className="layout">
        <aside className="sidebar">
          {isDeveloper ? (
            <div className="panel">
              <div className="panel-inner">
                <div className="section-header">
                  <div>
                    <h2>{copy.developerTabs}</h2>
                    <p>{copy.developerTabsHelp}</p>
                  </div>
                </div>
                <div className="nav-list">
                  {developerTabs.map((item) => (
                    <button key={item.id} className={`nav-button ${activeSection === item.id ? "active" : ""}`} onClick={() => setSection(item.id)}>
                      {copy[item.labelKey]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          <div className="panel">
            <div className="panel-inner stack">
                <div className="section-header">
                  <div>
                    <h2>{copy.currentEvent}</h2>
                    <p>{role === "guest" ? copy.currentEventGuestHelp : copy.currentEventHelp}</p>
                  </div>
                </div>
              <select className="select" value={activeEventId} onChange={(event) => updateSelectedEvent(event.target.value)}>
                {events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.name}
                  </option>
                ))}
              </select>
              <div className="footer-note">{activeEvent?.description}</div>
            </div>
          </div>
        </aside>

        <div className="section-stack">
          {activeSection === "judge" && activeEvent && selectedParticipant && canJudge ? (
            <div className="grid-2">
              <div className="panel">
                <div className="panel-inner stack">
                  <div className="section-header">
                    <div>
                      <h2>{copy.judgeWorkspace}</h2>
                      <p>{copy.judgeSelected(selectedParticipant.name)}</p>
                    </div>
                    <span className="score-pill">{summary?.averageScore.toFixed(1) ?? "0.0"}%</span>
                  </div>
                  <div>
                    <label className="label" htmlFor="judge-team-select">
                      {copy.chooseTeam}
                    </label>
                    <select
                      id="judge-team-select"
                      className="select"
                      value={selectedParticipant.id}
                      onChange={(event) => selectParticipant(event.target.value)}
                    >
                      {participants.map((participant) => (
                        <option key={participant.id} value={participant.id}>
                          {participant.name}
                          {participant.title ? ` - ${participant.title}` : ""}
                        </option>
                      ))}
                    </select>
                    <div className="footer-note" style={{ marginTop: 8 }}>
                      {copy.tabletHelp}
                    </div>
                  </div>
                  <div className="chip-row">
                    {participants.map((participant) => (
                      <button
                        key={participant.id}
                        className={`chip ${participant.id === selectedParticipant.id ? "active" : ""}`}
                        onClick={() => selectParticipant(participant.id)}
                      >
                        {participant.name}
                      </button>
                    ))}
                  </div>
                  <div className="criteria-list">
                    {activeEvent.criteria.map((criterion) => {
                      const current = draftScores[criterion.id] ?? 0;
                      const max = criterion.maxPoints;
                      const isRubric = activeEvent.gradingType === "rubric";
                      const rubricLevels = createRubricLevels(max, criterion.rubricLevels);
                      const selectedRubricLevel = isRubric && current > 0 ? getRubricLevelForScore(max, current, criterion.rubricLevels) : undefined;

                      return (
                        <div className="criterion-card" key={criterion.id}>
                          <div className="criterion-top">
                            <div>
                              <strong>{criterion.name}</strong>
                              <span>{criterion.description}</span>
                            </div>
                            <span className="badge indigo">{criterion.maxPoints} pts</span>
                          </div>
                          {isRubric ? (
                            <div className="footer-note" style={{ marginTop: 10 }}>
                              {copy.chooseLetterHelp}
                            </div>
                          ) : null}
                          {isRubric ? (
                            <div className="chip-row" style={{ marginTop: 12 }}>
                              {rubricLevels.map((level) => (
                                <button
                                  key={`${criterion.id}-${level.label}`}
                                  type="button"
                                  aria-label={`${criterion.name} grade ${level.label}`}
                                  aria-pressed={selectedRubricLevel?.label === level.label}
                                  className={`chip ${selectedRubricLevel?.label === level.label ? "active" : ""}`}
                                  onClick={() =>
                                    setDraftScores((value) => ({
                                      ...value,
                                      [criterion.id]: clampScore(level.points, max)
                                    }))
                                  }
                                >
                                  {level.label}
                                </button>
                              ))}
                            </div>
                          ) : null}
                          {isRubric ? (
                            <div className="footer-note" style={{ marginTop: 8 }}>
                              {selectedRubricLevel?.description ?? copy.selectLetterPrompt}
                            </div>
                          ) : null}
                          <div className="range-row">
                            {isRubric ? (
                              <div className="field" aria-live="polite" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                <span>{copy.selectedGrade}</span>
                                <strong>{selectedRubricLevel?.label ?? "Not set"}</strong>
                              </div>
                            ) : (
                              <>
                                <input
                                  className="range"
                                  type="range"
                                  min={0}
                                  max={max}
                                  step={0.5}
                                  value={current}
                                  onChange={(event) =>
                                    setDraftScores((value) => ({
                                      ...value,
                                      [criterion.id]: clampScore(Number(event.target.value), max)
                                    }))
                                  }
                                />
                                <input
                                  className="field"
                                  type="number"
                                  min={0}
                                  max={max}
                                  step={0.5}
                                  value={current}
                                  onChange={(event) =>
                                    setDraftScores((value) => ({
                                      ...value,
                                      [criterion.id]: clampScore(Number(event.target.value), max)
                                    }))
                                  }
                                />
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div>
                    <label className="label" htmlFor="judge-notes">
                      {copy.feedbackNotes}
                    </label>
                    <textarea id="judge-notes" className="textarea" maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} />
                    <div className="footer-note">{notes.length}/2000 characters</div>
                  </div>
                  <div className="button-row">
                    <button className="button" onClick={saveJudgeScorecard}>
                      {copy.saveScorecard}
                    </button>
                    <button className="button secondary" onClick={() => setDraftScores(getDefaultScores(activeEvent.criteria))}>
                      {copy.resetScores}
                    </button>
                  </div>
                </div>
              </div>

              <div className="panel">
                <div className="panel-inner stack">
                  <div className="section-header">
                    <div>
                      <h2>{copy.scoreBreakdown}</h2>
                      <p>{copy.scoreBreakdownDesc}</p>
                    </div>
                  </div>
                  <div className="grid-3">
                    <div className="metric">
                      <span>{copy.currentWeightedScore}</span>
                      <strong>{summary?.rawScore.toFixed(1) ?? "0.0"}</strong>
                    </div>
                    <div className="metric">
                      <span>{copy.completion}</span>
                      <strong>{summary?.completion.toFixed(0) ?? "0"}%</strong>
                    </div>
                    <div className="metric">
                      <span>{copy.maximumWeightedScorePanel}</span>
                      <strong>{summary?.maxScore.toFixed(1) ?? "0.0"}</strong>
                    </div>
                  </div>
                  <div className="footer-note">{copy.completionHelp}</div>
                </div>
              </div>
            </div>
          ) : null}

          {activeSection === "organizer" && activeEvent && canOrganize ? (
            <div className="grid-2">
              <div className="panel">
                <div className="panel-inner stack">
                  <div className="section-header">
                    <div>
                      <h2>{copy.eventBuilder}</h2>
                      <p>{copy.eventBuilderDesc}</p>
                    </div>
                    <button className="button" onClick={createEvent}>
                      {copy.createEvent}
                    </button>
                  </div>
                  <div className="grid-2">
                    <div>
                      <label className="label" htmlFor="event-name">
                        {copy.eventName}
                      </label>
                      <input id="event-name" className="field" value={organizerName} onChange={(event) => setOrganizerName(event.target.value)} />
                    </div>
                    <div>
                      <label className="label" htmlFor="event-status">
                        {copy.eventStatus}
                      </label>
                      <select id="event-status" className="select" value={organizerStatus} onChange={(event) => setOrganizerStatus(event.target.value as EventStatus)}>
                        <option value="draft">{copy.draft}</option>
                        <option value="active">{copy.active}</option>
                        <option value="completed">{copy.completed}</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="label" htmlFor="event-description">
                      {copy.description}
                    </label>
                    <textarea id="event-description" className="textarea" value={organizerDescription} onChange={(event) => setOrganizerDescription(event.target.value)} />
                  </div>
                  <div className="criterion-card">
                    <div className="criterion-top">
                      <div>
                        <strong>{copy.scoringModel}</strong>
                        <span>{copy.scoringModelDesc}</span>
                      </div>
                      <select
                        aria-label={copy.scoringModel}
                        className="select"
                        value={organizerGradingType}
                        onChange={(event) => setOrganizerGradingType(event.target.value as GradingType)}
                        style={{ maxWidth: 220 }}
                      >
                        <option value="rubric">{copy.rubricScaleOption}</option>
                        <option value="manual">{copy.directScore}</option>
                      </select>
                    </div>
                  </div>
                  <div className="criteria-list">
                    {activeEvent.criteria.map((criterion) => (
                      <div className="criterion-card" key={criterion.id}>
                        <div className="grid-2">
                          <div>
                            <label className="label" htmlFor={`${criterion.id}-name`}>
                              {copy.criterionName}
                            </label>
                            <input id={`${criterion.id}-name`} className="field" value={criterion.name} onChange={(event) => updateCriterion(criterion.id, { name: event.target.value })} />
                          </div>
                          <div>
                            <label className="label" htmlFor={`${criterion.id}-description`}>
                              {copy.criterionDescription}
                            </label>
                            <input
                              id={`${criterion.id}-description`}
                              className="field"
                              value={criterion.description ?? ""}
                              onChange={(event) => updateCriterion(criterion.id, { description: event.target.value })}
                            />
                          </div>
                        </div>
                          <div className="grid-2" style={{ marginTop: 12 }}>
                            <div>
                              <label className="label" htmlFor={`${criterion.id}-max`}>
                                {copy.maxPoints}
                              </label>
                            <input
                              id={`${criterion.id}-max`}
                              className="field"
                              type="number"
                              min={1}
                              value={criterion.maxPoints}
                              onChange={(event) => updateCriterion(criterion.id, { maxPoints: Math.max(1, Number(event.target.value)) })}
                            />
                            </div>
                            <div>
                              <label className="label" htmlFor={`${criterion.id}-weight`}>
                              {copy.weightMultiplier}
                              </label>
                            <input
                              id={`${criterion.id}-weight`}
                              className="field"
                              type="number"
                              min={1}
                              max={10}
                              value={criterion.weight}
                              onChange={(event) => updateCriterion(criterion.id, { weight: Math.max(1, Math.min(10, Number(event.target.value))) })}
                              />
                            </div>
                          </div>
                          {organizerGradingType === "rubric" ? (
                            <div className="stack" style={{ marginTop: 12 }}>
                              <div className="footer-note">{copy.rubricHelp}</div>
                              <div className="criteria-list">
                                {createRubricLevels(criterion.maxPoints, criterion.rubricLevels).map((level, index) => (
                                  <div className="criterion-card" key={`${criterion.id}-${level.label}`}>
                                    <div className="criterion-top">
                                      <div>
                                        <strong>
                                          {level.label} {level.points}/{criterion.maxPoints}
                                        </strong>
                                        <span>{copy.editableRubricGuidance}</span>
                                      </div>
                                      <span className="badge emerald">{copy.rubricLevel}</span>
                                    </div>
                                    <input
                                      className="field"
                                      value={level.description ?? ""}
                                      aria-label={`${criterion.name} rubric ${level.label} description`}
                                      onChange={(event) => updateRubricLevel(criterion.id, index, { description: event.target.value })}
                                      placeholder="Describe what this level means"
                                      style={{ marginTop: 12 }}
                                    />
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ))}
                  </div>
                  <div className="button-row">
                    <button className="button secondary" onClick={addCriterion}>
                      {copy.addCriterion}
                    </button>
                    <button className="button" onClick={saveOrganizerChanges}>
                      {copy.saveEvent}
                    </button>
                  </div>
                </div>
              </div>

              <div className="panel">
                <div className="panel-inner stack">
                  <div className="section-header">
                    <div>
                      <h2>{copy.scoringPreview}</h2>
                      <p>{copy.scoringPreviewDesc}</p>
                    </div>
                  </div>
                  <div className="grid-3">
                    <div className="metric">
                      <span>{copy.maximumWeightedScorePanel}</span>
                      <strong>{weightedMaxScore.toFixed(1)}</strong>
                    </div>
                    <div className="metric">
                      <span>{copy.exampleWeightedPoints}</span>
                      <strong>{exampleContribution.toFixed(1)}</strong>
                    </div>
                    <div className="metric">
                      <span>{copy.scoringMode}</span>
                      <strong>{organizerGradingType === "rubric" ? "Rubric" : "Direct"}</strong>
                    </div>
                  </div>
                  <div className="criterion-card">
                    <div className="section-header">
                      <div>
                        <h2>{copy.addTeam}</h2>
                        <p>{copy.addTeamDesc}</p>
                      </div>
                    </div>
                    <div className="grid-2">
                      <div>
                        <label className="label" htmlFor="participant-name">
                          {copy.teamName}
                        </label>
                        <input id="participant-name" className="field" value={newParticipantName} onChange={(event) => setNewParticipantName(event.target.value)} />
                      </div>
                      <div>
                        <label className="label" htmlFor="participant-title">
                          {copy.projectTitle}
                        </label>
                        <input id="participant-title" className="field" value={newParticipantTitle} onChange={(event) => setNewParticipantTitle(event.target.value)} />
                      </div>
                    </div>
                    <div className="footer-note" style={{ marginTop: 8 }}>
                      {copy.teamAdded}
                    </div>
                    <div className="button-row" style={{ marginTop: 12 }}>
                      <button className="button secondary" onClick={addParticipant} disabled={!newParticipantName.trim()}>
                        {copy.addTeamButton}
                      </button>
                    </div>
                  </div>
                  <div className="criteria-list">
                    {participants.map((participant) => (
                      <div className="criterion-card" key={participant.id}>
                        <div className="criterion-top">
                          <div>
                            <strong>{participant.name}</strong>
                            <span>{participant.title}</span>
                          </div>
                          <span className="badge emerald">{copy.ready}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {activeSection === "standings" && activeEvent ? (
            <div className="panel">
              <div className="panel-inner stack">
                <div className="section-header">
                  <div>
                    <h2>{copy.standings}</h2>
                    <p>{copy.standingsDesc}</p>
                  </div>
                  {role === "guest" ? <span className="badge amber">{copy.viewOnly}</span> : null}
                </div>
                <div className="podium">
                  {podium.map((row, index) => (
                    <div className="podium-card" key={row.participant.id}>
                      <div className="rank">#{index + 1}</div>
                      <span className={`badge ${index === 0 ? "emerald" : index === 1 ? "indigo" : "amber"}`}>{row.averageScore.toFixed(1)}%</span>
                      <strong>{row.participant.name}</strong>
                      <p>{row.participant.title}</p>
                    </div>
                  ))}
                </div>
                <table className="table">
                  <thead>
                    <tr>
                      <th>{copy.rank}</th>
                      <th>{copy.team}</th>
                      <th>{copy.judgments}</th>
                      <th>{copy.averagePercent}</th>
                      <th>{copy.rawScore}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.map((row, index) => (
                      <tr key={row.participant.id}>
                        <td>{index + 1}</td>
                        <td>
                          <strong>{row.participant.name}</strong>
                          <div className="footer-note">{row.participant.title}</div>
                        </td>
                        <td>{row.scorecardCount}</td>
                        <td>{row.averageScore.toFixed(1)}%</td>
                        <td>
                          {row.rawScore.toFixed(1)} / {row.maxScore.toFixed(1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {activeSection === "developer" && isDeveloper ? (
            <div className="grid-2">
              <div className="panel">
                <div className="panel-inner stack">
                  <div className="section-header">
                    <div>
                      <h2>{copy.developerTools}</h2>
                      <p>{copy.roleAssignment}</p>
                    </div>
                  </div>
                  <div className="criteria-list">
                    {users.map((user) => {
                      const userRole = normalizeRole(user.role);
                      return (
                        <div className="criterion-card" key={user.uid}>
                          <div className="criterion-top">
                            <div>
                              <strong>{user.displayName ?? user.email}</strong>
                              <span>{user.email}</span>
                            </div>
                            <select aria-label={copy.roleForUser(user.email)} className="select" value={userRole} onChange={(event) => changeUserRole(user.uid, event.target.value as Role)} style={{ maxWidth: 180 }}>
                              <option value="guest">{copy.guest}</option>
                              <option value="judge">{copy.judge}</option>
                              <option value="organizer">{copy.organizer}</option>
                              <option value="developer">{copy.developer}</option>
                            </select>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div className="panel">
                <div className="panel-inner stack">
                  <div className="section-header">
                    <div>
                      <h2>{copy.diagnostics}</h2>
                      <p>{copy.diagnosticsHelp}</p>
                    </div>
                  </div>
                  <div className="grid-3">
                    <div className="metric">
                      <span>{copy.firebaseStatus}</span>
                      <strong>{firebaseAvailable ? copy.ready : copy.demo}</strong>
                    </div>
                    <div className="metric">
                      <span>{copy.events}</span>
                      <strong>{events.length}</strong>
                    </div>
                    <div className="metric">
                      <span>{copy.scorecards}</span>
                      <strong>{scorecards.length}</strong>
                    </div>
                  </div>
                  <pre className="criterion-card" style={{ overflowX: "auto", whiteSpace: "pre-wrap", margin: 0 }}>
                    {csvPreview}
                  </pre>
                </div>
              </div>
              <div className="panel">
                <div className="panel-inner stack">
                  <div className="section-header">
                    <div>
                      <h2>Translation editor</h2>
                      <p>Edit browser-local UI text overrides.</p>
                    </div>
                    <button className="button secondary" onClick={() => resetLanguageOverrides(translationEditorLanguage)}>
                      Reset language
                    </button>
                  </div>
                  <div className="grid-2">
                    <div>
                      <label className="label" htmlFor="translation-language">
                        Edit language
                      </label>
                      <select id="translation-language" className="select" value={translationEditorLanguage} onChange={(event) => setTranslationEditorLanguage(event.target.value as AppLanguage)}>
                        {languageOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="label" htmlFor="translation-search">
                        Search translations
                      </label>
                      <input
                        id="translation-search"
                        className="field"
                        value={translationSearch}
                        onChange={(event) => setTranslationSearch(event.target.value)}
                        placeholder="Search by key or text"
                      />
                    </div>
                  </div>
                  <div className="criteria-list">
                    {visibleTranslationKeys.map((key) => {
                      const baseValue = translationBaseCopy[key];
                      const currentValue = translationOverrideValues[key] ?? baseValue;
                      const isEdited = currentValue !== baseValue;
                      const fieldId = `translation-${translationEditorLanguage}-${key}`;

                      return (
                        <div className="criterion-card" key={key}>
                          <div className="criterion-top">
                            <div>
                              <strong>{key}</strong>
                              <span>{isEdited ? "Edited" : "Default"}</span>
                            </div>
                            <button className="button secondary" onClick={() => resetTranslationOverride(translationEditorLanguage, key)} disabled={!isEdited}>
                              Reset
                            </button>
                          </div>
                          <label className="label" htmlFor={fieldId} style={{ marginTop: 12 }}>
                            Current text
                          </label>
                          <textarea
                            id={fieldId}
                            className="textarea"
                            value={currentValue}
                            aria-label={`Translation ${translationEditorLanguage} ${key}`}
                            onChange={(event) => updateTranslationOverride(translationEditorLanguage, key, event.target.value)}
                          />
                          <div className="footer-note">Default: {baseValue}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
