# Grading Program

A judges-first, real-time hackathon and pitch grading platform built with Next.js and Firebase.

## What is included

- Organizer event setup
- Judge scoring workspace
- Weighted standings and podium view
- CSV export scaffold
- Firebase Authentication with Google sign-in
- Firestore-backed users, events, participants, scorecards, and roles

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Configure Firebase env vars in `.env.local`.

3. Run the app:

   ```bash
   npm run dev
   ```

## Firebase env vars

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`
- `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY`

## Firebase backend setup

1. In Firebase Console, enable Authentication > Google sign-in.

2. In Authentication > Settings > Authorized domains, add your local/deployed domains.

3. Create a Firestore database.

4. Deploy the included Firestore rules:

   ```bash
   firebase deploy --only firestore:rules
   ```

The app uses these top-level Firestore collections:

- `users`
- `events`
- `participants`
- `scorecards`

New Google users are created as `guest`. Developer users can assign roles from Developer tools.
