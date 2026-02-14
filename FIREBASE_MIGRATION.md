# Firebase Migration Guide - Troop 242 Scout Fundraiser

## Status
The app has been updated to support Firebase with email/password authentication. Each scout gets their own account and logs their sales.

## What's Been Done
✅ Firebase configuration file created (`firebase-config.js`)
✅ Firebase services layer created (`firebase-services.js`)
✅ Sign-up and sign-in UI implemented 
✅ Firebase SDK loaded in (`index.html`)
✅ Auth state handling framework in place

## What Still Needs to be Done - CRITICAL

### Step 1: Create a Firebase Project
1. Go to https://console.firebase.google.com
2. Click "Create a new project", name it "ScoutFundraiser"
3. Enable Google Analytics (optional)
4. Once created, go to **Project Settings** (gear icon)
5. Copy the Web SDK config
6. Paste it into `firebase-config.js`, replacing the placeholder values

### Step 2: Enable Authentication
1. In Firebase Console, go to **Authentication**
2. Click **Set up sign-in method**
3. Enable **Email/Password**

### Step 3: Enable Firestore Database
1. In Firebase Console, go to **Firestore Database**
2. Click **Create Database**
3. Choose **Start in Test Mode** (for development)
4. Select a location (US or closest to your region)

### Step 4: Complete the app.js Conversion
The app.js file still contains old localStorage logic. Once Firebase is configured, the following methods in `ScoutFundraiserApp` class need to be updated:

- `setupLandingPage()` - DONE (replaced with `setupAuthUI()`)
- `setupQuickLogPage()` - Still uses old scout/sale service methods
- `setupSalesPage()` - Still uses old  localStorage
- `setupDashboardPage()` - Still uses old service layer
- `loadSettings() / saveSettings()` - Should use FirestoreStore
- `submitQuickLog()` - Need to use Firebase sale service

**Quick Migration Path:**
Since the core logic (Quick Log, Sales list,  Dashboard display) is already written, you just need to swap the data layer:
- Replace all `this.scoutService` calls with `this.firebaseScoutService`
- Replace all `this.saleService` calls with `this.firebaseSaleService`  
- Replace all `this.settingsService` calls with `this.firebaseSettingsService`
- Remove `localStorage` calls
- Make methods async where they call Firebase

Example before:
```javascript
const scout = this.scoutService.getScoutById(id);
```

After:
```javascript
const scout = await this.firebaseScoutService.getScoutById(id);
```

### Step 5: Test
1. Open the app
2. Sign up with a test email/password
3. Log a sale via Quick Log
4. Check Firestore Dashboard to see data saved

## File Structure
```
├── index.html              # UI with signup/login tabs
├── app.js                  # Main app logic (PARTIALLY CONVERTED)
├── firebase-config.js      # Firebase credentials (NEEDS YOUR CONFIG)
├── firebase-services.js    # Firebase data services (READY)
├── firebase-auth.js        # (NEW - Authentication utilities)
├── firebase-data.js        # (NEW - Simplified data retrieval)
```

## Security Rules
This project now includes a dedicated [firestore.rules](firestore.rules) file.

Key behavior in the rules:
- unit members can read `units/{unitId}/scouts`, `products`, and `orders`
- unit `leader` or `admin` can create/update scouts, products, and orders
- only unit `admin` can delete scouts and unit docs
- each user can read/write only their own `users/{uid}` data and sales

## Role Permissions Matrix (Current App Behavior)

The app currently supports four roles: `admin`, `leader`, `scout`, and `parent`.

### Admin
- Operations page access
- Add products
- Adjust inventory
- Submit product orders
- View/edit fundraising settings
- Delete scouts from unit roster
- No Communication page access

### Leader
- Operations page access
- Add products
- Adjust inventory
- Submit product orders
- View/edit fundraising settings
- Cannot delete scouts (admin-only)
- No Communication page access

### Scout
- Communication page access (share/outreach)
- Quick Log, Dashboard, Sales, Scouts, Leaderboard access
- Personal goal prompt and personal goal updates
- No Operations page access
- No fundraising settings management

### Parent/Guardian
- Quick Log, Dashboard, Sales, Scouts, Leaderboard access
- No Communication page access
- No Operations page access
- No fundraising settings management

### Notes on Scouts Data
- Scouts are displayed from database data only (no in-app scout add form).
- If shared unit scout docs are empty, app can derive scout rows from sales/legacy data for display.

Deploy the rules from Firebase Console (Firestore Database → Rules) by pasting the contents of [firestore.rules](firestore.rules), or deploy with Firebase CLI if configured.

### Firebase CLI Quick Deploy
This repo now includes:
- [firebase.json](firebase.json) (points Firestore rules to [firestore.rules](firestore.rules))
- [.firebaserc](.firebaserc) (set your default project)

Steps:
1. Replace `YOUR_FIREBASE_PROJECT_ID` in [.firebaserc](.firebaserc) with your real Firebase project ID.
2. Install Firebase CLI (one time): `npm install -g firebase-tools`
3. Login: `firebase login`
4. Deploy rules: `firebase deploy --only firestore:rules`

##  Troubleshooting
- **"Firebase config not loaded"** → Check `firebase-config.js` has your real credentials
- **Auth errors** → Ensure Firebase Authentication > Email/Password is enabled
- **No data saves** → Check Firestore Database exists and is in test mode
- **Cross-origin errors** → May need to add your domain to Firebase console

## Next Steps
1. Create Firebase project
2. Add your credentials to `firebase-config.js`
3. Finish updateing app.js methods to use async Firebase services
4. Test signup and sales logging
5. Deploy!
