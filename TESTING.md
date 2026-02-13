# ScoutFundraiser Testing Guide

This project is a static web app (no `package.json`), so use a local HTTP server for testing.

## 1) Start the App Locally

From the project folder, run one of these commands:

- `py -m http.server 5500`
- `python -m http.server 5500`

Then open:

- `http://localhost:5500`

Do not use `file://` URLs (Firebase Auth requires `http://` or `https://`).

## 2) Pre-Test Firebase Checks

- Firebase project exists and matches values in `firebase-config.js`
- Authentication → Email/Password is enabled
- Firestore Database is created

## 3) Smoke Test Checklist

### Auth

- [ ] Sign up with a new email/password
- [ ] Log out
- [ ] Sign in with the same account
- [ ] Invalid login shows an error message

### Quick Log

- [ ] Log a Scout Card sale
- [ ] Log a Donation
- [ ] Entries appear without UI errors

### Sales + Dashboard

- [ ] New records appear in Sales list
- [ ] Totals update in Dashboard
- [ ] Date/type/amount display correctly

### Persistence

- [ ] Refresh browser and confirm data still loads
- [ ] Close and reopen browser; sign back in and confirm data remains

### Firestore Verification

- [ ] In Firebase Console, confirm data under `users/{uid}/sales`
- [ ] Confirm each new sale has expected fields and a timestamp

### PWA / Runtime

- [ ] App loads without fatal console errors
- [ ] Install prompt appears when eligible
- [ ] Reload works correctly after install

## 4) Negative/Edge Checks

- [ ] Attempt empty required form fields (should be blocked)
- [ ] Enter invalid email format (should be rejected)
- [ ] Test with network offline (app should fail gracefully)

## 5) Quick Regression Pass Before Release

- [ ] Auth flows still work
- [ ] Quick Log still submits both sale types
- [ ] Dashboard totals still match Sales records
- [ ] No new console errors during normal usage

## 6) Common Issues

- `npm run build` fails with ENOENT: expected for this repo (no `package.json`)
- “Unsupported Launch Mode”: app was opened with `file://` or storage is blocked
- Auth errors: Email/Password not enabled in Firebase Auth
- Data not saving: Firestore not created or project config mismatch
