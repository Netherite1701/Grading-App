"use client";

import React, { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { buildParticipantTemplateCsv, buildStandingsCsv, parseParticipantsCsv } from "@/lib/export";
import {
  assertAuthorizedAppUser,
  createNewUserRecord,
  deleteFirebaseParticipant,
  getFirebaseErrorMessage,
  isFirebaseConfigured,
  normalizeRole,
  onFirebaseUserChanged,
  saveFirebaseEvent,
  saveFirebaseParticipant,
  saveFirebaseScorecard,
  saveFirebaseTranslationOverrides,
  signInWithTeacherQr,
  signInWithGoogle,
  signOutOfGoogle,
  subscribeToFirebaseAppData,
  updateFirebaseUserRole,
  upsertAuthenticatedUser,
  upsertTeacherQrUser
} from "@/lib/firebase";
import { demoEvents, demoParticipants, demoScorecards, demoUsers, hydrateScorecards } from "@/lib/mock-data";
import { buildLeaderboardRow, calculateTotals, clampScore, createRubricLevels, getDefaultScores, getRubricLevelForScore } from "@/lib/scoring";
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
  { id: "developer", labelKey: "developerToolsTab" },
  { id: "translations", labelKey: "translationsTab" }
] as const;

const organizerTabs = [
  { id: "setup", label: "Event setup" },
  { id: "scores", label: "Judge scores" },
  { id: "monitor", label: "Event monitor" }
] as const;

type SectionId = (typeof developerTabs)[number]["id"];
type OrganizerTabId = (typeof organizerTabs)[number]["id"];
type AppSurface = "console" | "judge";

interface AppShellProps {
  initialUser?: User | null;
  surface?: AppSurface;
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

function createDraftEvent(owner: User | null, draft?: Partial<Pick<Event, "name" | "description" | "status" | "gradingType" | "dropHighestAndLowestJudgeScores" | "hideRubricDescriptions" | "criteria">>): Event {
  const now = new Date().toISOString();
  const name = draft?.name?.trim() || "Untitled Event";
  const description = draft?.description?.trim() || "New event draft";
  return {
    id: `event-${Date.now().toString(36)}`,
    name,
    description,
    status: draft?.status ?? "draft",
    gradingType: draft?.gradingType ?? "rubric",
    dropHighestAndLowestJudgeScores: draft?.dropHighestAndLowestJudgeScores ?? false,
    hideRubricDescriptions: draft?.hideRubricDescriptions ?? false,
    ownerId: owner?.uid ?? "demo-owner",
    ownerEmail: owner?.email ?? "demo@local",
    criteria: draft?.criteria?.length ? draft.criteria : [createDefaultCriterion()],
    createdAt: now,
    updatedAt: now
  };
}

function createCsvFileName(name: string, suffix: string) {
  const safeName = name.trim().toLowerCase().replace(/[^a-z0-9가-힣]+/g, "-").replace(/^-+|-+$/g, "") || "event";
  return `${safeName}-${suffix}.csv`;
}

function downloadCsvFile(fileName: string, csv: string) {
  if (typeof document === "undefined") return;

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const canUseBlobUrl = typeof URL !== "undefined" && typeof URL.createObjectURL === "function";
  const url = canUseBlobUrl ? URL.createObjectURL(blob) : `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();

  if (canUseBlobUrl) {
    URL.revokeObjectURL(url);
  }
}

function readCsvFile(file: File) {
  if (typeof file.text === "function") {
    return file.text();
  }

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("The CSV file could not be read."));
    reader.readAsText(file);
  });
}

function getTeacherQrRequest() {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  if (params.get("teacherQr") !== "1") return null;

  return {
    eventId: params.get("eventId") ?? "",
    teacherName: params.get("teacherName") ?? ""
  };
}

function buildTeacherQrLoginUrl(eventId: string, teacherName: string) {
  if (typeof window === "undefined" || !eventId) return "";
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("teacherQr", "1");
  url.searchParams.set("eventId", eventId);
  if (teacherName.trim()) {
    url.searchParams.set("teacherName", teacherName.trim());
  }
  return url.toString();
}

function canUseLocalDemoAccount() {
  if (typeof window === "undefined") return false;
  if (process.env.NEXT_PUBLIC_LOCAL_DEV_MODE !== "1") return false;
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

export function AppShell({ initialUser, surface = "console" }: AppShellProps) {
  const firebaseAvailable = isFirebaseConfigured();
  const isJudgeSurface = surface === "judge";
  const demoDeveloper = demoUsers.find((user) => normalizeRole(user.role) === "developer") ?? null;
  const demoJudge = demoUsers.find((user) => normalizeRole(user.role) === "judge") ?? null;
  const [language, setLanguage] = useState<AppLanguage>("ko");
  const [translationOverrides, setTranslationOverrides] = useState<TranslationOverrides>({});
  const [translationPublishMessage, setTranslationPublishMessage] = useState("");
  const [translationEditorLanguage, setTranslationEditorLanguage] = useState<AppLanguage>("ko");
  const [translationSearch, setTranslationSearch] = useState("");
  const [hasLoadedBrowserPreferences, setHasLoadedBrowserPreferences] = useState(false);
  const copy = getAppCopy(language, translationOverrides[language]);
  const [authUser, setAuthUser] = useState<User | null>(initialUser ?? null);
  const [authStatus, setAuthStatus] = useState<string>(firebaseAvailable ? copy.checkingSession : copy.signedOut);
  const [authError, setAuthError] = useState("");
  const [users, setUsers] = useState<User[]>(demoUsers);
  const [events, setEvents] = useState<Event[]>(initialEvents);
  const [activeEventId, setActiveEventId] = useState(initialEvents[0]?.id ?? "");
  const [scorecards, setScorecards] = useState<Scorecard[]>(initialScorecards);
  const [participantsByEvent, setParticipantsByEvent] = useState<Record<string, Participant[]>>(demoParticipants);
  const [selectedParticipantId, setSelectedParticipantId] = useState("");
  const [notes, setNotes] = useState("");
  const [organizerName, setOrganizerName] = useState(initialEvents[0]?.name ?? "");
  const [organizerDescription, setOrganizerDescription] = useState(initialEvents[0]?.description ?? "");
  const [organizerStatus, setOrganizerStatus] = useState<EventStatus>(initialEvents[0]?.status ?? "draft");
  const [organizerGradingType, setOrganizerGradingType] = useState<GradingType>(initialEvents[0]?.gradingType ?? "rubric");
  const [organizerTrimExtremes, setOrganizerTrimExtremes] = useState(initialEvents[0]?.dropHighestAndLowestJudgeScores ?? false);
  const [organizerHideRubricDescriptions, setOrganizerHideRubricDescriptions] = useState(initialEvents[0]?.hideRubricDescriptions ?? false);
  const [newParticipantName, setNewParticipantName] = useState("");
  const [newParticipantTitle, setNewParticipantTitle] = useState("");
  const [editingParticipantId, setEditingParticipantId] = useState("");
  const [editingParticipantName, setEditingParticipantName] = useState("");
  const [editingParticipantTitle, setEditingParticipantTitle] = useState("");
  const [participantCsvText, setParticipantCsvText] = useState("");
  const [participantImportMessage, setParticipantImportMessage] = useState("");
  const [eventCreateMessage, setEventCreateMessage] = useState("");
  const [teacherQrName, setTeacherQrName] = useState("");
  const [teacherQrMessage, setTeacherQrMessage] = useState("");
  const [section, setSection] = useState<SectionId>(defaultSectionForRole(normalizeRole(authUser?.role)));
  const [isJudgeSessionOpen, setJudgeSessionOpen] = useState(false);
  const [isScorecardDirty, setScorecardDirty] = useState(false);
  const [scoreSaveState, setScoreSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [organizerTab, setOrganizerTab] = useState<OrganizerTabId>("setup");
  const [expandedCriterionId, setExpandedCriterionId] = useState<string | null>(initialEvents[0]?.criteria[0]?.id ?? null);
  const optimisticEventsRef = useRef<Event[]>([]);
  const teacherQrSignInStartedRef = useRef(false);
  const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scoreDraftVersionRef = useRef(0);

  const role = normalizeRole(authUser?.role);
  const isDeveloper = role === "developer";
  const canJudge = role === "judge" || isDeveloper;
  const canOrganize = role === "organizer" || isDeveloper;
  const isJudgeOnlyExperience = isJudgeSurface || (role === "judge" && !isDeveloper);
  const activeSection = isJudgeSurface ? "judge" : isDeveloper ? section : defaultSectionForRole(role);
  const activeEvent = events.find((event) => event.id === activeEventId) ?? events[0];
  const teacherQrLoginUrl = firebaseAvailable ? buildTeacherQrLoginUrl(activeEvent?.id ?? "", teacherQrName) : "";
  const participants = participantsByEvent[activeEvent?.id ?? ""] ?? [];
  const selectedParticipant = participants.find((participant) => participant.id === selectedParticipantId);
  const judgeId = authUser?.uid ?? "judge-1";
  const existingScorecard = activeEvent && selectedParticipant ? getJudgeScorecard(activeEvent.id, selectedParticipant.id, judgeId, scorecards) : undefined;
  const [draftScores, setDraftScores] = useState<Record<string, number>>(
    existingScorecard?.scores ?? (activeEvent ? getDefaultScores(activeEvent.criteria) : {})
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedLanguage = window.localStorage.getItem("grading-program-language");
    setLanguage(storedLanguage === "en" ? "en" : "ko");
    setTranslationOverrides(loadTranslationOverrides());
    setHasLoadedBrowserPreferences(true);
  }, []);

  useEffect(() => {
    if (firebaseAvailable || initialUser !== undefined) return;

    if (canUseLocalDemoAccount()) {
      setAuthUser(isJudgeSurface ? demoJudge : demoDeveloper);
      setSection(isJudgeSurface ? "judge" : "developer");
      setAuthStatus(copy.demoMode);
      return;
    }

    setAuthUser(null);
    setSection("standings");
    setAuthStatus(copy.signedOut);
  }, [copy.demoMode, copy.signedOut, demoDeveloper, demoJudge, firebaseAvailable, initialUser, isJudgeSurface]);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = language;
    }
    if (typeof window !== "undefined" && hasLoadedBrowserPreferences) {
      window.localStorage.setItem("grading-program-language", language);
    }
  }, [language, hasLoadedBrowserPreferences]);

  useEffect(() => {
    if (typeof window !== "undefined" && hasLoadedBrowserPreferences) {
      window.localStorage.setItem("grading-program-translation-overrides", JSON.stringify(translationOverrides));
    }
  }, [translationOverrides, hasLoadedBrowserPreferences]);

  const persistFirebaseWrite = async (write: () => Promise<unknown>) => {
    if (!firebaseAvailable) return;
    try {
      await write();
    } catch (error) {
      setAuthError(getFirebaseErrorMessage(error));
    }
  };

  const completeTeacherQrSignIn = async (firebaseUser: Parameters<typeof upsertTeacherQrUser>[0], teacherName = "") => {
    const persistedUser = await upsertTeacherQrUser(firebaseUser, { displayName: teacherName });
    setAuthError("");
    setTeacherQrMessage(copy.teacherQrSignedIn);
    setAuthUser(persistedUser);
    setUsers((current) => {
      const withoutUser = current.filter((user) => user.uid !== persistedUser.uid);
      return [...withoutUser, persistedUser];
    });
    setSection("judge");
    setAuthStatus(copy.signedIn);
    return persistedUser;
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
        assertAuthorizedAppUser(firebaseUser);
        const teacherQrRequest = getTeacherQrRequest();
        let profileSyncError = "";
        const persistedUser = firebaseUser.isAnonymous
          ? await completeTeacherQrSignIn(firebaseUser, teacherQrRequest?.teacherName)
          : await upsertAuthenticatedUser(firebaseUser).catch((error) => {
              profileSyncError = getFirebaseErrorMessage(error);
              return createNewUserRecord(firebaseUser);
            });
        setAuthError(profileSyncError);
        setAuthUser(persistedUser);
        setUsers((current) => {
          const withoutUser = current.filter((user) => user.uid !== persistedUser.uid);
          return [...withoutUser, persistedUser];
        });
        setSection(defaultSectionForRole(normalizeRole(persistedUser.role)));
        setAuthStatus(copy.signedIn);
      } catch (error) {
        setAuthUser(null);
        setSection("standings");
        setAuthError(getFirebaseErrorMessage(error));
        setAuthStatus(copy.signedOut);
        await signOutOfGoogle().catch(() => undefined);
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
    if (!firebaseAvailable || authUser || initialUser !== undefined || teacherQrSignInStartedRef.current) return;
    const teacherQrRequest = getTeacherQrRequest();
    if (!teacherQrRequest) return;

    teacherQrSignInStartedRef.current = true;
    if (teacherQrRequest.eventId) {
      setActiveEventId(teacherQrRequest.eventId);
    }

    void signInWithTeacherQr()
      .then((firebaseUser) => completeTeacherQrSignIn(firebaseUser, teacherQrRequest.teacherName))
      .catch((error) => {
        teacherQrSignInStartedRef.current = false;
        setAuthError(getFirebaseErrorMessage(error));
        setAuthStatus(copy.authError);
      });
  }, [firebaseAvailable, authUser, initialUser, language]);

  useEffect(() => {
    if (!firebaseAvailable || !authUser) return;
    let unsubscribe: (() => void) | undefined;
    let disposed = false;

    void subscribeToFirebaseAppData(
      (data) => {
        const remoteEvents = data.events.length ? data.events : initialEvents;
        const remoteEventIds = new Set(remoteEvents.map((event) => event.id));
        const pendingEvents = optimisticEventsRef.current.filter((event) => !remoteEventIds.has(event.id));
        optimisticEventsRef.current = pendingEvents;
        const nextEvents = [...pendingEvents, ...remoteEvents];
        const nextParticipantsByEvent = {
          ...(data.events.length ? data.participantsByEvent : demoParticipants)
        };
        pendingEvents.forEach((event) => {
          nextParticipantsByEvent[event.id] = nextParticipantsByEvent[event.id] ?? [];
        });
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
        setTranslationOverrides(data.translationOverrides ?? {});
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

  const eventScorecards = activeEvent ? scorecards.filter((card) => card.eventId === activeEvent.id) : [];
  const judgeRoster = (() => {
    const roster = new Map<string, { id: string; name: string; email: string }>();

    users.forEach((user) => {
      if (normalizeRole(user.role) !== "judge") return;
      roster.set(user.uid, {
        id: user.uid,
        name: user.displayName ?? user.email,
        email: user.email
      });
    });

    eventScorecards.forEach((card) => {
      if (roster.has(card.judgeId)) return;
      roster.set(card.judgeId, {
        id: card.judgeId,
        name: card.judgeName,
        email: card.judgeEmail
      });
    });

    return [...roster.values()].sort((left, right) => left.name.localeCompare(right.name));
  })();
  const scorecardFor = (participantId: string, rosterJudgeId: string) =>
    eventScorecards.find((card) => card.participantId === participantId && card.judgeId === rosterJudgeId);
  const totalJudgeAssignments = participants.length * judgeRoster.length;
  const completedJudgeAssignments = participants.reduce(
    (sum, participant) => sum + judgeRoster.filter((judge) => scorecardFor(participant.id, judge.id)).length,
    0
  );
  const leaderboard = activeEvent
    ? participants
        .map((participant) => buildLeaderboardRow(activeEvent, participant, scorecards.filter((card) => card.eventId === activeEvent.id && card.participantId === participant.id)))
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
    setTranslationPublishMessage("");
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
    setTranslationPublishMessage("");
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
    setTranslationPublishMessage("");
  };

  const publishTranslationOverrides = async () => {
    if (!isDeveloper) return;
    if (!firebaseAvailable) {
      setTranslationPublishMessage(copy.translationOverridesLocalOnly);
      return;
    }

    try {
      await saveFirebaseTranslationOverrides(translationOverrides);
      setTranslationPublishMessage(copy.translationOverridesPublished);
    } catch (error) {
      setTranslationPublishMessage(copy.translationOverridesPublishFailed.replace("{error}", getFirebaseErrorMessage(error)));
    }
  };

  const copyTeacherQrLink = async () => {
    if (!teacherQrLoginUrl || typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(teacherQrLoginUrl);
    } catch {
      // Clipboard can be blocked outside secure browser contexts; the readonly field still exposes the link.
    }
  };

  const syncEventForm = (event: Event) => {
    setOrganizerName(event.name);
    setOrganizerDescription(event.description ?? "");
    setOrganizerStatus(event.status);
    setOrganizerGradingType(event.gradingType);
    setOrganizerTrimExtremes(event.dropHighestAndLowestJudgeScores ?? false);
    setOrganizerHideRubricDescriptions(event.hideRubricDescriptions ?? false);
  };

  const clearAutoSaveTimer = () => {
    if (!autoSaveTimeoutRef.current) return;
    clearTimeout(autoSaveTimeoutRef.current);
    autoSaveTimeoutRef.current = null;
  };

  const markScorecardDirty = () => {
    scoreDraftVersionRef.current += 1;
    setScorecardDirty(true);
    setScoreSaveState("idle");
  };

  const updateDraftScore = (criterionId: string, score: number, max: number) => {
    setDraftScores((value) => ({
      ...value,
      [criterionId]: clampScore(score, max)
    }));
    markScorecardDirty();
  };

  const updateJudgeNotes = (value: string) => {
    setNotes(value);
    markScorecardDirty();
  };

  const resetJudgeDraftScores = () => {
    if (!activeEvent) return;
    setDraftScores(getDefaultScores(activeEvent.criteria));
    markScorecardDirty();
  };

  const selectParticipant = (participantId: string) => {
    if (!activeEvent) return;
    const nextParticipant = participants.find((participant) => participant.id === participantId) ?? participants[0];
    if (!nextParticipant) return;
    if (isScorecardDirty) {
      void saveJudgeScorecard();
    }
    setSelectedParticipantId(nextParticipant.id);
    const card = getJudgeScorecard(activeEvent.id, nextParticipant.id, judgeId, scorecards);
    setDraftScores(card?.scores ?? getDefaultScores(activeEvent.criteria));
    setNotes(card?.notes ?? "");
    setScorecardDirty(false);
    setScoreSaveState(card ? "saved" : "idle");
  };

  useEffect(() => {
    if (!activeEvent) return;
    syncEventForm(activeEvent);
    const nextParticipants = participantsByEvent[activeEvent.id] ?? [];
    const nextParticipantId = nextParticipants.some((participant) => participant.id === selectedParticipantId)
      ? selectedParticipantId
      : "";
    setSelectedParticipantId(nextParticipantId);
    const scorecard = nextParticipantId ? getJudgeScorecard(activeEvent.id, nextParticipantId, judgeId, scorecards) : undefined;
    setDraftScores(scorecard?.scores ?? getDefaultScores(activeEvent.criteria));
    setNotes(scorecard?.notes ?? "");
    setScorecardDirty(false);
    setScoreSaveState(scorecard ? "saved" : "idle");
  }, [activeEventId]);

  useEffect(() => {
    if (!activeEvent) return;
    setExpandedCriterionId((current) => (activeEvent.criteria.some((criterion) => criterion.id === current) ? current : activeEvent.criteria[0]?.id ?? null));
  }, [activeEventId, activeEvent?.criteria.length]);

  const updateSelectedEvent = (eventId: string) => {
    if (isScorecardDirty) {
      void saveJudgeScorecard();
    }
    const nextEvent = events.find((event) => event.id === eventId);
    setActiveEventId(eventId);
    if (nextEvent) {
      syncEventForm(nextEvent);
      const nextParticipantId = "";
      setSelectedParticipantId(nextParticipantId);
      if (nextParticipantId) {
        const scorecard = getJudgeScorecard(eventId, nextParticipantId, judgeId, scorecards);
        setDraftScores(scorecard?.scores ?? getDefaultScores(nextEvent.criteria));
        setNotes(scorecard?.notes ?? "");
        setScorecardDirty(false);
        setScoreSaveState(scorecard ? "saved" : "idle");
      } else {
        setDraftScores(getDefaultScores(nextEvent.criteria));
        setNotes("");
        setScorecardDirty(false);
        setScoreSaveState("idle");
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
      dropHighestAndLowestJudgeScores: organizerTrimExtremes,
      hideRubricDescriptions: organizerHideRubricDescriptions,
      criteria: activeEvent?.criteria.map((criterion) => ({ ...criterion })) ?? [createDefaultCriterion()]
    });
    optimisticEventsRef.current = [nextEvent, ...optimisticEventsRef.current.filter((event) => event.id !== nextEvent.id)];
    setEvents((current) => [nextEvent, ...current]);
    setParticipantsByEvent((current) => ({ ...current, [nextEvent.id]: [] }));
    setActiveEventId(nextEvent.id);
    setSelectedParticipantId("");
    setDraftScores(getDefaultScores(nextEvent.criteria));
    syncEventForm(nextEvent);
    setEventCreateMessage(firebaseAvailable ? copy.eventCreateSaving : copy.eventCreateSaved);
    void (async () => {
      if (!firebaseAvailable) return;
      try {
        await saveFirebaseEvent(nextEvent);
        setEventCreateMessage(copy.eventCreateSaved);
      } catch (error) {
        const message = getFirebaseErrorMessage(error);
        setAuthError(message);
        setEventCreateMessage(copy.eventCreateFailed.replace("{error}", message));
      }
    })();
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
    setExpandedCriterionId(nextCriterion.id);
    void persistFirebaseWrite(() => saveFirebaseEvent(nextEvent));
  };

  const saveJudgeScorecard = async () => {
    if (!activeEvent || !selectedParticipant || !canJudge) return;
    clearAutoSaveTimer();

    const totalScore = calculateTotals(activeEvent, draftScores).rawScore;
    const savedDraftVersion = scoreDraftVersionRef.current;
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

    setScoreSaveState("saving");
    setScorecards((current) => {
      const filtered = current.filter((item) => item.id !== nextCard.id);
      return [...filtered, nextCard];
    });
    setScorecardDirty(false);
    await persistFirebaseWrite(() => saveFirebaseScorecard(nextCard));
    if (scoreDraftVersionRef.current === savedDraftVersion) {
      setScoreSaveState("saved");
    }
  };

  useEffect(() => {
    if (!isScorecardDirty || !activeEvent || !selectedParticipant || !canJudge) return;

    clearAutoSaveTimer();
    autoSaveTimeoutRef.current = setTimeout(() => {
      void saveJudgeScorecard();
    }, 700);

    return clearAutoSaveTimer;
  }, [isScorecardDirty, draftScores, notes, activeEvent?.id, selectedParticipant?.id, canJudge]);

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

  const startEditingParticipant = (participant: Participant) => {
    setEditingParticipantId(participant.id);
    setEditingParticipantName(participant.name);
    setEditingParticipantTitle(participant.title ?? "");
  };

  const cancelEditingParticipant = () => {
    setEditingParticipantId("");
    setEditingParticipantName("");
    setEditingParticipantTitle("");
  };

  const saveParticipantEdits = () => {
    if (!activeEvent || !canOrganize || !editingParticipantId || !editingParticipantName.trim()) return;
    const currentParticipant = participants.find((participant) => participant.id === editingParticipantId);
    if (!currentParticipant) return;

    const updatedAt = new Date().toISOString();
    const nextParticipant: Participant = {
      ...currentParticipant,
      id: editingParticipantId,
      name: editingParticipantName.trim(),
      title: editingParticipantTitle.trim() || undefined,
      updatedAt
    };

    setParticipantsByEvent((current) => ({
      ...current,
      [activeEvent.id]: (current[activeEvent.id] ?? []).map((participant) => (participant.id === editingParticipantId ? nextParticipant : participant))
    }));
    cancelEditingParticipant();
    void persistFirebaseWrite(() => saveFirebaseParticipant(activeEvent.id, nextParticipant));
  };

  const deleteParticipant = (participantId: string) => {
    if (!activeEvent || !canOrganize) return;

    const nextParticipants = participants.filter((participant) => participant.id !== participantId);
    setParticipantsByEvent((current) => ({
      ...current,
      [activeEvent.id]: nextParticipants
    }));
    setScorecards((current) => current.filter((card) => !(card.eventId === activeEvent.id && card.participantId === participantId)));
    setSelectedParticipantId((current) => (current === participantId ? nextParticipants[0]?.id ?? "" : current));
    if (editingParticipantId === participantId) {
      cancelEditingParticipant();
    }
    void persistFirebaseWrite(() => deleteFirebaseParticipant(participantId));
  };

  const applyParticipantCsv = (csv: string) => {
    if (!activeEvent || !canOrganize) return;
    const result = parseParticipantsCsv(csv, participants);
    const errorText = result.errors.length
      ? ` ${copy.participantImportErrors.replace("{errors}", result.errors.slice(0, 3).join(" ")).trim()}`
      : "";

    if (!result.participants.length) {
      setParticipantImportMessage(result.errors.join(" ") || copy.participantImportErrors.replace("{errors}", "No valid team rows found."));
      return;
    }

    setParticipantsByEvent((current) => ({
      ...current,
      [activeEvent.id]: [...(current[activeEvent.id] ?? []), ...result.participants]
    }));
    setSelectedParticipantId(result.participants[0].id);
    setParticipantImportMessage(`${copy.participantsImported.replace("{count}", String(result.participants.length))}${errorText}`);
    setParticipantCsvText("");
    void Promise.all(result.participants.map((participant) => persistFirebaseWrite(() => saveFirebaseParticipant(activeEvent.id, participant))));
  };

  const importParticipantsFromCsv = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!activeEvent || !canOrganize) return;
    const file = event.currentTarget.files?.[0];
    if (!file) return;

    try {
      applyParticipantCsv(await readCsvFile(file));
      event.currentTarget.value = "";
    } catch (error) {
      setParticipantImportMessage(error instanceof Error ? error.message : copy.participantImportErrors.replace("{errors}", "The CSV could not be read."));
    }
  };

  const downloadParticipantTemplate = () => {
    downloadCsvFile("participant-template.csv", buildParticipantTemplateCsv());
  };

  const downloadResultsCsv = () => {
    if (!activeEvent) return;
    downloadCsvFile(createCsvFileName(activeEvent.name, "results"), buildStandingsCsv(activeEvent, participants, scorecards));
  };

  const saveOrganizerChanges = () => {
    if (!activeEvent || !canOrganize) return;
    const nextEvent = {
      ...activeEvent,
      name: organizerName,
      description: organizerDescription,
      status: organizerStatus,
      gradingType: organizerGradingType,
      dropHighestAndLowestJudgeScores: organizerTrimExtremes,
      hideRubricDescriptions: organizerHideRubricDescriptions,
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
      const persistedUser = await upsertAuthenticatedUser(firebaseUser).catch((error) => {
        const fallbackUser = createNewUserRecord(firebaseUser);
        setAuthError(getFirebaseErrorMessage(error));
        return fallbackUser;
      });
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
    const useLocalDemo = !firebaseAvailable && canUseLocalDemoAccount();
    setAuthUser(useLocalDemo ? (isJudgeOnlyExperience ? demoJudge : demoDeveloper) : null);
    setSection(useLocalDemo ? (isJudgeOnlyExperience ? "judge" : "developer") : "standings");
    setAuthStatus(useLocalDemo ? copy.demoMode : copy.signedOut);
  };

  const renderSessionControls = (languageSelectId: string, className = "criterion-card") => (
    <div className={className}>
      <div className="section-header">
        <div>
          <h2>{authUser?.displayName ?? (firebaseAvailable ? copy.signedOut : copy.firebaseSetupRequired)}</h2>
          <p>{authUser?.email ?? authStatus}</p>
        </div>
        <span className={`badge ${firebaseAvailable ? "emerald" : "amber"}`}>{firebaseAvailable ? copy.firebase : copy.local}</span>
      </div>
      {authError ? <div className="footer-note">{authError}</div> : null}
      {teacherQrMessage ? <div className="footer-note">{teacherQrMessage}</div> : null}
      <div className="button-row">
        {!authUser && firebaseAvailable ? (
          <button className="button" onClick={handleSignIn}>
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
        {!firebaseAvailable ? copy.firebaseMissing : authUser ? copy.signedInNotice : copy.signInNotice}
      </div>
      <div className="field session-language-field">
        <label className="label" htmlFor={languageSelectId}>
          {copy.language}
        </label>
        <select id={languageSelectId} className="select" value={language} onChange={(event) => setLanguage(event.target.value as AppLanguage)}>
          {languageOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );

  const renderJudgeSessionPanel = () => (
    <details className="panel judge-session-panel" open={isJudgeSessionOpen} onToggle={(event) => setJudgeSessionOpen(event.currentTarget.open)}>
      <summary className="judge-session-summary">
        <span>{copy.sessionLogin}</span>
        <span className={`badge ${authUser ? "emerald" : "amber"}`}>{authUser?.displayName ?? authStatus}</span>
      </summary>
      {isJudgeSessionOpen ? <div className="panel-inner">{renderSessionControls("judge-language-select", "judge-session-content")}</div> : null}
    </details>
  );

  const renderEventSelector = (variant: "sidebar" | "judge") => {
    const selectId = `${variant}-event-select`;

    return (
      <div className={`panel ${variant === "judge" ? "judge-event-panel" : ""}`} role={variant === "judge" ? "region" : undefined} aria-label={variant === "judge" ? "Judge event selection" : undefined}>
        <div className="panel-inner stack">
          <div className="section-header">
            <div>
              <h2>{copy.currentEvent}</h2>
              <p>{variant === "judge" ? "Choose the event after finishing the visible scorecard." : role === "guest" ? copy.currentEventGuestHelp : copy.currentEventHelp}</p>
            </div>
          </div>
          <label className="label" htmlFor={selectId}>
            {copy.currentEvent}
          </label>
          <select id={selectId} className="select" value={activeEventId} onChange={(event) => updateSelectedEvent(event.target.value)}>
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.name}
              </option>
            ))}
          </select>
          <div className="footer-note">{activeEvent?.description}</div>
        </div>
      </div>
    );
  };

  const renderJudgeScoring = (dedicated = false) => {
    if (!activeEvent) {
      return (
        <section className={`judge-workspace ${dedicated ? "judge-workspace-dedicated" : ""}`} aria-label="Judge scoring interface">
          <div className="panel judge-scoring-panel">
            <div className="panel-inner stack">
              <h2>{copy.judgeWorkspace}</h2>
              <div className="footer-note">{copy.noEventSelected}</div>
            </div>
          </div>
        </section>
      );
    }

    if (!canJudge) {
      return (
        <section className={`judge-workspace ${dedicated ? "judge-workspace-dedicated" : ""}`} aria-label="Judge scoring interface">
          <div className="panel judge-scoring-panel">
            <div className="panel-inner stack">
              <h2>{copy.judgeWorkspace}</h2>
              <div className="footer-note">{authStatus}</div>
            </div>
          </div>
        </section>
      );
    }

    const selectedStatus = scoreSaveState === "saving" ? "Saving..." : isScorecardDirty ? "Auto saving..." : existingScorecard ? "Saved" : "Not scored";
    const selectedStatusClass = scoreSaveState === "saving" ? "indigo" : isScorecardDirty ? "amber" : existingScorecard ? "emerald" : "amber";

    return (
      <section className={`judge-workspace ${dedicated ? "judge-workspace-dedicated" : ""}`} aria-label="Judge scoring interface">
        <div className="panel judge-scoring-panel">
          <div className="panel-inner stack">
            <div className="section-header judge-header">
              <div>
                <h2>{copy.judgeWorkspace}</h2>
                <p>{selectedParticipant ? copy.judgeSelected(selectedParticipant.name) : "Select a team to start scoring."}</p>
              </div>
              {selectedParticipant ? (
                <div className="judge-header-actions">
                  <span className={`badge ${selectedStatusClass}`} aria-live="polite">
                    {selectedStatus}
                  </span>
                  <button className="button judge-save-action" onClick={() => void saveJudgeScorecard()}>
                    {copy.saveScorecard}
                  </button>
                </div>
              ) : null}
            </div>

            <div className="judge-team-section">
              <div className="section-header">
                <div>
                  <h3>{copy.chooseTeam}</h3>
                  <p>Tap a large team card. Cards marked Saved already have your scorecard.</p>
                </div>
              </div>
              {participants.length ? (
                <div className="judge-team-grid">
                  {participants.map((participant) => {
                    const isSelected = participant.id === selectedParticipant?.id;
                    const isSaved = Boolean(activeEvent ? getJudgeScorecard(activeEvent.id, participant.id, judgeId, scorecards) : undefined);

                    return (
                      <button
                        key={participant.id}
                        type="button"
                        className={`team-card ${isSelected ? "active" : ""} ${isSaved ? "saved" : ""}`}
                        aria-label={participant.name}
                        aria-pressed={isSelected}
                        onClick={() => selectParticipant(participant.id)}
                      >
                        <strong>{participant.name}</strong>
                        <span>{participant.title ?? "Untitled project"}</span>
                        <span className={`badge ${isSaved ? "emerald" : "amber"}`}>{isSaved ? "Saved" : "Not scored"}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="criterion-card judge-criterion-card">
                  <strong>No teams are available for this event yet.</strong>
                </div>
              )}
            </div>

            {selectedParticipant ? (
              <>
                <div className="criteria-list judge-criteria-list">
                  {activeEvent.criteria.map((criterion) => {
                    const current = draftScores[criterion.id] ?? 0;
                    const max = criterion.maxPoints;
                    const isRubric = activeEvent.gradingType === "rubric";
                    const showRubricDescriptions = isRubric && !activeEvent.hideRubricDescriptions;
                    const rubricLevels = createRubricLevels(max, criterion.rubricLevels);
                    const selectedRubricLevel = isRubric && current > 0 ? getRubricLevelForScore(max, current, criterion.rubricLevels) : undefined;

                    return (
                      <div className="criterion-card judge-criterion-card" key={criterion.id}>
                        <div className="criterion-top">
                          <div>
                            <strong>{criterion.name}</strong>
                            <span>{criterion.description}</span>
                          </div>
                          <span className="badge indigo">{criterion.maxPoints} pts</span>
                        </div>
                        {showRubricDescriptions ? (
                          <div className="footer-note" style={{ marginTop: 10 }}>
                            {copy.chooseLetterHelp}
                          </div>
                        ) : null}
                        {isRubric ? (
                          <div className="chip-row judge-grade-row" style={{ marginTop: 12 }}>
                            {rubricLevels.map((level) => (
                              <button
                                key={`${criterion.id}-${level.label}`}
                                type="button"
                                aria-label={`${criterion.name} grade ${level.label}`}
                                aria-pressed={selectedRubricLevel?.label === level.label}
                                className={`chip judge-grade-button ${selectedRubricLevel?.label === level.label ? "active" : ""}`}
                                onClick={() => updateDraftScore(criterion.id, level.points, max)}
                              >
                                {level.label}
                              </button>
                            ))}
                          </div>
                        ) : null}
                        {showRubricDescriptions ? (
                          <div className="footer-note" style={{ marginTop: 8 }}>
                            {selectedRubricLevel?.description ?? copy.selectLetterPrompt}
                          </div>
                        ) : null}
                        <div className="range-row judge-range-row">
                          {isRubric ? (
                            <div className="field selected-grade-field" aria-live="polite">
                              <span>{copy.selectedGrade}</span>
                              <strong>{selectedRubricLevel?.label ?? "Not set"}</strong>
                            </div>
                          ) : (
                            <>
                              <input
                                className="range judge-range"
                                type="range"
                                min={0}
                                max={max}
                                step={0.5}
                                value={current}
                                onChange={(event) => updateDraftScore(criterion.id, Number(event.target.value), max)}
                              />
                              <input
                                className="field judge-score-input"
                                type="number"
                                min={0}
                                max={max}
                                step={0.5}
                                value={current}
                                onChange={(event) => updateDraftScore(criterion.id, Number(event.target.value), max)}
                              />
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div>
                  <label className="label judge-label" htmlFor="judge-notes">
                    {copy.feedbackNotes}
                  </label>
                  <textarea id="judge-notes" className="textarea judge-notes" maxLength={2000} value={notes} onChange={(event) => updateJudgeNotes(event.target.value)} />
                  <div className="footer-note">{notes.length}/2000 characters</div>
                </div>
                <div className="button-row judge-actions">
                  <button className="button secondary judge-action" onClick={resetJudgeDraftScores}>
                    {copy.resetScores}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </section>
    );
  };

  const renderOrganizerTabs = () => (
    <div className="panel organizer-tabs-panel">
      <div className="panel-inner">
        <div className="organizer-tabs" role="tablist" aria-label="Organizer screens">
          {organizerTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`organizer-tab ${organizerTab === tab.id ? "active" : ""}`}
              role="tab"
              aria-selected={organizerTab === tab.id}
              onClick={() => setOrganizerTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  const renderJudgeScoreReview = () => {
    if (!activeEvent) return null;

    return (
      <div className="panel">
        <div className="panel-inner stack">
          <div className="section-header">
            <div>
              <h2>Judge scores</h2>
              <p>Every saved judge score is visible in one table, with missing scorecards marked clearly.</p>
            </div>
          </div>
          {judgeRoster.length ? (
            <div className="score-review-scroll">
              <table className="table score-review-table">
                <thead>
                  <tr>
                    <th>{copy.team}</th>
                    {judgeRoster.map((judge) => (
                      <th key={judge.id}>{judge.name}</th>
                    ))}
                    <th>{copy.averagePercent}</th>
                  </tr>
                </thead>
                <tbody>
                  {participants.map((participant) => {
                    const participantCards = eventScorecards.filter((card) => card.participantId === participant.id);
                    const row = buildLeaderboardRow(activeEvent, participant, participantCards);

                    return (
                      <tr key={participant.id}>
                        <td>
                          <strong>{participant.name}</strong>
                          <div className="footer-note">{participant.title}</div>
                        </td>
                        {judgeRoster.map((judge) => {
                          const card = scorecardFor(participant.id, judge.id);
                          const totals = card ? calculateTotals(activeEvent, card.scores) : null;

                          return (
                            <td key={judge.id}>
                              {totals ? (
                                <div className={`score-cell ${scoreBadge(totals.averageScore)}`}>
                                  <strong>{totals.averageScore.toFixed(1)}%</strong>
                                  <span>{totals.rawScore.toFixed(1)} raw</span>
                                </div>
                              ) : (
                                <span className="badge amber">Missing</span>
                              )}
                            </td>
                          );
                        })}
                        <td>
                          {row.scorecardCount ? (
                            <strong>{row.averageScore.toFixed(1)}%</strong>
                          ) : (
                            <span className="footer-note">No scores</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="criterion-card">No judges have been assigned or submitted scores yet.</div>
          )}
        </div>
      </div>
    );
  };

  const renderEventMonitor = () => {
    if (!activeEvent) return null;
    const completionPercent = totalJudgeAssignments === 0 ? 0 : Math.round((completedJudgeAssignments / totalJudgeAssignments) * 100);
    const missingAssignments = Math.max(0, totalJudgeAssignments - completedJudgeAssignments);

    return (
      <div className="panel">
        <div className="panel-inner stack">
          <div className="section-header">
            <div>
              <h2>Event monitor</h2>
              <p>Track who has submitted each scorecard and which teams still need judge attention.</p>
            </div>
          </div>
          <div className="grid-3">
            <div className="metric">
              <span>Event completion</span>
              <strong>{completionPercent}%</strong>
            </div>
            <div className="metric">
              <span>Submitted</span>
              <strong>{completedJudgeAssignments}</strong>
            </div>
            <div className="metric">
              <span>Missing</span>
              <strong>{missingAssignments}</strong>
            </div>
          </div>
          {judgeRoster.length ? (
            <div className="event-flow-board">
              {participants.map((participant) => {
                const completedForTeam = judgeRoster.filter((judge) => scorecardFor(participant.id, judge.id)).length;
                const state =
                  completedForTeam === 0
                    ? "Waiting"
                    : completedForTeam === judgeRoster.length
                      ? "Completed"
                      : "In progress";
                const stateClass = state === "Completed" ? "done" : state === "In progress" ? "active" : "waiting";

                return (
                  <div className="flow-row" key={participant.id}>
                    <div className="flow-node flow-team">
                      <strong>{participant.name}</strong>
                      <span>{participant.title ?? "Untitled project"}</span>
                    </div>
                    <div className="flow-judge-list">
                      {judgeRoster.map((judge) => {
                        const isSubmitted = Boolean(scorecardFor(participant.id, judge.id));
                        return (
                          <span key={judge.id} className={`flow-judge ${isSubmitted ? "done" : "missing"}`}>
                            <strong>{judge.name}</strong>
                            <span>{isSubmitted ? "Submitted" : "Missing"}</span>
                          </span>
                        );
                      })}
                    </div>
                    <div className={`flow-node flow-state ${stateClass}`}>
                      <strong>{state}</strong>
                      <span>
                        {completedForTeam}/{judgeRoster.length} judges
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="criterion-card">No judge roster is available for this event yet.</div>
          )}
        </div>
      </div>
    );
  };

  if (isJudgeOnlyExperience) {
    return (
      <main className="app-shell judge-shell">
        {renderJudgeScoring(true)}
        {renderEventSelector("judge")}
        {renderJudgeSessionPanel()}
      </main>
    );
  }

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
            {renderSessionControls("language-select")}
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
                    <button
                      key={item.id}
                      className={`nav-button ${activeSection === item.id ? "active" : ""}`}
                      onClick={() => {
                        if (item.id === "organizer") {
                          setOrganizerTab("setup");
                        }
                        setSection(item.id);
                      }}
                    >
                      {copy[item.labelKey]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {renderEventSelector("sidebar")}
        </aside>

        <div className="section-stack">
          {activeSection === "judge" && activeEvent && canJudge ? renderJudgeScoring(false) : null}

          {activeSection === "organizer" && activeEvent && canOrganize ? (
            <div className="section-stack">
              {renderOrganizerTabs()}
              {organizerTab === "setup" ? (
            <div className="grid-2">
              <div className="panel">
                <div className="panel-inner stack">
                  <div className="section-header">
                    <div>
                      <h2>{copy.eventBuilder}</h2>
                      <p>{copy.eventBuilderDesc}</p>
                    </div>
                    <button type="button" className="button" onClick={createEvent}>
                      {copy.createEvent}
                    </button>
                  </div>
                  {eventCreateMessage ? <div className="footer-note">{eventCreateMessage}</div> : null}
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
                  <div className="criterion-card">
                    <div className="criterion-top">
                      <div>
                        <strong>{copy.trimExtremeScores}</strong>
                        <span>{copy.trimExtremeScoresDesc}</span>
                      </div>
                      <input
                        type="checkbox"
                        aria-label={copy.trimExtremeScores}
                        checked={organizerTrimExtremes}
                        onChange={(event) => setOrganizerTrimExtremes(event.target.checked)}
                      />
                    </div>
                  </div>
                  <div className="criterion-card">
                    <div className="criterion-top">
                      <div>
                        <strong>{copy.hideRubricDescriptions}</strong>
                        <span>{copy.hideRubricDescriptionsDesc}</span>
                      </div>
                      <input
                        type="checkbox"
                        aria-label={copy.hideRubricDescriptions}
                        checked={organizerHideRubricDescriptions}
                        onChange={(event) => setOrganizerHideRubricDescriptions(event.target.checked)}
                      />
                    </div>
                  </div>
                  <div className="criteria-list">
                    {activeEvent.criteria.map((criterion, index) => {
                      const isExpanded = expandedCriterionId === criterion.id;

                      return (
                      <div className="criterion-card" key={criterion.id}>
                        <button
                          type="button"
                          className="criterion-toggle"
                          aria-expanded={isExpanded}
                          aria-label={`${isExpanded ? copy.collapseCriterion : copy.expandCriterion} ${index + 1}: ${criterion.name}`}
                          onClick={() => setExpandedCriterionId((current) => (current === criterion.id ? null : criterion.id))}
                        >
                          <div className="criterion-toggle-copy">
                            <strong>{criterion.name}</strong>
                            <span>{copy.criterionSummary(criterion.maxPoints, criterion.weight)}</span>
                          </div>
                          <span className="badge indigo">{isExpanded ? copy.collapseCriterion : copy.expandCriterion}</span>
                        </button>
                        {isExpanded ? (
                          <div className="criterion-details">
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
                        ) : null}
                      </div>
                      );
                    })}
                  </div>
                  <div className="button-row">
                    <button type="button" className="button secondary" onClick={addCriterion}>
                      {copy.addCriterion}
                    </button>
                    <button type="button" className="button" onClick={saveOrganizerChanges}>
                      {copy.saveEvent}
                    </button>
                  </div>
                </div>
              </div>

              <div className="panel">
                <div className="panel-inner stack">
                  <div className="section-header">
                    <div>
                      <h2>{copy.teacherQrLogin}</h2>
                      <p>{copy.teacherQrLoginDesc}</p>
                    </div>
                  </div>
                  {teacherQrLoginUrl ? (
                    <div className="qr-layout">
                      <div className="qr-code" aria-label={copy.teacherQrLogin}>
                        <QRCodeSVG value={teacherQrLoginUrl} size={192} bgColor="#ffffff" fgColor="#09111f" level="M" includeMargin />
                      </div>
                      <div className="stack">
                        <div>
                          <label className="label" htmlFor="teacher-qr-name">
                            {copy.teacherQrName}
                          </label>
                          <input
                            id="teacher-qr-name"
                            className="field"
                            value={teacherQrName}
                            onChange={(event) => setTeacherQrName(event.target.value)}
                            placeholder={copy.teacherQrNamePlaceholder}
                          />
                        </div>
                        <div>
                          <label className="label" htmlFor="teacher-qr-link">
                            {copy.teacherQrLink}
                          </label>
                          <input id="teacher-qr-link" className="field" value={teacherQrLoginUrl} readOnly />
                        </div>
                        <div className="button-row">
                          <button type="button" className="button secondary" onClick={copyTeacherQrLink}>
                            {copy.copyTeacherQrLink}
                          </button>
                          <a className="button secondary" href={teacherQrLoginUrl}>
                            {copy.openTeacherQrLogin}
                          </a>
                        </div>
                        {teacherQrMessage ? <div className="footer-note">{teacherQrMessage}</div> : null}
                      </div>
                    </div>
                  ) : (
                    <div className="footer-note">{copy.teacherQrLoginUnavailable}</div>
                  )}
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
                      <strong>{organizerGradingType === "rubric" ? copy.rubricScaleOption : copy.directScore}</strong>
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
                  <div className="criterion-card">
                    <div className="section-header">
                      <div>
                        <h2>{copy.importParticipantsCsv}</h2>
                        <p>{copy.importParticipantsCsvDesc}</p>
                      </div>
                    </div>
                    <div className="grid-2">
                      <div>
                        <label className="label" htmlFor="participant-csv">
                          {copy.csvFile}
                        </label>
                        <input id="participant-csv" className="field" type="file" accept=".csv,text/csv" onChange={importParticipantsFromCsv} />
                      </div>
                      <div className="button-row" style={{ alignItems: "end" }}>
                        <button className="button secondary" onClick={downloadParticipantTemplate}>
                          {copy.downloadParticipantTemplate}
                        </button>
                      </div>
                    </div>
                    <div style={{ marginTop: 12 }}>
                      <label className="label" htmlFor="participant-csv-text">
                        {copy.pasteParticipantsCsv}
                      </label>
                      <textarea
                        id="participant-csv-text"
                        className="textarea"
                        value={participantCsvText}
                        onChange={(event) => setParticipantCsvText(event.target.value)}
                        placeholder={'"Team name","Project title","Description"\n"Team Example","Project Example","Optional notes"'}
                      />
                    </div>
                    <div className="button-row" style={{ marginTop: 12 }}>
                      <button className="button secondary" onClick={() => applyParticipantCsv(participantCsvText)} disabled={!participantCsvText.trim()}>
                        {copy.importPastedCsv}
                      </button>
                    </div>
                    {participantImportMessage ? <div className="footer-note" style={{ marginTop: 8 }}>{participantImportMessage}</div> : null}
                  </div>
                  <div className="criteria-list">
                    <div className="section-header" style={{ marginBottom: 0 }}>
                      <div>
                        <h2>{copy.teamRoster}</h2>
                        <p>{copy.teamRosterDesc}</p>
                      </div>
                    </div>
                    {participants.map((participant) => {
                      const isEditing = editingParticipantId === participant.id;

                      return (
                        <div className="criterion-card" key={participant.id}>
                          {isEditing ? (
                            <div className="stack">
                              <div className="grid-2">
                                <div>
                                  <label className="label" htmlFor={`edit-team-name-${participant.id}`}>
                                    {copy.teamName}
                                  </label>
                                  <input
                                    id={`edit-team-name-${participant.id}`}
                                    className="field"
                                    aria-label={`${copy.teamName} (${copy.editTeam})`}
                                    value={editingParticipantName}
                                    onChange={(event) => setEditingParticipantName(event.target.value)}
                                  />
                                </div>
                                <div>
                                  <label className="label" htmlFor={`edit-team-title-${participant.id}`}>
                                    {copy.projectTitle}
                                  </label>
                                  <input
                                    id={`edit-team-title-${participant.id}`}
                                    className="field"
                                    aria-label={`${copy.projectTitle} (${copy.editTeam})`}
                                    value={editingParticipantTitle}
                                    onChange={(event) => setEditingParticipantTitle(event.target.value)}
                                  />
                                </div>
                              </div>
                              <div className="button-row">
                                <button type="button" className="button" onClick={saveParticipantEdits} disabled={!editingParticipantName.trim()}>
                                  {copy.saveTeam}
                                </button>
                                <button type="button" className="button secondary" onClick={cancelEditingParticipant}>
                                  {copy.cancelEdit}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="criterion-top">
                              <div>
                                <strong>{participant.name}</strong>
                                <span>{participant.title}</span>
                              </div>
                              <div className="button-row">
                                <button type="button" className="button secondary" onClick={() => startEditingParticipant(participant)}>
                                  {copy.editTeam}
                                </button>
                                <button type="button" className="button warn" onClick={() => deleteParticipant(participant.id)}>
                                  {copy.deleteTeam}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
              ) : null}
              {organizerTab === "scores" ? renderJudgeScoreReview() : null}
              {organizerTab === "monitor" ? renderEventMonitor() : null}
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
                  <div className="button-row">
                    <button className="button secondary" onClick={downloadResultsCsv}>
                      {copy.downloadResultsCsv}
                    </button>
                    {role === "guest" ? <span className="badge amber">{copy.viewOnly}</span> : null}
                  </div>
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
                      <h2>{copy.eventManagement}</h2>
                      <p>{copy.eventManagementDesc}</p>
                    </div>
                  </div>
                  <button className="button" onClick={() => {
                    setOrganizerTab("setup");
                    setSection("organizer");
                  }}>
                    {copy.openEventBuilder}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {activeSection === "translations" && isDeveloper ? (
            <div className="panel">
              <div className="panel-inner stack">
                <div className="section-header">
                  <div>
                    <h2>{copy.translationEditor}</h2>
                    <p>{copy.translationEditorDesc}</p>
                  </div>
                  <div className="button-row">
                    <button className="button secondary" onClick={() => resetLanguageOverrides(translationEditorLanguage)}>
                      {copy.resetLanguageOverrides}
                    </button>
                    <button className="button" onClick={publishTranslationOverrides}>
                      {copy.publishTranslationOverrides}
                    </button>
                  </div>
                </div>
                {translationPublishMessage ? <div className="footer-note">{translationPublishMessage}</div> : null}
                <div className="grid-2">
                  <div>
                    <label className="label" htmlFor="translation-language">
                      {copy.editLanguage}
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
                      {copy.searchTranslations}
                    </label>
                    <input
                      id="translation-search"
                      className="field"
                      value={translationSearch}
                      onChange={(event) => setTranslationSearch(event.target.value)}
                      placeholder={copy.searchTranslationsPlaceholder}
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
                            <span>{isEdited ? copy.edited : copy.defaultValue}</span>
                          </div>
                          <button className="button secondary" onClick={() => resetTranslationOverride(translationEditorLanguage, key)} disabled={!isEdited}>
                            {copy.resetLanguageOverrides}
                          </button>
                        </div>
                        <label className="label" htmlFor={fieldId} style={{ marginTop: 12 }}>
                          {copy.currentText}
                        </label>
                        <textarea
                          id={fieldId}
                          className="textarea"
                          value={currentValue}
                          aria-label={`Translation ${translationEditorLanguage} ${key}`}
                          onChange={(event) => updateTranslationOverride(translationEditorLanguage, key, event.target.value)}
                        />
                        <div className="footer-note">{copy.defaultText.replace("{value}", baseValue)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
