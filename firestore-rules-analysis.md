# Firestore Rules Analysis

## Firestore Instance

- Project: `grading-app-486a3`
- Database: `(default)`
- Edition: `STANDARD`
- Type: `FIRESTORE_NATIVE`

## Collections Used By The App

- `users/{uid}`: user profile, email/display name/photo, role, timestamps.
- `events/{eventId}`: event setup, owner metadata, criteria, status, grading type.
- `participants/{participantId}`: participant data plus denormalized `eventId`.
- `scorecards/{scorecardId}`: judge scorecard data keyed by judge and participant.
- `appConfig/translations`: published UI translation overrides.

## Access Patterns

- The client subscribes to all four app data collections with collection-level `onSnapshot` reads.
- The client subscribes to `appConfig/translations` as a document-level `onSnapshot`.
- Google users create or update their own `users/{uid}` document on sign-in.
- Teacher QR login uses Firebase anonymous auth and creates/updates `users/{uid}` as a `judge`.
- Organizers/developers write events and participants.
- Judges/developers write scorecards where `judgeId == request.auth.uid`.
- Developers write roles and translation overrides.

## Rule Update Notes

- QR login intentionally has no expiry, one-time-use, or PIN behavior per product direction.
- Anonymous QR users are still authenticated Firebase users so scorecards can retain a stable `judgeId`.
- App-wide collection snapshots require broad read access for authenticated app users.

## Devil's Advocate Review

- Public unauthenticated reads: blocked because every read path still requires `canAccessApp()`.
- School account writes: Google users can only create their own user doc as `guest`; privileged roles still require developer updates.
- QR role escalation: anonymous users can only write their own `users/{uid}` document with `role == "judge"` and `email == ""`.
- Scorecard spoofing: scorecard writes still require `request.resource.data.judgeId == request.auth.uid`.
- Translation publishing: only developer role users can create/update/delete `appConfig/translations`.
- Known accepted risk: authenticated app users, including anonymous QR teachers, can read app-wide collections because the current client subscribes to whole collections.
