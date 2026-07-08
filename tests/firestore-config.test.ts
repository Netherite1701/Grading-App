import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const workspaceRoot = process.cwd();

function readWorkspaceFile(path: string) {
  return readFileSync(join(workspaceRoot, path), "utf8");
}

describe("Firebase deployment contract", () => {
  it("binds the repo to the intended Firebase project", () => {
    const firebaserc = JSON.parse(readWorkspaceFile(".firebaserc")) as {
      projects?: { default?: string };
    };

    expect(firebaserc.projects?.default).toBe("grading-app-486a3");
  });

  it("keeps the Firebase CLI scripts pointed at the intended project", () => {
    const packageJson = JSON.parse(readWorkspaceFile("package.json")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["firebase:use"]).toBe("firebase use grading-app-486a3");
    expect(packageJson.scripts?.["firebase:rules"]).toBe("firebase deploy --only firestore --project grading-app-486a3");
  });

  it("keeps firebase.json wired to the checked-in Firestore rules and indexes", () => {
    const firebaseJson = JSON.parse(readWorkspaceFile("firebase.json")) as {
      firestore?: { rules?: string; indexes?: string };
    };

    expect(firebaseJson.firestore?.rules).toBe("firestore.rules");
    expect(firebaseJson.firestore?.indexes).toBe("firestore.indexes.json");
  });

  it("does not use unsupported Firestore rule helpers", () => {
    const rules = readWorkspaceFile("firestore.rules");

    expect(rules).not.toMatch(/\blower\s*\(/);
    expect(rules).not.toMatch(/\bupper\s*\(/);
    expect(rules).not.toMatch(/\breplace\s*\(/);
  });

  it("accepts the stored role variants that the app already normalizes", () => {
    const rules = readWorkspaceFile("firestore.rules");
    const expectedRoleLiterals = [
      '"developer"',
      '"Developer"',
      '"DEVELOPER"',
      '"dev"',
      '"Dev"',
      '"DEV"',
      '"organizer"',
      '"Organizer"',
      '"ORGANIZER"',
      '"admin"',
      '"Admin"',
      '"ADMIN"',
      '"judge"',
      '"Judge"',
      '"JUDGE"',
      '"guest"',
      '"Guest"',
      '"GUEST"'
    ];

    expectedRoleLiterals.forEach((roleLiteral) => {
      expect(rules).toContain(roleLiteral);
    });
  });

  it("protects organizer writes behind the canonical users/{auth.uid} role lookup", () => {
    const rules = readWorkspaceFile("firestore.rules");

    expect(rules).toContain("/documents/users/$(request.auth.uid)");
    expect(rules).toContain("allow create, update, delete: if isOrganizer();");
  });

  it("allows Firebase anonymous auth for teacher QR judge sessions", () => {
    const rules = readWorkspaceFile("firestore.rules");

    expect(rules).toContain('request.auth.token.firebase.sign_in_provider == "anonymous"');
    expect(rules).toContain("function isTeacherQrUserWrite(uid)");
    expect(rules).toContain('request.resource.data.role == "judge"');
  });

  it("stores published translation overrides in appConfig/translations", () => {
    const rules = readWorkspaceFile("firestore.rules");

    expect(rules).toContain("match /appConfig/{configId}");
    expect(rules).toContain('configId == "translations" && isDeveloper()');
  });

  it("documents the required Firebase auth domain and App Check env vars", () => {
    const envExample = readWorkspaceFile(".env.local.example");

    expect(envExample).toContain("NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN=soongsil.net");
    expect(envExample).toContain("NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY=");
  });

  it("keeps .env.local out of source control", () => {
    const gitignore = readWorkspaceFile(".gitignore");

    expect(gitignore).toContain(".env.local");
  });

  it("requires verified soongsil.net accounts before Firestore access", () => {
    const rules = readWorkspaceFile("firestore.rules");

    expect(rules).toContain("request.auth != null");
    expect(rules).toContain("request.auth.token.email_verified == true");
    expect(rules).toContain('request.auth.token.email.matches("^[^@]+@soongsil\\\\.net$")');
    expect(rules).toContain("allow read: if canAccessApp();");
    expect(rules).toContain("hasAllowedEmailDomain() || isTeacherQrAuth()");
  });
});
