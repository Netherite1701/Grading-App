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
});
