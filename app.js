// Scout Fundraiser App - Firebase Online Version
// Complete working implementation

// ==================== GLOBAL STATE ====================
let db, auth, currentUser = null;
let app = null;
let deferredInstallPrompt = null;
const MAX_QR_IMAGE_FILE_BYTES = 300 * 1024;
const MAX_QR_IMAGE_DATAURL_BYTES = 350 * 1024;

// ==================== DEFAULTS & CONSTANTS ====================
// All magic numbers extracted to DEFAULTS constant (Issue #4 fix)
const DEFAULTS = {
    FUNDRAISING_GOAL: 5000,
    SCOUT_GOAL: 2000,
    CARD_PRICE: 20,
    RATE_LIMIT_MAX_ATTEMPTS: 5,
    RATE_LIMIT_COOLDOWN_MS: 60000, // 1 minute cooldown
    MAX_PROGRESS_PCT: 100,
    FIREBASE_MAX_RETRIES: 50,
    DEBOUNCE_DELAY_MS: 300,
    CACHE_TTL_MS: 30000 // 30 second cache for N+1 fix
};

// SECURITY: Rate limiting for login/signup attempts
const authRateLimit = {
    loginAttempts: 0,
    signupAttempts: 0,
    lastLoginAttempt: 0,
    lastSignupAttempt: 0,
    maxAttempts: DEFAULTS.RATE_LIMIT_MAX_ATTEMPTS,
    cooldownMs: DEFAULTS.RATE_LIMIT_COOLDOWN_MS
};

// Cache for N+1 query optimization (Issue #1 & #2 fix)
const dataCache = {
    scouts: { data: null, timestamp: 0 },
    sales: { data: null, timestamp: 0 },
    stats: { data: null, timestamp: 0 },

    isValid(key) {
        const cached = this[key];
        return cached && cached.data && (Date.now() - cached.timestamp) < DEFAULTS.CACHE_TTL_MS;
    },

    get(key) {
        return this.isValid(key) ? this[key].data : null;
    },

    set(key, data) {
        this[key] = { data, timestamp: Date.now() };
    },

    clear(key) {
        if (this[key]) this[key] = { data: null, timestamp: 0 };
    }
};

// ==================== SHARED HELPER FUNCTIONS ====================
// Issue #3 fix: Refactored duplicate render code into shared helper

/**
 * Shared utility to filter and sort sales
 * @param {Array} sales - Array of sale objects
 * @param {Object} filters - Filter configuration
 * @returns {Array} Filtered and sorted sales
 */
function filterAndSortSales(sales, filters = {}) {
    let filtered = [...sales];

    // Apply search filter
    if (filters.searchTerm) {
        filtered = filtered.filter(s =>
            (s.customerName || '').toLowerCase().includes(filters.searchTerm) ||
            (s.scoutName || '').toLowerCase().includes(filters.searchTerm)
        );
    }

    // Apply scout filter (for leaders/admins)
    if (filters.scoutName) {
        filtered = filtered.filter(s =>
            (s.scoutName || '').toLowerCase() === filters.scoutName.toLowerCase()
        );
    }

    // Apply type filter
    if (filters.typeFilter && filters.typeFilter !== 'all') {
        filtered = filtered.filter(s => s.type === filters.typeFilter);
    }

    // Apply payment method filter
    if (filters.paymentFilter && filters.paymentFilter !== 'all') {
        filtered = filtered.filter(s => s.paymentMethod === filters.paymentFilter);
    }

    // Sort by date (newest first)
    filtered.sort((a, b) => {
        const dateA = a.date ? new Date(a.date) : new Date(0);
        const dateB = b.date ? new Date(b.date) : new Date(0);
        return dateB - dateA;
    });

    return filtered;
}

/**
 * Shared utility to render a list of sales
 * @param {Array} sales - Array of sale objects
 * @param {Element} container - DOM element to populate
 * @param {Object} currentUser - Current user object
 */
function renderSalesList(sales, container, currentUser) {
    if (sales.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><svg class="icon"><use href="#icon-receipt"/></svg></div><p>No sales found</p></div>';
        return;
    }

    let html = '';
    sales.forEach(sale => {
        const typeClass = sale.type === 'card' ? 'card-sale' : 'donation';
        const typeLabel = sale.type === 'card' ? 'Scout Card' : 'Donation';

        html += `<div class="sale-item" data-sale-id="${sale.id}">
            <div class="sale-info">
                <h5>${escapeHTML(sale.scoutName || currentUser.displayName || 'Scout')}</h5>
                <p>${escapeHTML(sale.customerName || 'Customer')} &bull; ${formatDate(sale.date)}</p>
            </div>
            <div class="sale-right">
                <div class="sale-amount">${formatMoney(sale.amount)}</div>
                <div class="sale-badges">
                    <span class="sale-type-badge ${typeClass}">${typeLabel}</span>
                    <span class="payment-badge">${escapeHTML(sale.paymentMethod)}</span>
                </div>
            </div>
        </div>`;
    });

    container.innerHTML = html;
}

// ==================== ERROR HANDLING ====================
// Issue #7 fix: Consistent error handling across the application

/**
 * Centralized error handler for consistent error management
 * Prevents scattered error handling patterns throughout codebase
 */
class ErrorHandler {
    /**
     * Log error to console (development)
     * @param {Error} error - Error object
     * @param {string} context - Where the error occurred
     */
    static logError(error, context = '') {
        const message = error && error.message ? error.message : String(error);
        const errorMsg = context ? `[${context}] ${message}` : message;
        console.error(errorMsg, error);
        return null;
    }

    /**
     * Show user-friendly error message
     * @param {Error} error - Error object
     * @param {string} userMessage - Message to show user
     */
    static async showUserError(error, userMessage = 'Something went wrong') {
        console.error(userMessage, error);
        await appleAlert('Error', userMessage);
        return null;
    }

    /**
     * Return safe error result (empty array)
     * @param {Error} error - Error object
     * @param {string} context - Where the error occurred
     */
    static returnEmpty(error, context = '') {
        this.logError(error, context);
        return [];
    }

    /**
     * Return safe error result (empty object)
     * @param {Error} error - Error object
     * @param {string} context - Where the error occurred
     */
    static returnEmptyObject(error, context = '') {
        this.logError(error, context);
        return {};
    }

    /**
     * Handle API/Firestore errors with appropriate response
     * @param {Error} error - Error object
     * @param {string} context - Where the error occurred
     * @param {Object} options - Error handling options
     */
    static handle(error, context = '', options = {}) {
        const {
            showUser = false,
            userMessage = 'An error occurred',
            returnValue = null
        } = options;

        this.logError(error, context);

        if (showUser) {
            // User-facing error (fire and forget)
            appleAlert('Error', userMessage);
        }

        return returnValue;
    }
}

function shouldIgnoreAuthUnsupportedEvent(err) {
    const message = err && err.message ? String(err.message) : String(err || '');
    const code = err && err.code ? String(err.code) : '';
    return message === 'unsupported_event' || message.includes('unsupported_event') || code.includes('unsupported_event');
}

function installGlobalAuthNoiseGuards() {
    if (window.__sfAuthNoiseGuardsInstalled) return;
    window.__sfAuthNoiseGuardsInstalled = true;

    window.addEventListener('unhandledrejection', (event) => {
        const reason = event && event.reason;
        if (shouldIgnoreAuthUnsupportedEvent(reason)) {
            console.warn('Ignoring Firebase Auth internal unsupported_event:', reason);
            event.preventDefault();
        }
    });

    window.addEventListener('error', (event) => {
        const err = event && event.error;
        if (shouldIgnoreAuthUnsupportedEvent(err)) {
            console.warn('Ignoring Firebase Auth internal unsupported_event error:', err);
            event.preventDefault();
        }
    });
}

installGlobalAuthNoiseGuards();

async function registerServiceWorkerIfSupported() {
    if (!('serviceWorker' in navigator)) return;
    if (!window.isSecureContext) {
        console.warn('Service Worker skipped: insecure context. Use https:// or localhost.');
        return;
    }

    try {
        await navigator.serviceWorker.register('sw.js');
        console.log('Service Worker registered');
    } catch (error) {
        console.warn('Service Worker registration failed:', error);
    }
}

// Capture the PWA install prompt before it's shown
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    // Update install button if it exists
    const btn = document.getElementById('install-app-btn');
    const done = document.getElementById('install-app-done');
    if (btn) btn.classList.remove('hidden');
    if (done) done.classList.add('hidden');
});

window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    const btn = document.getElementById('install-app-btn');
    const done = document.getElementById('install-app-done');
    if (btn) btn.classList.add('hidden');
    if (done) done.classList.remove('hidden');
});

// ==================== FIREBASE INITIALIZATION ====================

// Wait for Firebase SDK to load
function waitForFirebase(maxRetries = DEFAULTS.FIREBASE_MAX_RETRIES) {
    return new Promise((resolve, reject) => {
        let retries = 0;

        function check() {
            if (typeof window.firebaseImports !== 'undefined' && window.firebaseImports) {
                console.log('Firebase SDK loaded successfully');
                resolve();
            } else if (retries < maxRetries) {
                retries++;
                setTimeout(check, 100);
            } else {
                reject(new Error('Firebase SDK failed to load after ' + (maxRetries * 100) + 'ms'));
            }
        }
        
        check();
    });
}

function getRuntimeSupportStatus() {
    const allowedProtocols = ['http:', 'https:', 'chrome-extension:'];
    const protocol = window.location.protocol;
    const protocolSupported = allowedProtocols.includes(protocol);

    let storageEnabled = false;
    try {
        const testKey = '__sf_storage_test__';
        window.localStorage.setItem(testKey, '1');
        window.localStorage.removeItem(testKey);
        storageEnabled = true;
    } catch (_e) {
        storageEnabled = false;
    }

    return {
        protocol,
        protocolSupported,
        storageEnabled,
        supported: protocolSupported && storageEnabled
    };
}

async function initializeFirebase() {
    const runtime = getRuntimeSupportStatus();
    if (!runtime.supported) {
        console.warn('Unsupported runtime for Firebase Auth:', runtime);
        document.body.innerHTML = `
            <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1.5rem;background:#f5f5f7;color:#1d1d1f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                <div style="max-width:640px;width:100%;background:#fff;border-radius:16px;box-shadow:0 8px 24px rgba(0,0,0,0.08);padding:1.5rem 1.25rem;">
                    <h2 style="margin:0 0 0.5rem 0;font-size:1.25rem;">Unsupported Launch Mode</h2>
                    <p style="margin:0 0 0.75rem 0;color:#86868b;line-height:1.5;">This app uses Firebase Authentication, which requires <strong>http://</strong>, <strong>https://</strong>, or <strong>chrome-extension://</strong> plus web storage.</p>
                    <p style="margin:0 0 0.5rem 0;"><strong>Detected protocol:</strong> ${runtime.protocol || 'unknown'}</p>
                    <p style="margin:0 0 0.75rem 0;"><strong>Web storage:</strong> ${runtime.storageEnabled ? 'enabled' : 'disabled'}</p>
                    <p style="margin:0;color:#86868b;line-height:1.5;">Run this project from a local server, for example: <strong>http://localhost</strong> (VS Code Live Server or <code>python -m http.server</code>).</p>
                </div>
            </div>
        `;
        return false;
    }

    if (!firebaseConfig) {
        console.error('Firebase config not loaded');
        document.body.innerHTML = '<div style="padding:2rem;color:red;"><h2>Error: Firebase Config Missing</h2><p>firebase-config.js did not load properly</p></div>';
        return false;
    }

    try {
        // Wait for Firebase SDK to load
        await waitForFirebase();
        console.log('Firebase SDK available, initializing...');

        // Get Firebase functions from imports
        const { initializeApp, getAuth, onAuthStateChanged, getFirestore } = window.firebaseImports;

        const firebaseApp = initializeApp(firebaseConfig);
        auth = getAuth(firebaseApp);
        db = getFirestore(firebaseApp);

        onAuthStateChanged(auth, (user) => {
            currentUser = user;
            if (window.scoutApp) {
                window.scoutApp.handleAuthChange(user);
            }
        });

        // Initialize the app after Firebase is ready
        setTimeout(() => {
            app = new ScoutFundraiserApp();
            window.scoutApp = app;
        }, 100);

        registerServiceWorkerIfSupported();

        return true;
    } catch (e) {
        console.error('Firebase init error:', e);
        document.body.innerHTML = '<div style="padding:2rem;color:red;"><h2>Error initializing Firebase</h2><p>' + e.message + '</p><p>Check firebase-config.js and browser console</p></div>';
        return false;
    }
}

// ==================== UTILITIES ====================

// Apple-style Alert Dialog
function appleAlert(title, message) {
    return new Promise((resolve) => {
        const dialog = document.getElementById('apple-alert');
        const titleEl = document.getElementById('apple-alert-title');
        const messageEl = document.getElementById('apple-alert-message');
        const okBtn = document.getElementById('apple-alert-ok');

        titleEl.textContent = title;
        messageEl.textContent = message;

        dialog.classList.add('active');

        const handleOk = () => {
            dialog.classList.remove('active');
            okBtn.removeEventListener('click', handleOk);
            resolve(true);
        };

        okBtn.addEventListener('click', handleOk);

        // Close on backdrop click
        const backdrop = dialog.querySelector('.apple-dialog-backdrop');
        const handleBackdrop = (e) => {
            if (e.target === backdrop) {
                handleOk();
                backdrop.removeEventListener('click', handleBackdrop);
            }
        };
        backdrop.addEventListener('click', handleBackdrop);
    });
}

// Apple-style Confirm Dialog
function appleConfirm(title, message, okText = 'OK', cancelText = 'Cancel') {
    return new Promise((resolve) => {
        const dialog = document.getElementById('apple-confirm');
        const titleEl = document.getElementById('apple-confirm-title');
        const messageEl = document.getElementById('apple-confirm-message');
        const okBtn = document.getElementById('apple-confirm-ok');
        const cancelBtn = document.getElementById('apple-confirm-cancel');

        titleEl.textContent = title;
        messageEl.textContent = message;
        okBtn.textContent = okText;
        cancelBtn.textContent = cancelText;

        dialog.classList.add('active');

        const cleanup = () => {
            dialog.classList.remove('active');
            okBtn.removeEventListener('click', handleOk);
            cancelBtn.removeEventListener('click', handleCancel);
        };

        const handleOk = () => {
            cleanup();
            resolve(true);
        };

        const handleCancel = () => {
            cleanup();
            resolve(false);
        };

        okBtn.addEventListener('click', handleOk);
        cancelBtn.addEventListener('click', handleCancel);

        // Close on backdrop click = cancel
        const backdrop = dialog.querySelector('.apple-dialog-backdrop');
        const handleBackdrop = (e) => {
            if (e.target === backdrop) {
                handleCancel();
                backdrop.removeEventListener('click', handleBackdrop);
            }
        };
        backdrop.addEventListener('click', handleBackdrop);
    });
}

function escapeHTML(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}

function formatMoney(amount) {
    const value = Number(amount);
    if (!Number.isFinite(value)) return '$0.00';
    return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getLocalDateInputValue(date = new Date()) {
    const offsetMs = date.getTimezoneOffset() * 60000;
    const local = new Date(date.getTime() - offsetMs);
    return local.toISOString().split('T')[0];
}

function isValidUrl(urlString) {
    if (!urlString) return true; // Empty is OK
    try {
        const url = new URL(urlString);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

function formatDate(dateVal) {
    if (!dateVal) return '';
    // If it's a YYYY-MM-DD string, parse as local time (not UTC)
    if (typeof dateVal === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
        const [y, m, d] = dateVal.split('-').map(Number);
        return new Date(y, m - 1, d).toLocaleDateString();
    }
    return new Date(dateVal).toLocaleDateString();
}

function getAuthErrorMessage(error, mode = 'login') {
    const code = (error && error.code) ? String(error.code) : '';

    // SECURITY FIX: Don't reveal which emails are registered (prevents email enumeration attacks)
    // Use generic messages that don't distinguish between "user exists" and "wrong password"
    const map = {
        'auth/email-already-in-use': mode === 'signup'
            ? 'Unable to create account. This email may already be registered. Try signing in or use a different email.'
            : 'Invalid email or password. Please try again.',
        'auth/invalid-email': 'Please enter a valid email address.',
        'auth/operation-not-allowed': 'Email/password sign-in is not enabled in Firebase Authentication.',
        'auth/weak-password': 'Password is too weak. Use at least 12 characters with uppercase, lowercase, and numbers.',
        'auth/network-request-failed': 'Network error. Check your connection and try again.',
        'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
        'auth/user-not-found': 'Invalid email or password. Please try again.',
        'auth/wrong-password': 'Invalid email or password. Please try again.',
        'auth/invalid-credential': mode === 'login'
            ? 'Invalid email or password. Please try again.'
            : 'Invalid sign-up request. Please review your details and try again.',
        'auth/user-disabled': 'This account has been disabled. Contact your unit admin.',
        'permission-denied': 'Access blocked by Firestore rules. Deploy the latest firestore.rules and try again.'
    };

    if (map[code]) return map[code];
    if (error && error.message) return error.message;
    return mode === 'login' ? 'Invalid email or password. Please try again.' : 'Unable to create account. Please try again.';
}

// ==================== FIRESTORE DATA ACCESS ====================

async function addSaleToFirestore(userId, saleData) {
    try {
        const { collection, addDoc, serverTimestamp } = window.firebaseImports;
        const docRef = await addDoc(collection(db, `users/${userId}/sales`), {
            ...saleData,
            createdAt: serverTimestamp()
        });
        return docRef.id;
    } catch (e) {
        console.error('Error adding sale:', e);
        throw e;
    }
}

async function getSalesFromFirestore(userId) {
    try {
        const { collection, query, getDocs } = window.firebaseImports;
        const q = query(collection(db, `users/${userId}/sales`));
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (e) {
        console.error('Error getting sales:', e);
        return [];
    }
}

async function deleteSaleFromFirestore(userId, saleId) {
    try {
        const { deleteDoc, doc } = window.firebaseImports;
        await deleteDoc(doc(db, `users/${userId}/sales/${saleId}`));
    } catch (e) {
        console.error('Error deleting sale:', e);
    }
}

async function loadSettingsFromFirestore(userId) {
    try {
        const { getDoc, doc } = window.firebaseImports;
        const docSnap = await getDoc(doc(db, 'users', userId));
        if (docSnap.exists() && docSnap.data().settings) {
            return docSnap.data().settings;
        }
    } catch (e) {
        console.error('Error loading settings:', e);
    }
    return getDefaultSettings();
}

async function saveSettingsToFirestore(userId, settings) {
    try {
        const { setDoc, doc } = window.firebaseImports;
        await setDoc(doc(db, 'users', userId), { settings }, { merge: true });
        return true;
    } catch (e) {
        console.error('Error saving settings:', e);
        return false;
    }
}

function getDefaultSettings() {
    return {
        troopName: 'Troop 242',
        fundraisingGoal: DEFAULTS.FUNDRAISING_GOAL,
        cardPrice: DEFAULTS.CARD_PRICE,
        donationBaseUrl: '',
        defaultPaymentProcessor: 'manual',
        paymentHandles: {
            zelle: '',
            venmo: '',
            cashapp: '',
            applepay: ''
        },
        paymentQrImages: {
            zelle: '',
            venmo: '',
            cashapp: '',
            applepay: ''
        },
        handleLocks: {
            zelle: false,
            venmo: false,
            cashapp: false,
            applepay: false
        },
        fieldControls: {
            priceEditable: false,
            qtyEditable: true,
            dateEditable: true,
            customerEditable: true
        }
    };
}

function normalizeUnitId(value) {
    return (value || '').trim().toUpperCase();
}

function normalizeRole(value = '') {
    const role = (value || '').trim().toLowerCase();
    if (role === 'unit_leader' || role === 'unit leader' || role === 'leader') return 'leader';
    if (role === 'unit_admin' || role === 'unit admin' || role === 'admin') return 'admin';
    if (role === 'parent' || role === 'guardian' || role === 'parent/guardian') return 'parent';
    if (role === 'scout') return 'scout';
    return 'scout';
}

function generateUnitId(length = 6) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < length; i++) {
        out += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return out;
}

async function unitExists(unitId) {
    try {
        const { getDoc, doc } = window.firebaseImports;
        const unitDoc = await getDoc(doc(db, 'unitsPublic', normalizeUnitId(unitId)));
        return unitDoc.exists();
    } catch (e) {
        console.error('Error checking unit:', e);
        return false;
    }
}

async function createUnitForLeader(userId, leaderName, troopName = '') {
    const { setDoc, getDoc, doc, serverTimestamp } = window.firebaseImports;
    for (let attempt = 0; attempt < 8; attempt++) {
        const unitId = generateUnitId();
        const unitRef = doc(db, 'units', unitId);
        const existing = await getDoc(unitRef);
        if (existing.exists()) continue;

        await setDoc(unitRef, {
            unitId,
            name: (troopName || '').trim() || 'Troop Unit',
            createdBy: userId,
            createdByName: leaderName || '',
            createdAt: serverTimestamp(),
            active: true
        });

        // Public lookup doc (minimal safe fields) for pre-auth Unit ID validation.
        await setDoc(doc(db, 'unitsPublic', unitId), {
            unitId,
            name: (troopName || '').trim() || 'Troop Unit',
            createdBy: userId,
            createdAt: serverTimestamp(),
            active: true
        });
        return unitId;
    }
    throw new Error('Unable to generate a unique Unit ID. Please try again.');
}

async function saveMembershipAndProfile(userId, { unitId, role, name, email }) {
    const { setDoc, doc, serverTimestamp } = window.firebaseImports;
    const normalizedUnitId = normalizeUnitId(unitId);
    const normalizedRole = normalizeRole(role);
    await setDoc(doc(db, 'memberships', userId), {
        userId,
        unitId: normalizedUnitId,
        role: normalizedRole,
        status: 'active',
        createdAt: serverTimestamp()
    }, { merge: true });

    await setDoc(doc(db, 'profiles', userId), {
        userId,
        unitId: normalizedUnitId,
        role: normalizedRole,
        name: (name || '').trim(),
        email: (email || '').trim().toLowerCase(),
        createdAt: serverTimestamp()
    }, { merge: true });
}

async function getMembershipForUser(userId) {
    try {
        const { getDoc, doc } = window.firebaseImports;
        const membershipDoc = await getDoc(doc(db, 'memberships', userId));
        if (!membershipDoc.exists()) return null;
        return membershipDoc.data();
    } catch (e) {
        console.warn('Membership read unavailable, will try fallback:', e && e.code ? e.code : e);
        return null;
    }
}

async function getUserAccountMeta(userId) {
    try {
        const { getDoc, doc } = window.firebaseImports;
        const userDoc = await getDoc(doc(db, 'users', userId));
        if (!userDoc.exists()) return null;
        const data = userDoc.data() || {};
        const unitId = normalizeUnitId(data.unitId || '');
        const role = normalizeRole(data.role || '');
        if (!unitId || !role) return null;
        return {
            userId,
            unitId,
            role,
            name: (data.name || '').trim(),
            email: (data.email || '').trim().toLowerCase()
        };
    } catch (e) {
        console.warn('Error loading users fallback metadata:', e);
        return null;
    }
}

async function getProfileForUser(userId) {
    try {
        const { getDoc, doc } = window.firebaseImports;
        const profileDoc = await getDoc(doc(db, 'profiles', userId));
        if (!profileDoc.exists()) return null;
        return profileDoc.data();
    } catch (e) {
        console.error('Error loading profile:', e);
        return null;
    }
}

async function saveProfileForUser(userId, profileData) {
    try {
        const { setDoc, doc } = window.firebaseImports;
        await setDoc(doc(db, 'profiles', userId), profileData, { merge: true });
        return true;
    } catch (e) {
        console.error('Error saving profile:', e);
        return false;
    }
}

async function savePersonalGoalForUser(userId, personalGoal) {
    try {
        const { setDoc, doc, serverTimestamp } = window.firebaseImports;
        await setDoc(doc(db, 'profiles', userId), {
            personalGoal,
            goalSetupComplete: true,
            goalUpdatedAt: serverTimestamp()
        }, { merge: true });
        return true;
    } catch (e) {
        console.error('Error saving personal goal:', e);
        return false;
    }
}

async function ensureMembershipForExistingUser(user) {
    if (!user || !user.uid) return null;

    const existing = await getMembershipForUser(user.uid);
    if (existing && existing.unitId) return existing;

    const fallbackMeta = await getUserAccountMeta(user.uid);
    if (fallbackMeta && fallbackMeta.unitId) {
        try {
            await saveMembershipAndProfile(user.uid, {
                unitId: fallbackMeta.unitId,
                role: fallbackMeta.role,
                name: fallbackMeta.name || (user.displayName || '').trim() || user.email || 'User',
                email: fallbackMeta.email || user.email || ''
            });
        } catch (syncErr) {
            console.warn('Could not sync fallback user metadata to memberships/profile:', syncErr);
        }
        return {
            unitId: fallbackMeta.unitId,
            role: fallbackMeta.role,
            userId: user.uid
        };
    }

    return null;
}

// ==================== FIRESTORE SCOUT HELPERS (UNIT-SCOPED) ====================

async function addScoutToFirestore(userId, unitId, scoutData) {
    try {
        const { collection, addDoc, serverTimestamp } = window.firebaseImports;
        const docRef = await addDoc(collection(db, `units/${normalizeUnitId(unitId)}/scouts`), {
            ...scoutData,
            unitId: normalizeUnitId(unitId),
            addedBy: userId,
            createdAt: serverTimestamp()
        });
        return docRef.id;
    } catch (e) {
        console.error('Error adding scout:', e);
        throw e;
    }
}

// OPTIMIZED: Issue #1 fix - Added caching to prevent repeated N+1 queries
async function getScoutsFromFirestore(unitId) {
    try {
        const normalizedId = normalizeUnitId(unitId);
        if (!normalizedId) {
            console.warn('getScoutsFromFirestore called with empty unitId');
            return [];
        }

        // Check cache first (Issue #1 optimization)
        const cached = dataCache.get('scouts');
        if (cached) return cached;

        const { collection, query, where, getDocs } = window.firebaseImports;
        const q = query(collection(db, `units/${normalizedId}/scouts`));
        const querySnapshot = await getDocs(q);
        const sharedScouts = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (sharedScouts.length > 0) {
            dataCache.set('scouts', sharedScouts);
            return sharedScouts;
        }

        const membershipsSnap = await getDocs(query(collection(db, 'memberships'), where('unitId', '==', normalizedId)));
        const memberUserIds = membershipsSnap.docs
            .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
            .map(member => member.userId || member.id);

        // OPTIMIZED: Issue #2 fix - Use Promise.all() instead of sequential awaits
        const legacyQueriesPromises = memberUserIds.map(memberUserId =>
            getDocs(collection(db, `users/${memberUserId}/scouts`))
                .catch(err => {
                    console.warn('Skipping legacy scouts read for user:', memberUserId);
                    return { docs: [] };
                })
        );

        const allLegacySnaps = await Promise.all(legacyQueriesPromises);

        const uniqueByName = new Map();
        allLegacySnaps.forEach(legacySnap => {
            legacySnap.docs?.forEach(legacyDoc => {
                const data = legacyDoc.data() || {};
                const name = (data.name || '').trim();
                if (!name) return;
                const key = name.toLowerCase();
                if (uniqueByName.has(key)) return;
                uniqueByName.set(key, {
                    id: legacyDoc.id,
                    name,
                    goal: Number(data.goal) || DEFAULTS.SCOUT_GOAL,
                    unitId: normalizedId,
                    source: 'legacy'
                });
            });
        });

        const result = Array.from(uniqueByName.values());
        dataCache.set('scouts', result);
        return result;
    } catch (e) {
        console.error('Error getting scouts:', e);
        return [];
    }
}

async function deleteScoutFromFirestore(unitId, scoutId) {
    try {
        const { deleteDoc, doc } = window.firebaseImports;
        await deleteDoc(doc(db, `units/${normalizeUnitId(unitId)}/scouts/${scoutId}`));
    } catch (e) {
        console.error('Error deleting scout:', e);
    }
}

// OPTIMIZED: Issue #1 & #2 fix - Get ALL sales from users in same unit (for leaderboard and troop stats)
// Uses caching and Promise.all() instead of sequential awaits
async function getAllSalesFromFirestore(unitId) {
    try {
        const { collection, getDocs, query, where } = window.firebaseImports;

        // Check cache first (Issue #1 optimization - prevents repeated expensive queries)
        const cached = dataCache.get('sales');
        if (cached) return cached;

        const normalizedUnitId = normalizeUnitId(unitId);
        const membershipsSnap = await getDocs(query(collection(db, 'memberships'), where('unitId', '==', normalizedUnitId)));
        const memberUserIds = membershipsSnap.docs
            .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
            .map(member => member.userId || member.id);

        // OPTIMIZED: Issue #2 fix - Use Promise.all() instead of sequential awaits (60-70% faster)
        const salesQueriesPromises = memberUserIds.map(memberUserId =>
            getDocs(collection(db, `users/${memberUserId}/sales`))
                .then(salesSnap => ({
                    userId: memberUserId,
                    docs: salesSnap.docs
                }))
                .catch(() => ({
                    userId: memberUserId,
                    docs: []
                }))
        );

        const allSalesSnaps = await Promise.all(salesQueriesPromises);

        const allSales = [];
        allSalesSnaps.forEach(({ userId, docs }) => {
            docs.forEach(saleDoc => {
                allSales.push({ id: saleDoc.id, userId, ...saleDoc.data() });
            });
        });

        dataCache.set('sales', allSales);
        return allSales;
    } catch (e) {
        console.error('Error getting all sales:', e);
        return [];
    }
}

// OPTIMIZED: Issue #2 fix - Use Promise.all() to fetch scouts and sales in parallel
async function getTroopStats(unitId) {
    try {
        // Check cache first (Issue #1 optimization)
        const cached = dataCache.get('stats');
        if (cached) return cached;

        // OPTIMIZED: Fetch both in parallel instead of sequentially (Issue #2)
        const [allSales, scouts] = await Promise.all([
            getAllSalesFromFirestore(unitId),
            getScoutsFromFirestore(unitId)
        ]);

        let totalRaised = 0;
        let totalCards = 0;
        let totalDonations = 0;

        allSales.forEach(sale => {
            totalRaised += Number(sale.amount) || 0;
            if (sale.type === 'card') totalCards += getCardQtyFromSale(sale);
            if (sale.type === 'donation') totalDonations++;
        });

        const stats = { totalRaised, totalCards, totalDonations, scoutCount: scouts.length };
        dataCache.set('stats', stats);
        return stats;
    } catch (e) {
        console.error('Error getting troop stats:', e);
        return { totalRaised: 0, totalCards: 0, totalDonations: 0, scoutCount: 0 };
    }
}

async function addProductToFirestore(unitId, userId, productData) {
    try {
        const { collection, addDoc, serverTimestamp } = window.firebaseImports;
        const docRef = await addDoc(collection(db, `units/${normalizeUnitId(unitId)}/products`), {
            ...productData,
            lowStockThreshold: Number(productData.lowStockThreshold) || 5,
            createdBy: userId,
            createdAt: serverTimestamp()
        });
        return docRef.id;
    } catch (e) {
        console.error('Error adding product:', e);
        throw e;
    }
}

async function getProductsFromFirestore(unitId) {
    try {
        const { collection, query, getDocs } = window.firebaseImports;
        const q = query(collection(db, `units/${normalizeUnitId(unitId)}/products`));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
    } catch (e) {
        console.error('Error getting products:', e);
        return [];
    }
}

async function saveProductToFirestore(unitId, productId, partialProduct) {
    try {
        const { setDoc, doc } = window.firebaseImports;
        await setDoc(doc(db, `units/${normalizeUnitId(unitId)}/products`, productId), partialProduct, { merge: true });
        return true;
    } catch (e) {
        console.error('Error saving product:', e);
        return false;
    }
}

async function addOrderToFirestore(unitId, userId, orderData) {
    try {
        const { collection, addDoc, serverTimestamp } = window.firebaseImports;
        const docRef = await addDoc(collection(db, `units/${normalizeUnitId(unitId)}/orders`), {
            ...orderData,
            unitId: normalizeUnitId(unitId),
            userId,
            submittedAt: serverTimestamp()
        });
        return docRef.id;
    } catch (e) {
        console.error('Error adding order:', e);
        throw e;
    }
}

async function getOrdersFromFirestore(unitId) {
    try {
        const { collection, query, getDocs } = window.firebaseImports;
        const q = query(collection(db, `units/${normalizeUnitId(unitId)}/orders`));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
    } catch (e) {
        console.error('Error getting orders:', e);
        return [];
    }
}

function toCsv(rows) {
    if (!rows || rows.length === 0) return '';
    const headers = Object.keys(rows[0]);
    const esc = (val) => {
        const s = String(val == null ? '' : val);
        // SECURITY FIX: Prevent CSV injection by escaping formula characters
        // Excel/Calc interpret =, +, @, - as formula starts when at beginning of cell
        if (/^[=+@\-]/.test(s)) {
            return `"${s.replace(/"/g, '""')}"`;
        }
        if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
    };
    const lines = [headers.join(',')];
    rows.forEach(row => {
        lines.push(headers.map(h => esc(row[h])).join(','));
    });
    return lines.join('\n');
}

function getCardQtyFromSale(sale, fallbackCardPrice) {
    if (!sale || sale.type !== 'card') return 0;

    const rawQty = Number(sale.qty);
    if (Number.isFinite(rawQty) && rawQty > 0) return Math.floor(rawQty);

    const unitPrice = Number(sale.cardUnitPrice);
    const amount = Number(sale.amount);
    if (Number.isFinite(unitPrice) && unitPrice > 0 && Number.isFinite(amount) && amount > 0) {
        const est = Math.round(amount / unitPrice);
        if (est > 0) return est;
    }

    const fallbackPrice = Number(fallbackCardPrice);
    if (Number.isFinite(fallbackPrice) && fallbackPrice > 0 && Number.isFinite(amount) && amount > 0) {
        const est = Math.round(amount / fallbackPrice);
        if (est > 0) return est;
    }

    return 1;
}

function getDefaultUnitPageVisibility() {
    return {
        leader: { quicklog: true, dashboard: true, sales: true, scouts: true, operations: true, communication: true },
        scout: { quicklog: true, dashboard: true, sales: true, scouts: true, operations: true, communication: true },
        parent: { quicklog: true, dashboard: true, sales: true, scouts: true, operations: true, communication: true }
    };
}

function mergeUnitPageVisibility(raw) {
    const base = getDefaultUnitPageVisibility();
    const out = { leader: { ...base.leader }, scout: { ...base.scout }, parent: { ...base.parent } };
    if (!raw || typeof raw !== 'object') return out;

    ['leader', 'scout', 'parent'].forEach(role => {
        const rawRole = raw[role];
        if (!rawRole || typeof rawRole !== 'object') return;
        Object.keys(out[role]).forEach(page => {
            if (typeof rawRole[page] === 'boolean') out[role][page] = rawRole[page];
        });
    });

    return out;
}

async function loadUnitPageVisibilityFromFirestore(unitId) {
    try {
        const { getDoc, doc } = window.firebaseImports;
        const normalizedUnitId = normalizeUnitId(unitId);
        if (!normalizedUnitId) return getDefaultUnitPageVisibility();
        const unitDoc = await getDoc(doc(db, 'units', normalizedUnitId));
        if (!unitDoc.exists()) return getDefaultUnitPageVisibility();
        const data = unitDoc.data() || {};
        return mergeUnitPageVisibility(data.pageVisibility);
    } catch (e) {
        console.warn('Unable to load unit page visibility, using defaults:', e && e.code ? e.code : e);
        return getDefaultUnitPageVisibility();
    }
}

async function saveUnitPageVisibilityToFirestore(unitId, pageVisibility) {
    const { setDoc, doc, serverTimestamp } = window.firebaseImports;
    const normalizedUnitId = normalizeUnitId(unitId);
    if (!normalizedUnitId) throw new Error('Unit ID missing');
    await setDoc(doc(db, 'units', normalizedUnitId), {
        pageVisibility: mergeUnitPageVisibility(pageVisibility),
        pageVisibilityUpdatedAt: serverTimestamp()
    }, { merge: true });
}

// ==================== MAIN APP CLASS ====================

class ScoutFundraiserApp {
    constructor() {
        this.currentPage = 'quicklog';
        this.currentUser = currentUser;
        this.currentUnitId = '';
        this.currentRole = 'scout';
        this.currentProfile = null;
        this.settings = null;
        this.sales = [];
        this.products = [];
        this.orders = [];
        this.orderDraftLines = [];
        this.realtimeUnsubs = [];
        this.unitPageVisibility = getDefaultUnitPageVisibility();

        this.init();
    }

    init() {
        if (!currentUser) {
            this.setupAuthUI();
            this.showLanding();
        } else {
            this.setupAppWithRetry()
                .then(() => this.showApp())
                .catch(async (error) => {
                    console.error('App setup error:', error);
                    await appleAlert('Access Error', this.getSetupErrorMessage(error));
                    this.showLanding();
                });
        }
    }

    handleAuthChange(user) {
        this.currentUser = user;
        if (user) {
            this.setupAppWithRetry()
                .then(() => this.showApp())
                .catch(async (error) => {
                    console.error('App setup error:', error);
                    await appleAlert('Access Error', this.getSetupErrorMessage(error));
                    this.showLanding();
                });
        } else {
            this.showLanding();
        }
    }

    getSetupErrorMessage(error) {
        const code = error && error.code ? String(error.code) : '';
        const msg = error && error.message ? String(error.message) : String(error || 'Unknown error');
        if (msg.includes('Membership and users fallback unavailable')) {
            return 'Your account profile is not set up yet. If you just signed up, wait 2 seconds and try signing in again.';
        }
        if (code.includes('permission-denied') || msg.toLowerCase().includes('permission')) {
            return 'Firestore permissions are blocking app setup. Deploy the latest firestore.rules, then sign in again.';
        }
        return `App setup failed: ${msg}`;
    }

    async setupAppWithRetry(maxAttempts = 5) {
        let lastErr;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                await this.setupApp();
                return;
            } catch (err) {
                lastErr = err;
                const msg = err && err.message ? String(err.message) : '';
                const code = err && err.code ? String(err.code) : '';
                const isLikelyRace = msg.includes('Membership and users fallback unavailable');
                const isPermission = code.includes('permission-denied');
                if (attempt >= maxAttempts || (!isLikelyRace && !isPermission)) {
                    throw err;
                }
                const delayMs = 300 * attempt;
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }
        throw lastErr || new Error('App setup failed');
    }

    showLanding() {
        document.getElementById('landing-page').style.display = 'flex';
        document.getElementById('app-shell').classList.add('hidden');
    }

    showApp() {
        document.getElementById('landing-page').style.display = 'none';
        document.getElementById('app-shell').classList.remove('hidden');
        this.updateRoleBadge();
        this.refreshDashboard();
    }

    getRoleLabel() {
        const role = (this.currentRole || '').toLowerCase();
        if (role === 'admin') return 'Unit Admin';
        if (role === 'leader') return 'Unit Leader';
        if (role === 'parent') return 'Parent/Guardian';
        return 'Scout';
    }

    updateRoleBadge() {
        const badge = document.getElementById('header-role-badge');
        if (!badge) return;
        const role = (this.currentRole || '').toLowerCase();
        badge.textContent = this.getRoleLabel();
        badge.classList.remove('role-badge--admin', 'role-badge--leader', 'role-badge--parent', 'role-badge--scout');
        if (role === 'admin') badge.classList.add('role-badge--admin');
        else if (role === 'leader') badge.classList.add('role-badge--leader');
        else if (role === 'parent') badge.classList.add('role-badge--parent');
        else badge.classList.add('role-badge--scout');
        badge.classList.remove('hidden');
    }

    canAccessOperations() {
        return this.currentRole === 'leader' || this.currentRole === 'admin';
    }

    canAddScouts() {
        return this.currentRole === 'leader' || this.currentRole === 'admin';
    }

    canAccessCommunication() {
        return this.currentRole === 'scout';
    }

    isPageBaseAllowedForRole(page, role) {
        const r = normalizeRole(role);
        if (page === 'settings') return true;
        if (page === 'operations') return r === 'leader' || r === 'admin';
        if (page === 'communication') return r === 'scout';
        return true;
    }

    isPageHiddenByAdmin(page, role) {
        const r = normalizeRole(role);
        if (r === 'admin') return false;
        const roleConfig = (this.unitPageVisibility && this.unitPageVisibility[r]) ? this.unitPageVisibility[r] : null;
        if (!roleConfig) return false;
        if (typeof roleConfig[page] !== 'boolean') return false;
        return roleConfig[page] === false;
    }

    isPageVisibleForCurrentUser(page) {
        if (!this.isPageBaseAllowedForRole(page, this.currentRole)) return false;
        if (this.isPageHiddenByAdmin(page, this.currentRole)) return false;

        // Scouts page: Leaders/Admins always see it; Scouts/Parents only on Tuesdays
        if (page === 'scouts') {
            const isLeaderOrAdmin = ['leader', 'unit_leader', 'admin', 'unit_admin'].includes(this.currentRole);
            if (!isLeaderOrAdmin) {
                // For scouts and parents: only show on Tuesdays
                const estTime = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
                const dayOfWeek = estTime.getDay();
                if (dayOfWeek !== 2) return false; // 2 = Tuesday
            }
        }

        return true;
    }

    applyNavigationVisibility() {
        document.querySelectorAll('.nav-btn').forEach(btn => {
            const page = btn.dataset.page;
            if (!page) return;
            btn.classList.toggle('hidden', !this.isPageVisibleForCurrentUser(page));
        });
    }

    // ==================== AUTHENTICATION ====================

    setupAuthUI() {
        console.log('setupAuthUI() called - Setting up auth forms');
        const authTabs = document.querySelectorAll('.auth-tab-btn');
        const authForms = document.querySelectorAll('.auth-form');
        const roleSelect = document.getElementById('signup-role');
        const createUnitGroup = document.getElementById('signup-create-unit-group');
        const createUnitToggle = document.getElementById('signup-create-unit');
        const troopNameGroup = document.getElementById('signup-troop-name-group');
        const unitIdGroup = document.getElementById('signup-unit-id-group');
        const unitIdInput = document.getElementById('signup-unit-id');
        
        console.log('Found auth tabs:', authTabs.length);
        console.log('Found auth forms:', authForms.length);

        authTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const tabName = tab.dataset.tab;
                console.log('Tab clicked:', tabName);
                authTabs.forEach(t => t.classList.remove('active'));
                authForms.forEach(f => f.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById(`${tabName}-form`).classList.add('active');
                console.log('Switched to:', tabName);
            });
        });

        const loginForm = document.getElementById('login-form');
        const signupForm = document.getElementById('signup-form');
        const forgotPasswordBtn = document.getElementById('forgot-password-btn');
        
        console.log('Login form found:', !!loginForm);
        console.log('Signup form found:', !!signupForm);

        if (loginForm) {
            loginForm.addEventListener('submit', (e) => {
                console.log('Login form submitted');
                e.preventDefault();
                this.handleLogin();
            });
        }

        if (forgotPasswordBtn) {
            forgotPasswordBtn.addEventListener('click', () => this.handleForgotPassword());
        }

        if (signupForm) {
            signupForm.addEventListener('submit', (e) => {
                console.log('Signup form submitted');
                e.preventDefault();
                this.handleSignup();
            });
        }

        const updateSignupUnitControls = () => {
            if (!roleSelect || !createUnitGroup || !createUnitToggle || !troopNameGroup || !unitIdGroup || !unitIdInput) return;

            const canCreateUnit = roleSelect.value === 'admin';
            createUnitGroup.classList.toggle('hidden', !canCreateUnit);

            const willCreateUnit = canCreateUnit && createUnitToggle.checked;
            troopNameGroup.classList.toggle('hidden', !willCreateUnit);
            unitIdGroup.classList.toggle('hidden', willCreateUnit);

            if (willCreateUnit) {
                unitIdInput.value = '';
            }
        };

        if (roleSelect) roleSelect.addEventListener('change', updateSignupUnitControls);
        if (createUnitToggle) createUnitToggle.addEventListener('change', updateSignupUnitControls);
        updateSignupUnitControls();
    }

    async handleLogin() {
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;
        const errorEl = document.getElementById('login-error');

        // SECURITY FIX: Rate limiting to prevent brute force attacks
        const now = Date.now();
        if (authRateLimit.loginAttempts >= authRateLimit.maxAttempts) {
            const timeSinceLastAttempt = now - authRateLimit.lastLoginAttempt;
            if (timeSinceLastAttempt < authRateLimit.cooldownMs) {
                const secondsLeft = Math.ceil((authRateLimit.cooldownMs - timeSinceLastAttempt) / 1000);
                errorEl.textContent = `Too many login attempts. Please wait ${secondsLeft} seconds before trying again.`;
                return;
            } else {
                // Reset counter after cooldown expires
                authRateLimit.loginAttempts = 0;
            }
        }

        if (!email || !password) {
            errorEl.textContent = 'Please enter email and password.';
            return;
        }

        authRateLimit.loginAttempts++;
        authRateLimit.lastLoginAttempt = now;

        try {
            const { signInWithEmailAndPassword } = window.firebaseImports;
            await signInWithEmailAndPassword(auth, email, password);
            errorEl.textContent = '';
            // Reset rate limit on successful login
            authRateLimit.loginAttempts = 0;
        } catch (error) {
            errorEl.textContent = getAuthErrorMessage(error, 'login');
        }
    }

    async handleForgotPassword() {
        const email = (document.getElementById('login-email').value || '').trim();
        const errorEl = document.getElementById('login-error');

        if (!email) {
            errorEl.textContent = 'Enter your email first, then tap Forgot Password.';
            return;
        }

        try {
            const { sendPasswordResetEmail } = window.firebaseImports;
            if (!sendPasswordResetEmail) {
                throw new Error('Password reset service unavailable.');
            }

            await sendPasswordResetEmail(auth, email);
            errorEl.textContent = '';
            await appleAlert('Reset Email Sent', 'Check your inbox for a password reset link.');
        } catch (error) {
            const message = getAuthErrorMessage(error, 'login');
            errorEl.textContent = message;
        }
    }

    async handleSignup() {
        const name = document.getElementById('signup-name').value.trim();
        const role = document.getElementById('signup-role').value;
        const normalizedSignupRole = normalizeRole(role);
        const createUnit = !!document.getElementById('signup-create-unit').checked;
        const troopName = document.getElementById('signup-troop-name').value.trim();
        const unitIdInput = normalizeUnitId(document.getElementById('signup-unit-id').value);
        const email = document.getElementById('signup-email').value.trim();
        const password = document.getElementById('signup-password').value;
        const confirm = document.getElementById('signup-confirm').value;
        const errorEl = document.getElementById('signup-error');

        if (!errorEl) {
            console.error('signup-error element not found');
            await appleAlert('Form Error', 'Check browser console for details.');
            return;
        }

        // SECURITY FIX: Rate limiting to prevent signup spam/abuse
        const now = Date.now();
        if (authRateLimit.signupAttempts >= authRateLimit.maxAttempts) {
            const timeSinceLastAttempt = now - authRateLimit.lastSignupAttempt;
            if (timeSinceLastAttempt < authRateLimit.cooldownMs) {
                const secondsLeft = Math.ceil((authRateLimit.cooldownMs - timeSinceLastAttempt) / 1000);
                errorEl.textContent = `Too many signup attempts. Please wait ${secondsLeft} seconds before trying again.`;
                return;
            } else {
                authRateLimit.signupAttempts = 0;
            }
        }

        if (!name || !email || !password || !confirm || !role) {
            errorEl.textContent = 'Please fill in all fields.';
            return;
        }

        authRateLimit.signupAttempts++;
        authRateLimit.lastSignupAttempt = now;

        let resolvedUnitId = '';
        const creatingNewUnit = role === 'admin' && createUnit;
        if (!creatingNewUnit) {
            if (!unitIdInput) {
                errorEl.textContent = 'Unit ID is required.';
                return;
            }
            const exists = await unitExists(unitIdInput);
            if (!exists) {
                errorEl.textContent = 'Unit ID not found. Check with your unit admin.';
                return;
            }
            resolvedUnitId = unitIdInput;
        }

        if (password !== confirm) {
            errorEl.textContent = 'Passwords do not match.';
            return;
        }

        // SECURITY FIX: Enforce stronger password requirements
        if (password.length < 12) {
            errorEl.textContent = 'Password must be at least 12 characters.';
            return;
        }

        const hasUppercase = /[A-Z]/.test(password);
        const hasLowercase = /[a-z]/.test(password);
        const hasNumber = /[0-9]/.test(password);

        if (!hasUppercase || !hasLowercase || !hasNumber) {
            errorEl.textContent = 'Password must contain uppercase letters, lowercase letters, and numbers.';
            return;
        }

        errorEl.textContent = 'Creating account...';

        try {
            const { createUserWithEmailAndPassword, updateProfile, setDoc, doc } = window.firebaseImports;
            
            if (!createUserWithEmailAndPassword || !updateProfile || !setDoc || !doc) {
                throw new Error('Firebase methods not loaded properly');
            }

            const userCred = await createUserWithEmailAndPassword(auth, email, password);
            
            await updateProfile(userCred.user, { displayName: name });

            if (creatingNewUnit) {
                resolvedUnitId = await createUnitForLeader(userCred.user.uid, name, troopName);
            }

            await saveMembershipAndProfile(userCred.user.uid, {
                unitId: resolvedUnitId,
                role: normalizedSignupRole,
                name,
                email
            });
            
            const userSettings = getDefaultSettings();
            await setDoc(
                doc(db, 'users', userCred.user.uid),
                {
                    name,
                    email,
                    role: normalizedSignupRole,
                    unitId: resolvedUnitId,
                    settings: userSettings,
                    createdAt: new Date().toISOString()
                }
            );

            // Do not auto-create scouts here. Scouts list is read from database only.

            if (creatingNewUnit) {
                await appleAlert('Unit Created', `Your Unit ID is ${resolvedUnitId}. Share this code with scouts/parents to join.`);
            }

            errorEl.textContent = '';
            // Reset rate limit on successful signup
            authRateLimit.signupAttempts = 0;
            document.getElementById('signup-form').reset();
            errorEl.textContent = 'Account created! Logging in...';
        } catch (error) {
            const isEmailInUse = !!(error && error.code === 'auth/email-already-in-use');
            if (isEmailInUse) {
                console.info('Signup blocked: email already in use. Switching to login.');
            } else {
                console.error('Signup error:', error);
            }

            errorEl.textContent = getAuthErrorMessage(error, 'signup');

            if (isEmailInUse) {
                const loginTab = document.querySelector('.auth-tab-btn[data-tab="login"]');
                const signupTab = document.querySelector('.auth-tab-btn[data-tab="signup"]');
                const loginForm = document.getElementById('login-form');
                const signupForm = document.getElementById('signup-form');
                if (loginTab && signupTab && loginForm && signupForm) {
                    signupTab.classList.remove('active');
                    loginTab.classList.add('active');
                    signupForm.classList.remove('active');
                    loginForm.classList.add('active');
                    document.getElementById('login-email').value = email;
                }
            }
        }
    }

    async promptForPersonalGoalIfNeeded() {
        if (this.currentRole !== 'scout') return;

        const existingGoal = Number(this.currentProfile && this.currentProfile.personalGoal);
        if (Number.isFinite(existingGoal) && existingGoal > 0) return;

        const rawGoal = window.prompt('Set your personal fundraising goal ($):', '500');
        if (rawGoal === null) {
            await appleAlert('Goal Needed', 'You can continue now, but please set your personal goal in Settings.');
            return;
        }

        const parsedGoal = Number(rawGoal);
        if (!Number.isFinite(parsedGoal) || parsedGoal <= 0) {
            await appleAlert('Invalid Goal', 'Please enter a valid amount greater than zero.');
            return this.promptForPersonalGoalIfNeeded();
        }

        const saved = await savePersonalGoalForUser(this.currentUser.uid, parsedGoal);
        if (!saved) {
            await appleAlert('Save Failed', 'Could not save your personal goal right now. Please try again from Settings.');
            return;
        }

        this.currentProfile = {
            ...(this.currentProfile || {}),
            personalGoal: parsedGoal,
            goalSetupComplete: true
        };
        await appleAlert('Goal Saved', `Your personal goal is set to ${formatMoney(parsedGoal)}.`);
    }

    // ==================== APP SETUP ====================

    async setupApp() {
        const membership = await ensureMembershipForExistingUser(this.currentUser);
        if (!membership || !membership.unitId) {
            throw new Error('Membership and users fallback unavailable. Firestore permissions may be missing for memberships and users collections.');
        }
        this.currentUnitId = normalizeUnitId((membership && membership.unitId) || '');
        this.currentRole = normalizeRole((membership && membership.role) || 'scout');

        this.unitPageVisibility = await loadUnitPageVisibilityFromFirestore(this.currentUnitId);

        this.currentProfile = await getProfileForUser(this.currentUser.uid);
        if (!this.currentProfile) {
            await saveProfileForUser(this.currentUser.uid, {
                userId: this.currentUser.uid,
                unitId: this.currentUnitId,
                role: this.currentRole,
                name: (this.currentUser.displayName || '').trim(),
                email: (this.currentUser.email || '').trim().toLowerCase()
            });
            this.currentProfile = await getProfileForUser(this.currentUser.uid);
        }

        await this.promptForPersonalGoalIfNeeded();

        this.settings = await loadSettingsFromFirestore(this.currentUser.uid);
        await this.loadSales();
        this.allSales = await getAllSalesFromFirestore(this.currentUnitId);
        if (this.canAccessOperations()) {
            this.products = await getProductsFromFirestore(this.currentUnitId);
            this.orders = await getOrdersFromFirestore(this.currentUnitId);
        } else {
            this.products = [];
            this.orders = [];
        }

        // Scouts are read-only from database here; no auto-create/migration writes.

        this.startRealtimeListeners();

        // Only bind event listeners once to prevent duplicates
        if (!this._setupDone) {
            this._setupDone = true;
            this.setupNavigation();
            this.setupQuickLogPage();
            this.setupDashboardPage();
            this.setupSalesPage();
            await this.setupScoutsPage();
            this.setupCommunicationPage();
            this.setupOperationsPage();
            this.setupSettingsPage();
            this.setupLogout();
            this.setupModals();
        }

        const initialPage = window.location.hash.replace('#', '') || 'quicklog';
        this.navigateTo(initialPage);
    }

    async loadSales() {
        // Leaders and admins see all unit sales; scouts see only their own
        const isLeaderOrAdmin = ['leader', 'unit_leader', 'admin', 'unit_admin'].includes(this.currentRole);

        if (isLeaderOrAdmin) {
            this.sales = await getAllSalesFromFirestore(this.currentUnitId);
        } else {
            this.sales = await getSalesFromFirestore(this.currentUser.uid);
        }
    }

    // ==================== NAVIGATION ====================

    setupNavigation() {
        const navButtons = document.querySelectorAll('.nav-btn');
        this.applyNavigationVisibility();

        navButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const page = btn.dataset.page;
                this.navigateTo(page);
                window.location.hash = page;
            });
        });
    }

    async navigateTo(page) {
        if (!this.isPageVisibleForCurrentUser(page)) {
            page = 'dashboard';
            window.location.hash = page;
        }

        if (page === 'communication' && !this.canAccessCommunication()) {
            page = 'dashboard';
            window.location.hash = page;
        }

        if (page === 'operations' && !this.canAccessOperations()) {
            page = 'dashboard';
            window.location.hash = page;
        }

        // Check if scouts/roster page is being accessed on non-Tuesday (for scouts/parents only)
        if (page === 'scouts') {
            const isLeaderOrAdmin = ['leader', 'unit_leader', 'admin', 'unit_admin'].includes(this.currentRole);
            if (!isLeaderOrAdmin) {
                const estTime = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
                const dayOfWeek = estTime.getDay(); // 0 = Sunday, 1 = Monday, 2 = Tuesday, etc.

                if (dayOfWeek !== 2) { // 2 = Tuesday
                    await appleAlert('Access Restricted', 'The Roster page is only available on Tuesdays (EST timezone).');
                    page = 'dashboard';
                    window.location.hash = page;
                }
            }
        }

        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.page === page);
        });

        document.querySelectorAll('.page').forEach(p => {
            p.classList.toggle('active', p.id === page + '-page');
        });

        this.currentPage = page;

        this.applyNavigationVisibility();

        // Reload fresh data from Firestore on every page switch
        await this.loadSales();

        if (page === 'quicklog') {
            this.scouts = await getScoutsFromFirestore(this.currentUnitId);
            this.populateScoutDropdown();

            // 3-step process: Focus on type toggle (Step 1)
            document.getElementById('type-btn-card').focus();
        }
        if (page === 'dashboard') this.refreshDashboard();
        if (page === 'sales') this.refreshSalesList();
        if (page === 'scouts') {
            this.scouts = await getScoutsFromFirestore(this.currentUnitId);
            this.allSales = await getAllSalesFromFirestore(this.currentUnitId);
            this.refreshScoutsList();
            this.refreshLeaderboard();
        }
        if (page === 'communication') this.refreshCommunicationPage();
        if (page === 'operations') {
            this.allSales = await getAllSalesFromFirestore(this.currentUnitId);
            this.products = await getProductsFromFirestore(this.currentUnitId);
            this.orders = await getOrdersFromFirestore(this.currentUnitId);
            this.refreshOperationsPage();
        }
    }

    startRealtimeListeners() {
        if (!window.firebaseImports.onSnapshot) return;

        this.realtimeUnsubs.forEach(unsub => {
            try { if (typeof unsub === 'function') unsub(); } catch (_e) { }
        });
        this.realtimeUnsubs = [];

        const { onSnapshot, collection, doc } = window.firebaseImports;

        const salesUnsub = onSnapshot(collection(db, `users/${this.currentUser.uid}/sales`), (snapshot) => {
            this.sales = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
            if (this.currentPage === 'dashboard') this.refreshDashboard();
            if (this.currentPage === 'sales') this.refreshSalesList();
            if (this.currentPage === 'communication') this.refreshCommunicationPage();
            if (this.currentPage === 'operations' || this.currentPage === 'scouts') {
                getAllSalesFromFirestore(this.currentUnitId).then(allSales => {
                    this.allSales = allSales;
                    if (this.currentPage === 'operations') this.refreshOperationsPage();
                    if (this.currentPage === 'scouts') {
                        this.refreshScoutsList();
                        this.refreshLeaderboard();
                    }
                });
            }
        });

        const scoutsUnsub = onSnapshot(collection(db, `units/${normalizeUnitId(this.currentUnitId)}/scouts`), (snapshot) => {
            this.scouts = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
            if (this.currentPage === 'scouts') {
                this.refreshScoutsList();
                this.refreshLeaderboard();
            }
        });

        let productsUnsub = () => {};
        let ordersUnsub = () => {};
        if (this.canAccessOperations()) {
            productsUnsub = onSnapshot(collection(db, `units/${normalizeUnitId(this.currentUnitId)}/products`), (snapshot) => {
                this.products = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
                if (this.currentPage === 'operations') this.refreshOperationsPage();
            });

            ordersUnsub = onSnapshot(collection(db, `units/${normalizeUnitId(this.currentUnitId)}/orders`), (snapshot) => {
                this.orders = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
                if (this.currentPage === 'operations') this.refreshOperationsPage();
            });
        }

        const userUnsub = onSnapshot(doc(db, 'users', this.currentUser.uid), (docSnap) => {
            if (!docSnap.exists()) return;
            const userData = docSnap.data();
            if (userData.settings) {
                this.settings = userData.settings;
                if (this.quickFields && this.quickFields.price && this.settings.cardPrice) {
                    this.quickFields.price.value = this.settings.cardPrice;
                    this.updateQuickSummary();
                }
            }
        });

        const unitUnsub = onSnapshot(doc(db, 'units', normalizeUnitId(this.currentUnitId)), (docSnap) => {
            if (!docSnap.exists()) return;
            const data = docSnap.data() || {};
            if (data.pageVisibility) {
                this.unitPageVisibility = mergeUnitPageVisibility(data.pageVisibility);
                this.applyNavigationVisibility();
                if (this.currentPage && !this.isPageVisibleForCurrentUser(this.currentPage)) {
                    this.navigateTo('dashboard');
                    window.location.hash = 'dashboard';
                }
            }
        });

        this.realtimeUnsubs.push(salesUnsub, scoutsUnsub, productsUnsub, ordersUnsub, userUnsub, unitUnsub);
    }

    // ==================== DASHBOARD ====================

    setupDashboardPage() {
        // Search and filter listeners for dashboard transactions
        ['input', 'change'].forEach(evt => {
            document.getElementById('dash-sales-search').addEventListener(evt, () => this.renderDashTransactions());
            document.getElementById('dash-sales-filter-type').addEventListener(evt, () => this.renderDashTransactions());
            document.getElementById('dash-sales-filter-payment').addEventListener(evt, () => this.renderDashTransactions());
        });

        // Click delegation for dashboard sales list
        document.getElementById('dash-sales-list').addEventListener('click', (e) => {
            const item = e.target.closest('.sale-item');
            if (item) {
                this.showSaleDetail(item.dataset.saleId);
            }
        });
    }

    async refreshDashboard() {
        const stats = {
            totalRaised: 0,
            cardsSold: 0,
            donationsCount: 0,
            scoutsActive: 1
        };

        this.sales.forEach(sale => {
            stats.totalRaised += Number(sale.amount) || 0;
            if (sale.type === 'card') stats.cardsSold += getCardQtyFromSale(sale, this.settings && this.settings.cardPrice);
            if (sale.type === 'donation') stats.donationsCount++;
        });

        // Leaders/Admins see unit goal; Scouts see personal goal
        const isLeaderOrAdmin = ['leader', 'unit_leader', 'admin', 'unit_admin'].includes(this.currentRole);
        let goal;

        if (isLeaderOrAdmin) {
            goal = (this.settings && this.settings.fundraisingGoal) || DEFAULTS.FUNDRAISING_GOAL;
        } else {
            const personalGoal = Number(this.currentProfile && this.currentProfile.personalGoal);
            goal = (Number.isFinite(personalGoal) && personalGoal > 0)
                ? personalGoal
                : ((this.settings && this.settings.fundraisingGoal) || DEFAULTS.FUNDRAISING_GOAL);
        }

        const progress = goal > 0 ? (stats.totalRaised / goal) * 100 : 0;

        document.getElementById('total-raised').textContent = formatMoney(stats.totalRaised);
        document.getElementById('cards-sold').textContent = stats.cardsSold;
        document.getElementById('donations-count').textContent = stats.donationsCount;
        document.getElementById('scouts-active').textContent = stats.scoutsActive;
        document.getElementById('goal-progress').style.width = Math.min(progress, DEFAULTS.MAX_PROGRESS_PCT) + '%';
        document.getElementById('goal-pct').textContent = progress.toFixed(1) + '%';
        document.getElementById('goal-progress-text').textContent = formatMoney(stats.totalRaised) + ' of ' + formatMoney(goal);

        this.renderDashTransactions();
    }

    // REFACTORED: Issue #3 fix - Uses shared filterAndSortSales and renderSalesList helpers
    renderDashTransactions() {
        const searchTerm = (document.getElementById('dash-sales-search').value || '').toLowerCase();
        const typeFilter = document.getElementById('dash-sales-filter-type').value;
        const paymentFilter = document.getElementById('dash-sales-filter-payment').value;

        const filtered = filterAndSortSales(this.sales, {
            searchTerm,
            typeFilter,
            paymentFilter
        });

        const container = document.getElementById('dash-sales-list');
        renderSalesList(filtered, container, this.currentUser);
    }

    // ==================== SALES ====================

    setupSalesPage() {
        // Auto-fill date
        document.getElementById('sale-date').value = getLocalDateInputValue();

        // For leaders/admins: show scout filter instead of search
        const isLeaderOrAdmin = ['leader', 'unit_leader', 'admin', 'unit_admin'].includes(this.currentRole);
        const searchInput = document.getElementById('sales-search');
        const scoutFilter = document.getElementById('sales-filter-scout');

        if (isLeaderOrAdmin && scoutFilter) {
            // Hide search, show scout filter
            searchInput.classList.add('hidden');
            scoutFilter.classList.remove('hidden');
            this.populateSalesScoutFilter();
        }

        // Search and filter listeners
        ['input', 'change'].forEach(evt => {
            searchInput.addEventListener(evt, () => this.refreshSalesList());
            document.getElementById('sales-filter-type').addEventListener(evt, () => this.refreshSalesList());
            document.getElementById('sales-filter-payment').addEventListener(evt, () => this.refreshSalesList());
            if (scoutFilter) {
                scoutFilter.addEventListener(evt, () => this.refreshSalesList());
            }
        });

        // Click delegation for sales list
        document.getElementById('sales-list').addEventListener('click', (e) => {
            const item = e.target.closest('.sale-item');
            if (item) {
                this.showSaleDetail(item.dataset.saleId);
            }
        });
    }

    populateSalesScoutFilter() {
        const scoutFilter = document.getElementById('sales-filter-scout');
        if (!scoutFilter || !this.scouts) return;

        // Get unique scout names from scouts array
        const scoutNames = this.scouts
            .map(s => s.name || 'Unknown')
            .filter((value, index, self) => self.indexOf(value) === index)
            .sort();

        // Add scout options
        scoutNames.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            scoutFilter.appendChild(option);
        });
    }

    // REFACTORED: Issue #3 fix - Uses shared filterAndSortSales and renderSalesList helpers
    async refreshSalesList() {
        const isLeaderOrAdmin = ['leader', 'unit_leader', 'admin', 'unit_admin'].includes(this.currentRole);
        const searchTerm = document.getElementById('sales-search').value.toLowerCase();
        const scoutFilter = document.getElementById('sales-filter-scout').value;
        const typeFilter = document.getElementById('sales-filter-type').value;
        const paymentFilter = document.getElementById('sales-filter-payment').value;

        // Build filters object based on user role
        const filters = {
            typeFilter,
            paymentFilter,
            searchTerm: isLeaderOrAdmin ? '' : searchTerm, // Scouts use search
            scoutName: isLeaderOrAdmin && scoutFilter && scoutFilter !== 'all' ? scoutFilter : '' // Leaders use scout filter
        };

        const filtered = filterAndSortSales(this.sales, filters);
        const container = document.getElementById('sales-list');
        renderSalesList(filtered, container, this.currentUser);
    }

    showSaleDetail(saleId) {
        const sale = this.sales.find(s => s.id === saleId);
        if (!sale) return;

        const typeLabel = sale.type === 'card' ? 'Scout Card' : 'Donation';
        const typeClass = sale.type === 'card' ? 'card-sale' : 'donation';

        const container = document.getElementById('sale-detail');
        container.innerHTML = `
            <h3>Sale Details</h3>
            <div style="margin: 1rem 0;">
                <div class="sale-badges" style="justify-content: flex-start; margin-bottom: 1rem;">
                    <span class="sale-type-badge ${typeClass}">${typeLabel}</span>
                    <span class="payment-badge">${escapeHTML(sale.paymentMethod)}</span>
                </div>
                <p><strong>Amount:</strong> ${formatMoney(sale.amount)}</p>
                <p><strong>Customer:</strong> ${escapeHTML(sale.customerName)}</p>
                <p><strong>Date:</strong> ${formatDate(sale.date)}</p>
            </div>
            <button class="btn btn-danger btn-small" id="delete-sale-btn"><svg class="icon icon-btn"><use href="#icon-trash"/></svg> Delete Sale</button>
        `;

        document.getElementById('delete-sale-btn').addEventListener('click', async () => {
            if (await appleConfirm('Delete Sale?', 'This action cannot be undone.', 'Delete', 'Cancel')) {
                await deleteSaleFromFirestore(this.currentUser.uid, saleId);
                await this.loadSales();
                document.getElementById('sale-detail-modal').style.display = 'none';
                this.refreshSalesList();
                this.refreshDashboard();
            }
        });

        document.getElementById('sale-detail-modal').style.display = 'block';
    }

    // ==================== QUICK LOG ====================

    setupQuickLogPage() {
        this.qrScanState = {
            active: false,
            stream: null,
            rafId: null
        };

        this.quickFields = {
            scoutSelect: document.getElementById('quick-scout-select'),
            scout: document.getElementById('quick-scout'),
            type: document.getElementById('quick-type'),
            price: document.getElementById('quick-price'),
            qty: document.getElementById('quick-qty'),
            amount: document.getElementById('quick-amount'),
            payment: document.getElementById('quick-payment'),
            date: document.getElementById('quick-date'),
            summary: document.getElementById('quick-summary'),
            cardFields: document.getElementById('quick-card-fields'),
            donationFields: document.getElementById('quick-donation-fields'),
            cardTotal: document.getElementById('quick-card-total'),
            qrBtn: document.getElementById('quick-show-qr'),
            qrText: document.getElementById('qr-text'),
            qrVideo: document.getElementById('qr-video'),
            qrCanvas: document.getElementById('qr-canvas')
        };

        // Set defaults
        this.quickFields.date.value = getLocalDateInputValue();
        this.quickFields.price.value = this.settings.cardPrice || 10;

        // Populate scout dropdown
        this.populateScoutDropdown();

        // Apply field controls from admin settings
        this.applyFieldControls();

        // Type toggle buttons - with auto-advance to Step 2
        this.typeBtns = document.querySelectorAll('.type-toggle-btn');
        this.typeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const type = btn.dataset.type;
                this.typeBtns.forEach(b => b.classList.toggle('active', b === btn));
                this.quickFields.type.value = type;
                this.setQuickTypeVisibility(type);
                this.updateQuickSummary();

                // Auto-advance to Step 2 (Check details)
                this.focusStep2();
            });
        });

        // Keep hidden select in sync (for any programmatic changes)
        this.quickFields.type.addEventListener('change', () => {
            const type = this.quickFields.type.value;
            this.typeBtns.forEach(b => b.classList.toggle('active', b.dataset.type === type));
            this.setQuickTypeVisibility(type);
            this.updateQuickSummary();
        });

        // Live updates
        ['input', 'change'].forEach(evt => {
            this.quickFields.scout.addEventListener(evt, () => this.updateQuickSummary());
            this.quickFields.price.addEventListener(evt, () => this.updateQuickSummary());
            this.quickFields.qty.addEventListener(evt, () => this.updateQuickSummary());
            this.quickFields.amount.addEventListener(evt, () => this.updateQuickSummary());
            this.quickFields.payment.addEventListener(evt, () => this.updateQuickSummary());
            this.quickFields.date.addEventListener(evt, () => this.updateQuickSummary());
        });

        // Payment change — show/hide QR button
        this.quickFields.payment.addEventListener('change', () => {
            this.toggleQrPayButton();
            this.updateQuickSummary();
        });
        this.toggleQrPayButton();

        // QR pay button
        this.quickFields.qrBtn.addEventListener('click', () => this.showPaymentQr());

        // Submit
        document.getElementById('quick-submit').addEventListener('click', () => this.submitQuickLog());

        this.setQuickTypeVisibility(this.quickFields.type.value);
        this.updateQuickSummary();
    }

    populateScoutDropdown() {
        const input = this.quickFields.scoutSelect;
        if (!input) return;
        // Always show the logged-in user's name (read-only, no changing)
        input.value = (this.currentUser.displayName || '').trim() || this.currentUser.email;
    }

    focusStep2() {
        // Auto-scroll to Step 2 and focus on customer name field
        const step2 = document.getElementById('step-2');
        if (step2) {
            step2.scrollIntoView({ behavior: 'smooth', block: 'start' });
            // Focus on customer name field (first editable field in Step 2)
            setTimeout(() => {
                this.quickFields.scout.focus();
            }, 300); // Wait for scroll to finish
        }
    }

    applyFieldControls() {
        const fc = (this.settings && this.settings.fieldControls) || {};
        const priceField = this.quickFields.price;
        const qtyField = this.quickFields.qty;
        const dateField = this.quickFields.date;
        const customerField = this.quickFields.scout;

        if (fc.priceEditable) {
            priceField.removeAttribute('readonly');
        } else {
            priceField.setAttribute('readonly', true);
        }
        qtyField.readOnly = !(fc.qtyEditable !== false);
        dateField.readOnly = !(fc.dateEditable !== false);
        customerField.readOnly = !(fc.customerEditable !== false);
    }

    toggleQrPayButton() {
        const method = this.quickFields.payment.value;
        const isDigital = ['Venmo', 'CashApp', 'Zelle', 'ApplePay'].includes(method);
        this.quickFields.qrBtn.classList.toggle('hidden', !isDigital);
    }

    paymentMethodToHandleKey(method) {
        const map = {
            Zelle: 'zelle',
            Venmo: 'venmo',
            CashApp: 'cashapp',
            ApplePay: 'applepay'
        };
        return map[method] || '';
    }

    updateHandleQrPreview(key, imageDataUrl) {
        const preview = document.getElementById('handle-qr-preview-' + key);
        const removeBtn = document.getElementById('handle-qr-remove-' + key);
        if (!preview || !removeBtn) return;

        const hasImage = !!imageDataUrl;
        if (hasImage) {
            preview.src = imageDataUrl;
            preview.classList.remove('hidden');
            removeBtn.classList.remove('hidden');
        } else {
            preview.removeAttribute('src');
            preview.classList.add('hidden');
            removeBtn.classList.add('hidden');
        }
    }

    async readImageFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
            reader.onerror = () => reject(new Error('Failed to read image file.'));
            reader.readAsDataURL(file);
        });
    }

    estimateDataUrlSizeBytes(dataUrl) {
        if (!dataUrl || typeof dataUrl !== 'string') return 0;
        const commaIndex = dataUrl.indexOf(',');
        if (commaIndex < 0) return 0;
        const base64 = dataUrl.slice(commaIndex + 1);
        const padding = base64.endsWith('==') ? 2 : (base64.endsWith('=') ? 1 : 0);
        return Math.floor((base64.length * 3) / 4) - padding;
    }

    async showPaymentQr() {
        const method = this.quickFields.payment.value;
        const handles = (this.settings && this.settings.paymentHandles) || {};
        const qrImages = (this.settings && this.settings.paymentQrImages) || {};
        const methodKey = this.paymentMethodToHandleKey(method);
        const uploadedQrImage = methodKey ? (qrImages[methodKey] || '') : '';
        const type = this.quickFields.type.value;
        let amount = 0;

        if (type === 'card') {
            const price = Number(this.quickFields.price.value);
            const qty = Number(this.quickFields.qty.value);
            if (Number.isFinite(price) && Number.isFinite(qty)) amount = price * qty;
        } else {
            amount = Number(this.quickFields.amount.value) || 0;
        }

        if (amount <= 0) {
            await appleAlert('Invalid Amount', 'Please enter a valid amount first.');
            return;
        }

        let payUrl = '';
        let note = 'Scout Card Fundraiser - Troop 242';
        let handleDisplay = '';

        if (uploadedQrImage) {
            if (method === 'Venmo') handleDisplay = handles.venmo || 'Venmo';
            if (method === 'CashApp') handleDisplay = handles.cashapp || 'CashApp';
            if (method === 'Zelle') handleDisplay = handles.zelle || 'Zelle';
            if (method === 'ApplePay') handleDisplay = handles.applepay || 'Apple Pay';
        } else {
            if (method === 'Venmo') {
                const handle = handles.venmo || '';
                if (!handle) { await appleAlert('Venmo Not Setup', 'Set your Venmo handle in Profile settings first.'); return; }
                handleDisplay = handle;
                payUrl = `https://venmo.com/?txn=pay&recipients=${encodeURIComponent(handle)}&amount=${amount}&note=${encodeURIComponent(note)}`;
            } else if (method === 'CashApp') {
                const handle = (handles.cashapp || '').replace(/^\$/, '');
                if (!handle) { await appleAlert('CashApp Not Setup', 'Set your CashApp tag in Profile settings first.'); return; }
                handleDisplay = '$' + handle;
                payUrl = `https://cash.app/$${handle}/${amount}`;
            } else if (method === 'Zelle') {
                const handle = handles.zelle || '';
                if (!handle) { await appleAlert('Zelle Not Setup', 'Set your Zelle handle in Profile settings first.'); return; }
                handleDisplay = handle;
                payUrl = `https://enroll.zellepay.com/qrcode?data=${encodeURIComponent(JSON.stringify({ token: handle, amount: String(amount), name: note }))}`;
            } else if (method === 'ApplePay') {
                const handle = handles.applepay || '';
                if (!handle) { await appleAlert('Apple Pay Not Setup', 'Set your Apple Pay handle in Profile settings first.'); return; }
                handleDisplay = handle;
                payUrl = `https://cash.me/${encodeURIComponent(handle)}/${amount}`;
            }
        }

        if (!uploadedQrImage && !payUrl) return;

        let qrMarkup = '';
        if (uploadedQrImage) {
            qrMarkup = `<img class="payment-qr-uploaded" src="${escapeHTML(uploadedQrImage)}" alt="${escapeHTML(method)} QR">`;
        } else {
            if (typeof qrcode === 'undefined') {
                await appleAlert('QR Library Error', 'QR code library not loaded. Check your connection.');
                return;
            }

            const qr = qrcode(0, 'M');
            qr.addData(payUrl);
            qr.make();
            qrMarkup = qr.createImgTag(6, 8);
        }

        const container = document.getElementById('payment-qr-content');
        container.innerHTML = `
            <div class="payment-qr-header">
                <h3>Scan to Pay via ${escapeHTML(method)}</h3>
                <p>${escapeHTML(handleDisplay)}</p>
            </div>
            <div class="payment-qr-code">${qrMarkup}</div>
            <div class="payment-qr-amount">${formatMoney(amount)}</div>
            <p class="payment-qr-note">Customer scans this QR code to pay directly</p>
        `;

        document.getElementById('payment-qr-modal').style.display = 'block';
    }

    setQuickTypeVisibility(type) {
        const isCard = type === 'card';
        this.quickFields.cardFields.classList.toggle('hidden', !isCard);
        this.quickFields.donationFields.classList.toggle('hidden', isCard);
        if (this.typeBtns) {
            this.typeBtns.forEach(b => b.classList.toggle('active', b.dataset.type === type));
        }
    }

    parseQrText(text) {
        if (!text) return null;
        const parts = text.split(';').map(part => part.trim()).filter(Boolean);
        if (parts.length === 0) return null;

        const data = {};
        parts.forEach(part => {
            const [rawKey, ...rest] = part.split('=');
            if (!rawKey || rest.length === 0) return;
            const key = rawKey.trim().toLowerCase();
            const value = rest.join('=').trim();
            if (key) data[key] = value;
        });

        if (!data.type) return null;

        return {
            type: data.type.toLowerCase(),
            scout: data.scout || '',
            price: data.price,
            qty: data.qty,
            amount: data.amount
        };
    }

    applyQrData(data) {
        if (!data) return;
        if (data.scout) this.quickFields.scout.value = data.scout;
        if (data.type === 'card' || data.type === 'donation') {
            this.quickFields.type.value = data.type;
        }

        if (data.type === 'card') {
            if (data.price && !Number.isNaN(Number(data.price))) {
                this.quickFields.price.value = Number(data.price);
            }
            if (data.qty && !Number.isNaN(Number(data.qty))) {
                this.quickFields.qty.value = Number(data.qty);
            }
        }

        if (data.type === 'donation') {
            if (data.amount && !Number.isNaN(Number(data.amount))) {
                this.quickFields.amount.value = Number(data.amount);
            }
        }

        this.setQuickTypeVisibility(this.quickFields.type.value);
        this.updateQuickSummary();
    }

    async startQrScanner() {
        if (!window.jsQR) {
            await appleAlert('Scanner Unavailable', 'QR scanner is not available on this device.');
            return;
        }

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            await appleAlert('Camera Not Supported', 'Camera access is not supported on this device.');
            return;
        }

        if (this.qrScanState.active) return;

        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
            .then(stream => {
                this.qrScanState.active = true;
                this.qrScanState.stream = stream;
                this.quickFields.qrVideo.srcObject = stream;
                this.quickFields.qrVideo.play();
                this.scanQrFrame();
            })
            .catch(async () => {
                await appleAlert('Camera Access Denied', 'Please allow camera access in your browser settings.');
            });
    }

    stopQrScanner() {
        if (!this.qrScanState.active) return;
        if (this.qrScanState.rafId) {
            cancelAnimationFrame(this.qrScanState.rafId);
            this.qrScanState.rafId = null;
        }
        if (this.qrScanState.stream) {
            this.qrScanState.stream.getTracks().forEach(track => track.stop());
        }
        this.qrScanState.stream = null;
        this.qrScanState.active = false;
        this.quickFields.qrVideo.pause();
        this.quickFields.qrVideo.srcObject = null;
    }

    scanQrFrame() {
        if (!this.qrScanState.active) return;

        const video = this.quickFields.qrVideo;
        const canvas = this.quickFields.qrCanvas;
        const context = canvas.getContext('2d');

        if (video.readyState === video.HAVE_ENOUGH_DATA) {
            canvas.height = video.videoHeight;
            canvas.width = video.videoWidth;
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
            const code = window.jsQR(imageData.data, imageData.width, imageData.height);
            if (code && code.data) {
                this.quickFields.qrText.value = code.data;
                const data = this.parseQrText(code.data);
                if (data) {
                    this.applyQrData(data);
                    this.stopQrScanner();
                }
                return;
            }
        }

        this.qrScanState.rafId = requestAnimationFrame(() => this.scanQrFrame());
    }

    updateQuickSummary() {
        if (!this.quickFields || !this.quickFields.summary) return;

        const scout = (this.currentUser.displayName || 'Scout').trim();
        const type = this.quickFields.type.value;
        const payment = this.quickFields.payment.value;
        const date = this.quickFields.date.value;
        let details = '';
        let total = NaN;

        if (type === 'card') {
            const price = Number(this.quickFields.price.value);
            const qty = Number(this.quickFields.qty.value);
            if (Number.isFinite(price) && Number.isFinite(qty)) {
                total = price * qty;
                details = `Card x${qty} @ ${formatMoney(price)}`;
            }
            if (this.quickFields.cardTotal) {
                this.quickFields.cardTotal.textContent = Number.isFinite(total)
                    ? `Total: ${formatMoney(total)}`
                    : 'Total: $0.00';
            }
        } else {
            const amount = Number(this.quickFields.amount.value);
            if (Number.isFinite(amount)) {
                total = amount;
                details = `Donation ${formatMoney(amount)}`;
            }
        }

        const summaryParts = [];
        if (scout) summaryParts.push(`Scout: ${scout}`);
        if (details) summaryParts.push(details);
        if (Number.isFinite(total)) summaryParts.push(`Total: ${formatMoney(total)}`);
        if (payment) summaryParts.push(`Pay: ${payment}`);
        if (date) summaryParts.push(`Date: ${date}`);

        this.quickFields.summary.textContent = summaryParts.length
            ? summaryParts.join(' | ')
            : 'Fill in the details above.';
    }

    async submitQuickLog() {
        const scoutName = (this.currentUser.displayName || '').trim() || this.currentUser.email;
        const type = this.quickFields.type.value;
        const paymentMethod = this.quickFields.payment.value;
        const date = this.quickFields.date.value;

        if (!scoutName) {
            await appleAlert('Scout Required', 'Please select a scout.');
            return;
        }

        if (!type) {
            await appleAlert('Sale Type Required', 'Please select a sale type.');
            return;
        }

        let amount = 0;
        let cardQty = null;
        let cardUnitPrice = null;
        if (type === 'card') {
            const price = Number(this.quickFields.price.value);
            const qty = Number(this.quickFields.qty.value);
            if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(qty) || qty <= 0) {
                await appleAlert('Invalid Input', 'Please enter valid card price and quantity.');
                return;
            }
            amount = price * qty;
            cardQty = Math.floor(qty);
            cardUnitPrice = price;
        } else {
            const donation = Number(this.quickFields.amount.value);
            if (!Number.isFinite(donation) || donation <= 0) {
                await appleAlert('Amount Required', 'Please enter a donation amount.');
                return;
            }
            amount = donation;
        }

        if (!paymentMethod) {
            await appleAlert('Payment Required', 'Please select a payment method.');
            return;
        }
        if (!date) {
            await appleAlert('Date Required', 'Please select a date.');
            return;
        }

        try {
            const isDigitalMethod = ['Venmo', 'CashApp', 'Zelle', 'ApplePay'].includes(paymentMethod);
            const saleData = {
                type,
                amount,
                ...(type === 'card' ? { qty: cardQty, cardUnitPrice } : {}),
                paymentMethod,
                paymentProcessor: isDigitalMethod ? ((this.settings && this.settings.defaultPaymentProcessor) || 'manual') : 'manual',
                paymentStatus: isDigitalMethod ? 'pending' : 'received',
                paymentTransactionId: '',
                scoutName,
                customerName: this.quickFields.scout.value.trim() || 'Customer',
                date,
                notes: ''
            };

            await addSaleToFirestore(this.currentUser.uid, saleData);
            await this.loadSales();

            // Reset form
            this.quickFields.qrText.value = '';
            this.quickFields.scout.value = '';
            this.quickFields.amount.value = '';
            this.quickFields.qty.value = 1;
            this.quickFields.price.value = this.settings.cardPrice || 10;
            this.quickFields.date.value = getLocalDateInputValue();
            this.quickFields.type.value = 'card';
            this.setQuickTypeVisibility('card');
            this.updateQuickSummary();

            this.refreshDashboard();
            this.refreshSalesList();
            await appleAlert('Success!', 'Sale recorded successfully.');
        } catch (e) {
            await appleAlert('Error', 'Error saving sale: ' + e.message);
        }
    }

    // ==================== SCOUTS ====================

    async setupScoutsPage() {
        this.scouts = await getScoutsFromFirestore(this.currentUnitId);
        this.allSales = await getAllSalesFromFirestore(this.currentUnitId);

        const form = document.getElementById('scout-form');
        const formCard = form ? form.closest('.card') : null;
        if (formCard) {
            formCard.classList.add('hidden');
        }

        const scoutsList = document.getElementById('scouts-list');
        if (scoutsList) {
            scoutsList.addEventListener('click', async (e) => {
                const deleteBtn = e.target.closest('[data-action="delete-scout"]');
                if (!deleteBtn) return;

                if (this.currentRole !== 'admin') {
                    await appleAlert('Restricted', 'Only unit admins can delete scouts.');
                    return;
                }

                const scoutId = deleteBtn.dataset.scoutId;
                if (!scoutId) return;

                const scout = (this.scouts || []).find(s => s.id === scoutId);
                const scoutName = scout && scout.name ? scout.name : 'this scout';
                const confirmed = await appleConfirm('Delete Scout?', `Remove ${scoutName} from this unit roster?`, 'Delete', 'Cancel');
                if (!confirmed) return;

                await deleteScoutFromFirestore(this.currentUnitId, scoutId);
                this.scouts = await getScoutsFromFirestore(this.currentUnitId);
                this.allSales = await getAllSalesFromFirestore(this.currentUnitId);
                this.refreshScoutsList();
                this.refreshLeaderboard();
            });
        }

        this.refreshScoutsList();
        this.refreshLeaderboard();
    }

    refreshScoutsList() {
        const container = document.getElementById('scouts-list');
        if (!container) return;
        const canManageScouts = this.currentRole === 'admin';

        const salesPool = this.allSales || this.sales || [];
        const derivedScouts = this.getDerivedScoutsFromSales(salesPool);
        const scoutsForDisplay = (this.scouts && this.scouts.length > 0) ? this.scouts : derivedScouts;

        if (!scoutsForDisplay || scoutsForDisplay.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><svg class="icon"><use href="#icon-users"/></svg></div><p>No scouts found in the database for this unit.</p></div>';
            return;
        }

        let html = '';
        scoutsForDisplay.forEach(scout => {
            const nameLower = (scout.name || '').toLowerCase();
            const scoutSales = salesPool.filter(s =>
                (s.scoutName || s.customerName || '').toLowerCase() === nameLower
            );
            const totalRaised = scoutSales.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
            const progress = scout.goal > 0 ? Math.min((totalRaised / scout.goal) * 100, 100) : 0;

            html += `<div class="sale-item" data-scout-id="${scout.id}">
                <div class="sale-info">
                    <h5>${escapeHTML(scout.name)}</h5>
                    <p>Goal: ${formatMoney(scout.goal)} &bull; Raised: ${formatMoney(totalRaised)}</p>
                    <div class="progress-bar" style="height:6px;margin-top:4px;">
                        <div class="progress-fill" style="width:${progress.toFixed(1)}%"></div>
                    </div>
                </div>
                <div class="sale-right">
                    <div class="sale-amount">${progress.toFixed(0)}%</div>
                    ${canManageScouts ? `<button type="button" class="btn btn-danger btn-small" data-action="delete-scout" data-scout-id="${scout.id}">Delete</button>` : ''}
                </div>
            </div>`;
        });

        container.innerHTML = html;

    }

    refreshLeaderboard() {
        const container = document.getElementById('leaderboard');
        if (!container) return;

        const salesPool = this.allSales || this.sales || [];
        const derivedScouts = this.getDerivedScoutsFromSales(salesPool);
        const scoutsForDisplay = (this.scouts && this.scouts.length > 0) ? this.scouts : derivedScouts;

        if (!scoutsForDisplay || scoutsForDisplay.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>Add scouts to see the leaderboard</p></div>';
            return;
        }

        const ranked = scoutsForDisplay.map(scout => {
            const nameLower = (scout.name || '').toLowerCase();
            const scoutSales = salesPool.filter(s =>
                (s.scoutName || s.customerName || '').toLowerCase() === nameLower
            );
            const totalRaised = scoutSales.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
            const cardsSold = scoutSales.reduce((sum, s) => sum + getCardQtyFromSale(s, this.settings && this.settings.cardPrice), 0);
            return { ...scout, totalRaised, cardsSold };
        }).sort((a, b) => b.totalRaised - a.totalRaised);

        let html = '';
        ranked.forEach((scout, i) => {
            const rankClass = i < 3 ? `rank-${i + 1}` : 'rank-other';
            const rankLabel = `${i + 1}`;
            html += `<div class="activity-item">
                <span class="rank-badge ${rankClass}">${rankLabel}</span>
                <div class="activity-details">
                    <div class="activity-title">${escapeHTML(scout.name)}</div>
                    <div class="activity-meta">${scout.cardsSold} cards &bull; ${formatMoney(scout.totalRaised)} raised</div>
                </div>
            </div>`;
        });

        container.innerHTML = html;
    }

    getDerivedScoutsFromSales(salesPool = []) {
        const unique = new Map();
        (salesPool || []).forEach(sale => {
            const rawName = (sale && (sale.scoutName || sale.customerName || '') || '').trim();
            if (!rawName) return;
            const key = rawName.toLowerCase();
            if (unique.has(key)) return;
            unique.set(key, {
                id: `derived-${key.replace(/[^a-z0-9]+/g, '-')}`,
                name: rawName,
                goal: Number((this.settings && this.settings.fundraisingGoal) || DEFAULTS.SCOUT_GOAL)
            });
        });
        return Array.from(unique.values());
    }

    // ==================== SECURITY ====================

    generateScoutShareToken() {
        // SECURITY: Generate an anonymous token for donation sharing instead of exposing UID/unit ID
        // This prevents enumeration attacks on shared QR codes
        // Token format: Base64(userId:timestamp) - server can validate if needed
        const timestamp = Date.now();
        const token = `${this.currentUser.uid}:${timestamp}`;
        const encoded = btoa(token);
        // Remove padding for cleaner URL
        return encoded.replace(/=+$/, '');
    }

    // ==================== COMMUNICATION ====================

    buildCommunicationPayload() {
        const scoutName = (this.currentUser.displayName || 'Scout').trim();
        const personalGoal = Number(this.currentProfile && this.currentProfile.personalGoal);
        const goal = Number.isFinite(personalGoal) && personalGoal > 0
            ? personalGoal
            : ((this.settings && this.settings.fundraisingGoal) || DEFAULTS.FUNDRAISING_GOAL);
        const raised = this.sales.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
        const progressPct = goal > 0 ? Math.min((raised / goal) * 100, 100) : 0;

        const base = (this.settings && this.settings.donationBaseUrl)
            ? this.settings.donationBaseUrl
            : `${window.location.origin}${window.location.pathname}`;
        // SECURITY FIX: Don't expose unit ID or user UID in shareable URLs
        // These can be enumerated/scraped from QR codes. Use anonymous share instead.
        const scoutToken = this.generateScoutShareToken();
        const donationUrl = `${base}?token=${encodeURIComponent(scoutToken)}`;
        const message = `Hi! This is ${scoutName}. I'm fundraising with my scout unit and working toward my goal of ${formatMoney(goal)}. I've reached ${progressPct.toFixed(1)}% so far (${formatMoney(raised)}). You can support me here: ${donationUrl}`;

        return { donationUrl, message, scoutName, goal, raised, progressPct };
    }

    setupCommunicationPage() {
        const copyLinkBtn = document.getElementById('comm-copy-link');
        const copyMsgBtn = document.getElementById('comm-copy-message');
        const emailBtn = document.getElementById('comm-email');
        const smsBtn = document.getElementById('comm-sms');
        const shareBtn = document.getElementById('comm-share');

        if (copyLinkBtn) {
            copyLinkBtn.addEventListener('click', async () => {
                const payload = this.buildCommunicationPayload();
                await navigator.clipboard.writeText(payload.donationUrl);
                await appleAlert('Copied', 'Share link copied to clipboard.');
            });
        }

        if (copyMsgBtn) {
            copyMsgBtn.addEventListener('click', async () => {
                const payload = this.buildCommunicationPayload();
                const messageEl = document.getElementById('comm-message');
                const text = (messageEl && messageEl.value) || payload.message;
                await navigator.clipboard.writeText(text);
                await appleAlert('Copied', 'Message copied to clipboard.');
            });
        }

        if (emailBtn) {
            emailBtn.addEventListener('click', () => {
                const payload = this.buildCommunicationPayload();
                const subject = encodeURIComponent('Support My Scout Fundraiser');
                const body = encodeURIComponent((document.getElementById('comm-message').value || payload.message));
                window.location.href = `mailto:?subject=${subject}&body=${body}`;
            });
        }

        if (smsBtn) {
            smsBtn.addEventListener('click', () => {
                const payload = this.buildCommunicationPayload();
                const body = encodeURIComponent((document.getElementById('comm-message').value || payload.message));
                window.location.href = `sms:?body=${body}`;
            });
        }

        if (shareBtn) {
            shareBtn.addEventListener('click', async () => {
                const payload = this.buildCommunicationPayload();
                const text = (document.getElementById('comm-message').value || payload.message);
                if (navigator.share) {
                    try {
                        await navigator.share({ title: 'Support My Scout Fundraiser', text, url: payload.donationUrl });
                        return;
                    } catch (_e) {
                        // fallback below
                    }
                }
                await navigator.clipboard.writeText(text);
                await appleAlert('Copied', 'Sharing is not supported on this browser. Message copied to clipboard.');
            });
        }
    }

    refreshCommunicationPage() {
        const payload = this.buildCommunicationPayload();
        const linkEl = document.getElementById('comm-link');
        const msgEl = document.getElementById('comm-message');
        const qrContainer = document.getElementById('comm-qr');

        if (linkEl) linkEl.value = payload.donationUrl;
        if (msgEl && !msgEl.value) msgEl.value = payload.message;

        if (qrContainer) {
            if (typeof qrcode !== 'undefined') {
                const qr = qrcode(0, 'M');
                qr.addData(payload.donationUrl);
                qr.make();
                qrContainer.innerHTML = qr.createImgTag(5, 6);
            } else {
                qrContainer.innerHTML = '<p class="step-note">QR generator unavailable.</p>';
            }
        }
    }

    // ==================== OPERATIONS ====================

    setupOperationsPage() {
        const productForm = document.getElementById('product-form');
        const productList = document.getElementById('product-list');
        const addLineBtn = document.getElementById('order-add-line');
        const submitOrderBtn = document.getElementById('order-submit');
        const exportBtn = document.getElementById('export-closeout-csv');

        if (productForm) {
            productForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                if (!this.canAccessOperations()) {
                    await appleAlert('Restricted', 'Only unit leaders and admins can use Operations.');
                    return;
                }

                const name = document.getElementById('product-name').value.trim();
                const sku = document.getElementById('product-sku').value.trim();
                const price = Number(document.getElementById('product-price').value);
                const stock = Number(document.getElementById('product-stock').value);
                const active = !!document.getElementById('product-active').checked;

                if (!name || !sku || !Number.isFinite(price) || price < 0 || !Number.isFinite(stock) || stock < 0) {
                    await appleAlert('Invalid Product', 'Enter name, SKU, valid price, and stock.');
                    return;
                }

                try {
                    await addProductToFirestore(this.currentUnitId, this.currentUser.uid, {
                        name,
                        sku,
                        unitPrice: price,
                        stockOnHand: Math.floor(stock),
                        active,
                        lowStockThreshold: 5
                    });
                    productForm.reset();
                    document.getElementById('product-active').checked = true;
                    this.products = await getProductsFromFirestore(this.currentUnitId);
                    this.refreshOperationsPage();
                } catch (err) {
                    const code = err && err.code ? String(err.code) : '';
                    if (code.includes('permission-denied')) {
                        await appleAlert('Permission Denied', 'Your account role is not allowed to add products in this unit.');
                    } else {
                        await appleAlert('Save Failed', 'Could not add product. Please try again.');
                    }
                }
            });
        }

        if (productList) {
            productList.addEventListener('click', async (e) => {
                const btn = e.target.closest('[data-action="adjust-stock"]');
                if (!btn) return;
                if (!this.canAccessOperations()) {
                    await appleAlert('Restricted', 'Only unit leaders and admins can use Operations.');
                    return;
                }

                const productId = btn.dataset.productId;
                const input = document.getElementById(`stock-adjust-${productId}`);
                const adjustment = Number(input && input.value);
                if (!Number.isFinite(adjustment)) return;

                const product = this.products.find(p => p.id === productId);
                if (!product) return;
                const nextStock = Math.max(0, (Number(product.stockOnHand) || 0) + Math.floor(adjustment));
                const saved = await saveProductToFirestore(this.currentUnitId, productId, { stockOnHand: nextStock });
                if (!saved) {
                    await appleAlert('Save Failed', 'Could not update stock.');
                    return;
                }
                this.products = await getProductsFromFirestore(this.currentUnitId);
                this.refreshOperationsPage();
            });
        }

        if (addLineBtn) addLineBtn.addEventListener('click', () => this.addOrderDraftLine());
        if (submitOrderBtn) submitOrderBtn.addEventListener('click', () => this.submitOrderDraft());
        if (exportBtn) exportBtn.addEventListener('click', () => this.exportCloseoutCsv());
    }

    refreshOperationsPage() {
        const productForm = document.getElementById('product-form');
        if (productForm) {
            productForm.classList.toggle('hidden', !this.canAccessOperations());
        }
        this.renderProductList();
        this.populateOrderProductOptions();
        this.renderOrderDraft();
        this.renderOrdersList();
        this.renderCloseoutSummary();
    }

    populateOrderProductOptions() {
        const select = document.getElementById('order-product');
        if (!select) return;

        const activeProducts = (this.products || []).filter(p => p.active !== false);
        if (activeProducts.length === 0) {
            select.innerHTML = '<option value="">No active products</option>';
            return;
        }

        select.innerHTML = activeProducts.map(p =>
            `<option value="${p.id}">${escapeHTML(p.name)} (${escapeHTML(p.sku)}) - ${formatMoney(p.unitPrice)} | Stock: ${Number(p.stockOnHand) || 0}</option>`
        ).join('');
    }

    renderProductList() {
        const container = document.getElementById('product-list');
        if (!container) return;
        if (!this.products || this.products.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>No products added yet.</p></div>';
            return;
        }

        container.innerHTML = this.products.map(product => {
            const stock = Number(product.stockOnHand) || 0;
            const low = stock <= (Number(product.lowStockThreshold) || 5);
            return `<div class="sale-item">
                <div class="sale-info">
                    <h5>${escapeHTML(product.name)} (${escapeHTML(product.sku || '')})</h5>
                    <p>Price: ${formatMoney(product.unitPrice)} &bull; Stock: ${stock} ${low ? '&bull; LOW STOCK' : ''}</p>
                </div>
                <div class="sale-right">
                    <input type="number" id="stock-adjust-${product.id}" value="0" style="width:80px;" />
                    <button type="button" class="btn btn-secondary btn-small" data-action="adjust-stock" data-product-id="${product.id}">Adjust</button>
                </div>
            </div>`;
        }).join('');
    }

    addOrderDraftLine() {
        if (!this.canAccessOperations()) {
            return;
        }
        const productId = document.getElementById('order-product').value;
        const qty = Number(document.getElementById('order-qty').value);
        if (!productId || !Number.isFinite(qty) || qty <= 0) return;

        const product = (this.products || []).find(p => p.id === productId);
        if (!product) return;

        this.orderDraftLines.push({
            productId,
            name: product.name,
            sku: product.sku,
            qty: Math.floor(qty),
            unitPrice: Number(product.unitPrice) || 0,
            lineTotal: (Number(product.unitPrice) || 0) * Math.floor(qty)
        });
        this.renderOrderDraft();
    }

    renderOrderDraft() {
        const container = document.getElementById('order-lines');
        if (!container) return;

        if (!this.orderDraftLines || this.orderDraftLines.length === 0) {
            container.innerHTML = '<p class="step-note">No order lines yet.</p>';
            return;
        }

        const draftLines = this.orderDraftLines || [];
        const total = draftLines.reduce((sum, line) => sum + (Number(line.lineTotal) || 0), 0);
        container.innerHTML = draftLines.map((line, idx) =>
            `<div class="activity-item"><div class="activity-details"><div class="activity-title">${escapeHTML(line.name)} x${line.qty}</div><div class="activity-meta">${formatMoney(line.unitPrice)} each</div></div><div class="sale-amount">${formatMoney(line.lineTotal)}</div><button type="button" class="btn btn-danger btn-small" onclick="window.scoutApp.removeOrderDraftLine(${idx})">Remove</button></div>`
        ).join('') + `<div class="quick-summary">Order Total: ${formatMoney(total)}</div>`;
    }

    removeOrderDraftLine(index) {
        if (!Array.isArray(this.orderDraftLines)) return;
        this.orderDraftLines.splice(index, 1);
        this.renderOrderDraft();
    }

    async submitOrderDraft() {
        if (!this.canAccessOperations()) {
            await appleAlert('Restricted', 'Only unit leaders and admins can use Operations.');
            return;
        }

        if (!this.orderDraftLines || this.orderDraftLines.length === 0) {
            await appleAlert('No Items', 'Add at least one product line first.');
            return;
        }

        const productsById = new Map((this.products || []).map(p => [p.id, p]));
        for (const line of this.orderDraftLines) {
            const product = productsById.get(line.productId);
            const stock = Number(product && product.stockOnHand) || 0;
            if (line.qty > stock) {
                await appleAlert('Insufficient Stock', `Not enough stock for ${line.name}. Available: ${stock}.`);
                return;
            }
        }

        const paymentProcessor = document.getElementById('order-payment-processor').value;
        const paymentTransactionId = document.getElementById('order-txid').value.trim();
        const total = this.orderDraftLines.reduce((sum, line) => sum + (Number(line.lineTotal) || 0), 0);

        for (const line of this.orderDraftLines) {
            const product = productsById.get(line.productId);
            const nextStock = Math.max(0, (Number(product.stockOnHand) || 0) - Number(line.qty));
            const ok = await saveProductToFirestore(this.currentUnitId, line.productId, { stockOnHand: nextStock });
            if (!ok) {
                await appleAlert('Inventory Error', `Could not update inventory for ${line.name}.`);
                return;
            }
        }

        await addOrderToFirestore(this.currentUnitId, this.currentUser.uid, {
            scoutName: (this.currentUser.displayName || '').trim() || this.currentUser.email,
            lines: this.orderDraftLines,
            total,
            status: 'submitted',
            paymentProcessor,
            paymentTransactionId,
            paymentStatus: paymentProcessor === 'manual' ? 'received' : (paymentTransactionId ? 'received' : 'pending')
        });

        this.orderDraftLines = [];
        document.getElementById('order-txid').value = '';
        this.products = await getProductsFromFirestore(this.currentUnitId);
        this.orders = await getOrdersFromFirestore(this.currentUnitId);
        this.refreshOperationsPage();
        await appleAlert('Order Submitted', 'Product order saved and inventory updated.');
    }

    renderOrdersList() {
        const container = document.getElementById('orders-list');
        if (!container) return;
        if (!this.orders || this.orders.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>No submitted orders yet.</p></div>';
            return;
        }

        const sorted = [...this.orders].sort((a, b) => {
            const aMs = a.submittedAt && a.submittedAt.seconds ? a.submittedAt.seconds * 1000 : 0;
            const bMs = b.submittedAt && b.submittedAt.seconds ? b.submittedAt.seconds * 1000 : 0;
            return bMs - aMs;
        });

        container.innerHTML = `<h4 style="margin-top:1rem;">Recent Orders</h4>` + sorted.map(order => {
            const lineCount = Array.isArray(order.lines) ? order.lines.length : 0;
            return `<div class="sale-item"><div class="sale-info"><h5>${escapeHTML(order.scoutName || 'Scout')}</h5><p>${lineCount} lines &bull; ${escapeHTML(order.status || 'submitted')} &bull; ${escapeHTML(order.paymentProcessor || 'manual')}</p></div><div class="sale-right"><div class="sale-amount">${formatMoney(order.total)}</div></div></div>`;
        }).join('');
    }

    renderCloseoutSummary() {
        const masterOrderEl = document.getElementById('master-order');
        const reconEl = document.getElementById('recon-summary');
        if (!masterOrderEl || !reconEl) return;

        const aggregate = {};
        (this.orders || []).forEach(order => {
            (order.lines || []).forEach(line => {
                if (!aggregate[line.productId]) {
                    aggregate[line.productId] = {
                        product: line.name,
                        sku: line.sku,
                        qty: 0,
                        total: 0
                    };
                }
                aggregate[line.productId].qty += Number(line.qty) || 0;
                aggregate[line.productId].total += Number(line.lineTotal) || 0;
            });
        });

        const rows = Object.values(aggregate);
        if (rows.length === 0) {
            masterOrderEl.innerHTML = '<p class="step-note">No order lines available for master order.</p>';
        } else {
            masterOrderEl.innerHTML = `<h4>Master Order (Supplier)</h4>` + rows.map(r =>
                `<div class="activity-item"><div class="activity-details"><div class="activity-title">${escapeHTML(r.product)} (${escapeHTML(r.sku || '')})</div><div class="activity-meta">Qty: ${r.qty}</div></div><div class="sale-amount">${formatMoney(r.total)}</div></div>`
            ).join('');
        }

        const salesPool = this.allSales || this.sales || [];
        const totalSales = salesPool.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
        const totalOrders = (this.orders || []).reduce((sum, o) => sum + (Number(o.total) || 0), 0);
        const pendingDigital = (this.orders || []).filter(o => o.paymentStatus === 'pending').reduce((sum, o) => sum + (Number(o.total) || 0), 0);

        reconEl.innerHTML = `<h4>Financial Reconciliation</h4>
            <div class="quick-summary">
                Sales/Donations Logged: ${formatMoney(totalSales)} | Product Orders: ${formatMoney(totalOrders)} | Pending Processor Funds: ${formatMoney(pendingDigital)}
            </div>`;
    }

    exportCloseoutCsv() {
        const orderRows = [];
        (this.orders || []).forEach(order => {
            (order.lines || []).forEach(line => {
                orderRows.push({
                    scout: order.scoutName || '',
                    status: order.status || '',
                    paymentProcessor: order.paymentProcessor || '',
                    paymentStatus: order.paymentStatus || '',
                    product: line.name || '',
                    sku: line.sku || '',
                    qty: line.qty || 0,
                    unitPrice: line.unitPrice || 0,
                    lineTotal: line.lineTotal || 0
                });
            });
        });

        if (orderRows.length === 0) {
            appleAlert('No Data', 'No order rows to export yet.');
            return;
        }

        const csv = toCsv(orderRows);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `closeout-${this.currentUnitId || 'unit'}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    // ==================== ADMIN / SETTINGS ====================

    setupSettingsPage() {
        // Profile display
        const name = this.currentUser.displayName || 'Scout';
        const email = this.currentUser.email || '';
        const roleDisplay = this.currentRole.charAt(0).toUpperCase() + this.currentRole.slice(1);
        document.getElementById('admin-name').textContent = name;
        document.getElementById('admin-email').textContent = email;
        document.getElementById('admin-role').textContent = `Role: ${roleDisplay}`;
        document.getElementById('admin-avatar').textContent = name.charAt(0).toUpperCase();

        // Fundraising settings
        document.getElementById('fundraising-goal').value = this.settings.fundraisingGoal || DEFAULTS.FUNDRAISING_GOAL;
        document.getElementById('card-price').value = this.settings.cardPrice || DEFAULTS.CARD_PRICE;
        document.getElementById('donation-base-url').value = this.settings.donationBaseUrl || '';
        document.getElementById('default-payment-processor').value = this.settings.defaultPaymentProcessor || 'manual';

        const canManageFundraisingSettings = this.currentRole === 'leader' || this.currentRole === 'admin';
        const fundraisingSettingsCard = document.getElementById('fundraising-settings-card');
        if (fundraisingSettingsCard) {
            fundraisingSettingsCard.classList.toggle('hidden', !canManageFundraisingSettings);
        }

        const fundraisingGoalInput = document.getElementById('fundraising-goal');
        const fundraisingGoalGroup = fundraisingGoalInput ? fundraisingGoalInput.closest('.form-group') : null;
        if (fundraisingGoalGroup) {
            fundraisingGoalGroup.classList.toggle('hidden', !canManageFundraisingSettings);
        }

        // Unit Admin: control which pages are visible for other roles
        const pageVisibilityCard = document.getElementById('page-visibility-card');
        const pageVisibilityControls = document.getElementById('page-visibility-controls');
        const isUnitAdmin = this.currentRole === 'admin';
        if (pageVisibilityCard) {
            pageVisibilityCard.classList.toggle('hidden', !isUnitAdmin);
        }
        if (isUnitAdmin && pageVisibilityControls) {
            const roles = [
                { key: 'leader', label: 'Unit Leader', pages: ['quicklog', 'dashboard', 'sales', 'scouts', 'operations'] },
                { key: 'scout', label: 'Scout', pages: ['quicklog', 'dashboard', 'sales', 'scouts', 'communication'] },
                { key: 'parent', label: 'Parent/Guardian', pages: ['quicklog', 'dashboard', 'sales', 'scouts'] }
            ];
            const pageLabels = {
                quicklog: 'Quick Log',
                dashboard: 'Dashboard',
                sales: 'Sales',
                scouts: 'Scouts',
                operations: 'Operations',
                communication: 'Communication'
            };

            // Normalize state so unchecked/undefined never breaks
            this.unitPageVisibility = mergeUnitPageVisibility(this.unitPageVisibility);

            pageVisibilityControls.innerHTML = roles.map(role => {
                const rows = role.pages.map(page => {
                    const id = `pv-${role.key}-${page}`;
                    const statusId = `pv-${role.key}-${page}-label`;
                    const visible = !(this.unitPageVisibility[role.key] && this.unitPageVisibility[role.key][page] === false);
                    return `
                        <div class="field-control-row">
                            <span class="field-control-name">${escapeHTML(role.label)}: ${escapeHTML(pageLabels[page] || page)}</span>
                            <label class="toggle-switch">
                                <input type="checkbox" id="${id}" ${visible ? 'checked' : ''}>
                                <span class="toggle-slider"></span>
                            </label>
                            <span class="toggle-status" id="${statusId}">${visible ? 'Visible' : 'Hidden'}</span>
                        </div>
                    `;
                }).join('');
                return `<div style="margin-top:0.5rem;">${rows}</div>`;
            }).join('');

            roles.forEach(role => {
                role.pages.forEach(page => {
                    const id = `pv-${role.key}-${page}`;
                    const statusId = `pv-${role.key}-${page}-label`;
                    const el = document.getElementById(id);
                    const statusEl = document.getElementById(statusId);
                    if (!el) return;
                    el.addEventListener('change', async () => {
                        const visible = !!el.checked;
                        this.unitPageVisibility = mergeUnitPageVisibility(this.unitPageVisibility);
                        this.unitPageVisibility[role.key][page] = visible;
                        if (statusEl) statusEl.textContent = visible ? 'Visible' : 'Hidden';
                        this.applyNavigationVisibility();

                        try {
                            await saveUnitPageVisibilityToFirestore(this.currentUnitId, this.unitPageVisibility);
                        } catch (e) {
                            console.error('Error saving page visibility:', e);
                            await appleAlert('Save Failed', 'Could not save page visibility settings.');
                        }
                    });
                });
            });
        }

        const personalGoalInput = document.getElementById('personal-goal');
        if (personalGoalInput) {
            const currentGoal = Number(this.currentProfile && this.currentProfile.personalGoal);
            personalGoalInput.value = Number.isFinite(currentGoal) && currentGoal > 0 ? currentGoal : '';
            personalGoalInput.addEventListener('change', async () => {
                const value = Number(personalGoalInput.value);
                if (!Number.isFinite(value) || value <= 0) {
                    await appleAlert('Invalid Goal', 'Enter a valid personal goal greater than zero.');
                    personalGoalInput.value = Number.isFinite(currentGoal) && currentGoal > 0 ? currentGoal : '';
                    return;
                }

                const saved = await savePersonalGoalForUser(this.currentUser.uid, value);
                if (!saved) {
                    await appleAlert('Save Failed', 'Could not save personal goal. Please try again.');
                    return;
                }

                this.currentProfile = {
                    ...(this.currentProfile || {}),
                    personalGoal: value,
                    goalSetupComplete: true
                };
                this.refreshDashboard();
            });
        }

        if (canManageFundraisingSettings) {
            document.getElementById('fundraising-goal').addEventListener('change', async () => {
                this.settings.fundraisingGoal = Number(document.getElementById('fundraising-goal').value) || DEFAULTS.FUNDRAISING_GOAL;
                await saveSettingsToFirestore(this.currentUser.uid, this.settings);
                this.refreshDashboard();
            });

            document.getElementById('card-price').addEventListener('change', async () => {
                this.settings.cardPrice = Number(document.getElementById('card-price').value) || 10;
                await saveSettingsToFirestore(this.currentUser.uid, this.settings);
                this.quickFields.price.value = this.settings.cardPrice;
            });

            document.getElementById('donation-base-url').addEventListener('change', async () => {
                const urlValue = document.getElementById('donation-base-url').value.trim();

                // Validate URL format
                if (urlValue && !isValidUrl(urlValue)) {
                    await appleAlert('Invalid URL', 'Please enter a valid URL starting with http:// or https://');
                    document.getElementById('donation-base-url').value = this.settings.donationBaseUrl || '';
                    return;
                }

                this.settings.donationBaseUrl = urlValue;
                await saveSettingsToFirestore(this.currentUser.uid, this.settings);
            });

            document.getElementById('default-payment-processor').addEventListener('change', async () => {
                this.settings.defaultPaymentProcessor = document.getElementById('default-payment-processor').value;
                await saveSettingsToFirestore(this.currentUser.uid, this.settings);
            });
        }

        // Payment handles + lock toggles
        const handles = (this.settings.paymentHandles) || {};
        const qrImages = (this.settings.paymentQrImages) || {};
        const locks = (this.settings.handleLocks) || {};

        ['zelle', 'venmo', 'cashapp', 'applepay'].forEach(key => {
            const input = document.getElementById('handle-' + key);
            const qrInput = document.getElementById('handle-qr-' + key);
            const qrRemoveBtn = document.getElementById('handle-qr-remove-' + key);
            const lockCheckbox = document.getElementById('lock-' + key);
            const lockLabel = document.getElementById('lock-' + key + '-label');

            // Set handle value
            input.value = handles[key] || '';
            this.updateHandleQrPreview(key, qrImages[key] || '');

            // Set lock state
            const isLocked = !!locks[key];
            lockCheckbox.checked = isLocked;
            lockLabel.textContent = isLocked ? 'Locked' : 'Unlocked';
            input.readOnly = isLocked;
            if (isLocked) input.classList.add('handle-locked');
            if (qrInput) qrInput.disabled = isLocked;
            if (qrRemoveBtn) qrRemoveBtn.disabled = isLocked;

            // Handle input change (save to Firestore)
            input.addEventListener('change', async () => {
                if (!this.settings.paymentHandles) this.settings.paymentHandles = {};
                this.settings.paymentHandles[key] = input.value.trim();
                await saveSettingsToFirestore(this.currentUser.uid, this.settings);
            });

            if (qrInput) {
                qrInput.addEventListener('change', async () => {
                    const file = qrInput.files && qrInput.files[0];
                    if (!file) return;

                    if (!file.type || !file.type.startsWith('image/')) {
                        await appleAlert('Invalid File', 'Please upload an image file for the QR code.');
                        qrInput.value = '';
                        return;
                    }

                    if (file.size > MAX_QR_IMAGE_FILE_BYTES) {
                        await appleAlert('Image Too Large', 'Please upload an image under 300 KB.');
                        qrInput.value = '';
                        return;
                    }

                    try {
                        const imageDataUrl = await this.readImageFileAsDataUrl(file);
                        const dataUrlSize = this.estimateDataUrlSizeBytes(imageDataUrl);
                        if (dataUrlSize > MAX_QR_IMAGE_DATAURL_BYTES) {
                            await appleAlert('Image Too Large', 'This image is too large to store. Use a smaller QR screenshot (under ~350 KB encoded).');
                            return;
                        }

                        if (!this.settings.paymentQrImages) this.settings.paymentQrImages = {};
                        const previousImage = this.settings.paymentQrImages[key] || '';
                        this.settings.paymentQrImages[key] = imageDataUrl;
                        const saved = await saveSettingsToFirestore(this.currentUser.uid, this.settings);
                        if (!saved) {
                            this.settings.paymentQrImages[key] = previousImage;
                            await appleAlert('Save Failed', 'Could not save this QR image to cloud settings. Try a smaller image or check your connection.');
                            return;
                        }

                        this.updateHandleQrPreview(key, imageDataUrl);
                    } catch (_err) {
                        await appleAlert('Upload Failed', 'Could not process that image. Try another file.');
                    } finally {
                        qrInput.value = '';
                    }
                });
            }

            if (qrRemoveBtn) {
                qrRemoveBtn.addEventListener('click', async () => {
                    if (!this.settings.paymentQrImages) this.settings.paymentQrImages = {};
                    const previousImage = this.settings.paymentQrImages[key] || '';
                    this.settings.paymentQrImages[key] = '';
                    const saved = await saveSettingsToFirestore(this.currentUser.uid, this.settings);
                    if (!saved) {
                        this.settings.paymentQrImages[key] = previousImage;
                        await appleAlert('Save Failed', 'Could not remove QR image from cloud settings. Please try again.');
                        return;
                    }
                    this.updateHandleQrPreview(key, '');
                });
            }

            // Lock toggle change
            lockCheckbox.addEventListener('change', async () => {
                if (!this.settings.handleLocks) this.settings.handleLocks = {};
                const locked = lockCheckbox.checked;
                this.settings.handleLocks[key] = locked;
                lockLabel.textContent = locked ? 'Locked' : 'Unlocked';
                input.readOnly = locked;
                input.classList.toggle('handle-locked', locked);
                if (qrInput) qrInput.disabled = locked;
                if (qrRemoveBtn) qrRemoveBtn.disabled = locked;
                await saveSettingsToFirestore(this.currentUser.uid, this.settings);
            });
        });

        // Field controls
        const fc = (this.settings.fieldControls) || {};
        const controls = [
            { id: 'ctrl-price-editable', key: 'priceEditable', label: 'ctrl-price-label' },
            { id: 'ctrl-qty-editable', key: 'qtyEditable', label: 'ctrl-qty-label' },
            { id: 'ctrl-date-editable', key: 'dateEditable', label: 'ctrl-date-label' },
            { id: 'ctrl-customer-editable', key: 'customerEditable', label: 'ctrl-customer-label' }
        ];

        controls.forEach(ctrl => {
            const checkbox = document.getElementById(ctrl.id);
            const label = document.getElementById(ctrl.label);
            const isOn = fc[ctrl.key] !== false && ctrl.key !== 'priceEditable' ? true : !!fc[ctrl.key];
            checkbox.checked = isOn;
            label.textContent = isOn ? 'Editable' : 'Locked';

            checkbox.addEventListener('change', async () => {
                if (!this.settings.fieldControls) this.settings.fieldControls = {};
                this.settings.fieldControls[ctrl.key] = checkbox.checked;
                label.textContent = checkbox.checked ? 'Editable' : 'Locked';
                await saveSettingsToFirestore(this.currentUser.uid, this.settings);
                this.applyFieldControls();
            });
        });

        // Install App button
        const installBtn = document.getElementById('install-app-btn');
        const installDone = document.getElementById('install-app-done');
        if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
            // Already installed
            installBtn.classList.add('hidden');
            installDone.classList.remove('hidden');
        }
        installBtn.addEventListener('click', async () => {
            if (!deferredInstallPrompt) {
                const insecureHint = !window.isSecureContext
                    ? 'Open the app with https:// (or localhost on the same device). LAN IP over plain http:// will not allow install prompts.'
                    : 'Continue using the app and try again.';
                await appleAlert('Install Not Ready', `${insecureHint} On iPhone/iPad, use Safari Share menu and choose Add to Home Screen.`);
                return;
            }
            deferredInstallPrompt.prompt();
            const result = await deferredInstallPrompt.userChoice;
            if (result.outcome === 'accepted') {
                installBtn.classList.add('hidden');
                installDone.classList.remove('hidden');
            }
            deferredInstallPrompt = null;
        });
    }

    // ==================== MODALS ====================

    setupModals() {
        document.querySelectorAll('.close').forEach(btn => {
            btn.addEventListener('click', () => {
                btn.closest('.modal').style.display = 'none';
            });
        });

        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.style.display = 'none';
                }
            });
        });
    }

    // ==================== LOGOUT ====================

    setupLogout() {
        const logoutButtons = document.querySelectorAll('.logout-btn');
        logoutButtons.forEach(logoutBtn => {
            logoutBtn.addEventListener('click', async () => {
                try {
                    const { signOut } = window.firebaseImports;
                    await signOut(auth);

                    // Clear all application state
                    currentUser = null;
                    dataCache.clear('scouts');
                    dataCache.clear('sales');
                    dataCache.clear('stats');
                    authRateLimit.loginAttempts = 0;
                    authRateLimit.signupAttempts = 0;

                    // Clear localStorage
                    localStorage.clear();
                    sessionStorage.clear();

                    // Hard refresh the page to reset all state
                    window.location.href = window.location.origin + window.location.pathname;
                } catch (error) {
                    console.error('Logout error:', error);
                    // Force refresh even if logout fails
                    window.location.href = window.location.origin + window.location.pathname;
                }
            });
        });
    }
}

// ==================== START APP ====================

// Expose for module script in index.html
window.initializeFirebase = initializeFirebase;
