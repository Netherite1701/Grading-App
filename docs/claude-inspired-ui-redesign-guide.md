# Claude-Inspired UI Redesign Guide

This guide describes how to redesign the Grading App UI in a Claude-inspired direction: calm, text-first, spacious, trustworthy, and easy to operate under event pressure. The goal is not to copy Claude's interface exactly, but to adopt a similar design posture: restrained surfaces, warm neutrals, clear hierarchy, and low-friction workflows.

## Design Direction

Use the app as an operational grading console, not a flashy marketing product.

The current UI uses a dark glassmorphism style with strong gradients, glowing panels, large hero text, and heavy card treatment. For the redesign, move toward a calmer application shell:

- Prefer warm light neutrals over dark blue/purple gradients.
- Use fewer floating panels and less visual glow.
- Make typography and spacing do more of the work.
- Keep key actions obvious but not loud.
- Make judge, organizer, developer, and guest views feel like parts of one coherent tool.

Recommended visual keywords:

- calm
- editorial
- focused
- spacious
- precise
- warm
- low-noise

Avoid:

- decorative orbs
- glass blur as the main visual identity
- saturated purple/blue gradients
- oversized hero treatment on operational screens
- nested cards
- animated or ornamental UI that does not help the workflow

## Color System

Replace the current dark palette with a warm neutral system.

Suggested tokens:

```css
:root {
  --bg: #f7f3eb;
  --surface: #fffaf2;
  --surface-muted: #f0e8dc;
  --line: #ded2c2;
  --text: #231f1a;
  --muted: #6f665b;
  --accent: #8a5a32;
  --accent-soft: #ead8c4;
  --success: #2f7d56;
  --warning: #a66a1f;
  --danger: #b54747;
  --radius: 10px;
  --radius-sm: 6px;
}
```

Use color sparingly:

- Accent color for primary actions and selected navigation.
- Success/warning/danger only for status.
- Muted background bands for layout.
- Thin borders instead of heavy shadows.

## Typography

Use a readable system sans stack. Keep the interface crisp and mature.

Recommended direction:

- Body: 15-16px.
- Section headings: 18-22px.
- Page title: 28-36px, not hero-sized.
- Labels: 13-14px, medium weight.
- Metrics: readable but not oversized.

Avoid negative letter spacing and viewport-scaled typography. The grading app is a tool; it should stay stable across screen sizes.

## Layout Principles

The first screen should be the usable app, not a landing page.

Recommended shell:

- Top bar: app name, selected event, auth/account controls, language selector.
- Left sidebar: role/view navigation.
- Main content: active workflow.
- Right rail only when it contains useful context, such as event status, scoring summary, or current judge progress.

Use full-width bands or constrained sections rather than many floating panels. Cards should be used for repeated objects like teams, criteria, users, and scorecards.

## Component Direction

### Buttons

Primary buttons should feel clear but quiet.

- Primary: solid warm accent.
- Secondary: neutral surface with border.
- Destructive/warning: muted red or amber treatment.
- Disabled actions should explain why they are unavailable nearby.

For Firebase login:

- Show "Sign in with Google" only when Firebase is configured.
- If Firebase is missing, show a non-actionable setup message instead of a disabled login button.
- Keep local demo mode visibly separate from real Firebase auth.

### Navigation

Use a simple sidebar or tab row with clear active states.

Good labels:

- Judge
- Organizer
- Standings
- Developer
- Translations

Avoid role labels that feel like separate apps. The user should feel they are moving between views inside one console.

### Forms

Forms should feel calm and predictable.

- Labels above fields.
- Help text below fields only when necessary.
- Keep field borders visible.
- Use compact vertical rhythm.
- Put save/create actions at the end of the form section.

### Tables

Standings and developer user management should be scannable.

- Use clear table headers.
- Align numeric values consistently.
- Keep row height moderate.
- Use badges for status, not for every minor value.

### Score Controls

Judge scoring must be fast and touch-friendly.

- Keep selected team and selected criterion visible.
- Use segmented controls or grade chips for rubric levels.
- Show current weighted total in a persistent summary.
- Keep save state visible: unsaved, saving, saved, failed.

## View-by-View Redesign Notes

### Guest / Standings View

Make this the clearest read-only surface.

Recommended structure:

- Event selector or event title.
- Top three ranking summary.
- Full standings table.
- CSV export action.
- Small "View only" badge.

Reduce decorative podium styling if it competes with the table.

### Judge View

Prioritize speed.

Recommended structure:

- Team selector at top.
- Criteria list with rubric controls.
- Notes field.
- Sticky score summary and save button on desktop.
- On mobile, keep save button near the bottom but visible after scoring.

### Organizer View

Split into clear sections:

- Event details.
- Scoring model and criteria.
- Teams.
- CSV import/export.
- Teacher QR login.

Avoid one long panel where all controls look equally important.

### Developer View

Keep it dense and administrative.

Recommended structure:

- Firebase status.
- User role table.
- Event management shortcut.
- Diagnostics preview.

Avoid hero or decorative treatment here.

### Translations View

This can become heavy because it renders many editable text fields.

Recommended improvements:

- Search first.
- Language selector near the top.
- Show changed keys first.
- Consider rendering only matched/visible fields.
- Use a compact row editor rather than full cards for every translation key.

## Implementation Plan

### Phase 1: Design Tokens

Update `app/globals.css` first.

Work items:

- Replace dark theme variables with warm neutral variables.
- Reduce `--radius` from large rounded cards to moderate radii.
- Remove radial gradient background.
- Remove grid overlay background.
- Replace heavy shadows with subtle borders.

Do this before touching JSX structure so visual changes are easy to review.

### Phase 2: App Shell

Refactor the top-level layout in `components/app-shell.tsx`.

Work items:

- Convert the hero into a compact app header.
- Move account, Firebase status, and language controls into a top bar or right-side utility area.
- Keep role navigation stable and predictable.
- Make the active event visible without oversized hero metrics.

### Phase 3: Workflow Sections

Redesign one view at a time.

Suggested order:

1. Guest / Standings
2. Judge
3. Organizer
4. Developer
5. Translations

After each view, run tests and visually check desktop and mobile.

### Phase 4: Interaction Polish

Add UI states that make the app feel reliable.

Required states:

- Firebase missing
- Signed out
- Signing in
- Signed in
- Firestore sync warning
- Saving
- Saved
- Save failed
- Empty events
- Empty teams
- Empty scorecards

### Phase 5: Accessibility and Responsiveness

Check:

- Keyboard navigation
- Visible focus states
- Button names
- Label associations
- Mobile wrapping
- Table overflow
- Touch target size
- Color contrast

## File Map

Primary files:

- `app/globals.css`: design tokens and component styling.
- `components/app-shell.tsx`: app layout and all view structure.
- `lib/i18n.ts`: UI copy for English and Korean.
- `tests/app-shell.test.tsx`: local/demo shell coverage.
- `tests/app-shell-firebase.test.tsx`: Firebase shell behavior.

Supporting files:

- `lib/firebase.ts`: auth and Firestore behavior.
- `lib/mock-data.ts`: demo data shown in local/demo flows.
- `lib/export.ts`: CSV-related UI behavior.

## Testing Checklist

Run after meaningful UI changes:

```bash
npm run typecheck
npm run test
npm run build
```

Manual browser checks:

- Signed-out Firebase app shows Google sign-in.
- Missing Firebase config does not show Google sign-in.
- Local demo mode only appears through `run-app-local-dev.bat`.
- Judge can select a team, score criteria, and save.
- Organizer can create an event and add/import teams.
- Developer can change roles.
- Translations can be edited and published.
- Standings export still downloads CSV.

## Acceptance Criteria

The redesign is successful when:

- The first screen feels like a working grading console.
- Users can immediately tell whether they are signed in, in demo mode, or missing Firebase config.
- Judges can score with fewer distractions.
- Organizers can edit events without hunting through dense panels.
- Tables and forms are easier to scan than before.
- The UI feels warm and calm without looking decorative.
- Existing tests pass or are intentionally updated with better coverage.

