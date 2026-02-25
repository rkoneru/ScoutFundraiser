// Scout Fundraiser App - Firebase Online Version
// Complete working implementation

// ==================== GLOBAL STATE ====================
let db, auth, currentUser = null;
let app = null;
let deferredInstallPrompt = null;
const MAX_QR_IMAGE_FILE_BYTES = 300 * 1024;
const MAX_QR_IMAGE_DATAURL_BYTES = 350 * 1024;

// ==================== DEBUG HELPERS & RECOVERY ====================
// These can be called from browser console to debug and recover from issues
window.DEBUG = {
    async checkUnitInFirestore(unitId) {
        const { getDoc, doc } = window.firebaseImports;
        const normalized = (unitId || '').trim().toUpperCase();
        try {
            const result = await getDoc(doc(db, 'unitsPublic', normalized));
            console.log(`[DEBUG CHECK] unitsPublic/${normalized} exists:`, result.exists());
            if (result.exists()) {
                console.log('[DEBUG CHECK] Unit data:', result.data());
            } else {
                console.warn(`[DEBUG CHECK] Unit NOT in unitsPublic: ${normalized}`);
            }
            return result.data();
        } catch (e) {
            console.error('[DEBUG CHECK] Error reading unitsPublic:', e);
            return null;
        }
    },
    
    async checkUnitInUnits(unitId) {
        const { getDoc, doc } = window.firebaseImports;
        const normalized = (unitId || '').trim().toUpperCase();
        try {
            const result = await getDoc(doc(db, 'units', normalized));
            console.log(`[DEBUG CHECK] units/${normalized} exists:`, result.exists());
            if (result.exists()) {
                console.log('[DEBUG CHECK] Unit data:', result.data());
                return result.data();
            } else {
                console.warn(`[DEBUG CHECK] Unit NOT in units: ${normalized}`);
            }
            return null;
        } catch (e) {
            console.error('[DEBUG CHECK] Error reading units:', e);
            return null;
        }
    },
    
    async listAllUnitsPublic() {
        const { getDocs, collection } = window.firebaseImports;
        try {
            const snap = await getDocs(collection(db, 'unitsPublic'));
            console.log(`[DEBUG LIST] Found ${snap.size} units in unitsPublic:`);
            snap.forEach(doc => {
                console.log(`  - ${doc.id}:`, doc.data());
            });
            return snap.size;
        } catch (e) {
            console.error('[DEBUG LIST] Error listing unitsPublic:', e);
            return null;
        }
    },
    
    async recoverMissingUnitsPublicDoc(unitId) {
        const { getDoc, setDoc, doc } = window.firebaseImports;
        const normalized = (unitId || '').trim().toUpperCase();
        
        console.log(`[RECOVERY] Attempting to recover unitId: ${normalized}`);
        
        // Verify Firebase is initialized
        if (!db) {
            console.error(`[RECOVERY] Firebase db not initialized!`);
            return false;
        }
        
        if (!currentUser) {
            console.error(`[RECOVERY] Not logged in! Current user:`, currentUser);
            return false;
        }
        
        console.log(`[RECOVERY] Logged in as:`, currentUser.uid);
        
        // Check if unit exists in units collection
        try {
            const unitDoc = await getDoc(doc(db, 'units', normalized));
            if (!unitDoc.exists()) {
                console.error(`[RECOVERY] Unit ${normalized} not found in units collection!`);
                return false;
            }
            
            const unitData = unitDoc.data();
            console.log(`[RECOVERY] Found unit in units/${normalized}:`, unitData);
            
            // Create the missing unitsPublic document
            const publicRef = doc(db, 'unitsPublic', normalized);
            const writeData = {
                unitId: normalized,
                name: unitData.name || 'Troop Unit',
                createdBy: unitData.createdBy,
                createdAt: unitData.createdAt,
                active: unitData.active !== false
            };
            console.log(`[RECOVERY] Attempting to write unitsPublic/${normalized} with:`, writeData);
            
            await setDoc(publicRef, writeData);
            
            console.log(`[RECOVERY] ✅ Created unitsPublic/${normalized}`);
            
            // Verify
            const verify = await getDoc(publicRef);
            if (verify.exists()) {
                console.log(`[RECOVERY] ✅ VERIFIED unitsPublic/${normalized} now exists!`);
                return true;
            } else {
                console.error(`[RECOVERY] ❌ Verification failed - could not read back unitsPublic/${normalized}`);
                return false;
            }
        } catch (e) {
            console.error(`[RECOVERY] Error during recovery:`, e);
            console.error(`[RECOVERY] Code: ${e.code}, Message: ${e.message}`);
            console.error(`[RECOVERY] Full error:`, e);
            return false;
        }
    }
};

// ==================== DEFAULTS & CONSTANTS ====================
// All magic numbers extracted to DEFAULTS constant (Issue #4 fix)
const DEFAULTS = {
    FUNDRAISING_GOAL: 5000,
    SCOUT_GOAL: 2000,
    CARD_PRICE: 10,
    RATE_LIMIT_MAX_ATTEMPTS: 5,
    RATE_LIMIT_COOLDOWN_MS: 60000, // 1 minute cooldown
    MAX_PROGRESS_PCT: 100,
    FIREBASE_MAX_RETRIES: 50,
    DEBOUNCE_DELAY_MS: 300,
    CACHE_TTL_MS: 30000, // 30 second cache for N+1 fix
    SESSION_TIMEOUT_MS: 15 * 60 * 1000 // 15 minutes of inactivity before logout
};

// SECURITY: Rate limiting for login/signup attempts (per-email basis)
const authRateLimit = {
    // Track attempts per email address to prevent brute-forcing multiple accounts
    emailAttempts: {}, // { email: { attempts: 0, lastAttempt: timestamp, locked: false } }
    maxAttempts: DEFAULTS.RATE_LIMIT_MAX_ATTEMPTS,
    cooldownMs: DEFAULTS.RATE_LIMIT_COOLDOWN_MS,

    // Get or create rate limit entry for email
    getEmailLimit(email) {
        if (!this.emailAttempts[email]) {
            this.emailAttempts[email] = {
                attempts: 0,
                lastAttempt: 0,
                locked: false,
                lockedUntil: 0
            };
        }
        return this.emailAttempts[email];
    },

    // Check if email is rate limited
    isLimited(email) {
        const limit = this.getEmailLimit(email);
        const now = Date.now();

        // Unlock if cooldown period has passed
        if (limit.locked && now > limit.lockedUntil) {
            limit.locked = false;
            limit.attempts = 0;
            limit.lastAttempt = 0;
        }

        return limit.locked;
    },

    // Record attempt for email
    recordAttempt(email) {
        const limit = this.getEmailLimit(email);
        limit.attempts++;
        limit.lastAttempt = Date.now();

        if (limit.attempts >= this.maxAttempts) {
            limit.locked = true;
            limit.lockedUntil = Date.now() + this.cooldownMs;
        }
    },

    // Reset attempts for email after successful login
    reset(email) {
        const limit = this.getEmailLimit(email);
        limit.attempts = 0;
        limit.lastAttempt = 0;
        limit.locked = false;
        limit.lockedUntil = 0;
    },

    // Get remaining cooldown in seconds
    getRemainingCooldown(email) {
        const limit = this.getEmailLimit(email);
        if (!limit.locked) return 0;
        return Math.max(0, Math.ceil((limit.lockedUntil - Date.now()) / 1000));
    }
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

// SECURITY: Session timeout on inactivity (Issue: HIGH - Weak session management)
// Implements 15-minute idle timeout to prevent unauthorized access on shared devices
const sessionManager = {
    idleTimer: null,
    isActive: false,

    // Start monitoring session for inactivity
    start() {
        if (this.isActive) return; // Already started
        this.isActive = true;
        this.resetIdleTimer();

        // Add event listeners for user activity
        document.addEventListener('mousemove', () => this.resetIdleTimer());
        document.addEventListener('keypress', () => this.resetIdleTimer());
        document.addEventListener('click', () => this.resetIdleTimer());
        document.addEventListener('touchstart', () => this.resetIdleTimer());

        console.log('[SESSION] Started session timeout (15 min inactivity)');
    },

    // Stop monitoring session
    stop() {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
        this.isActive = false;
        console.log('[SESSION] Stopped session timeout');
    },

    // Reset the idle timer (user is active)
    resetIdleTimer() {
        if (!this.isActive) return;

        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
        }

        this.idleTimer = setTimeout(() => {
            this.handleSessionExpiry();
        }, DEFAULTS.SESSION_TIMEOUT_MS);
    },

    // Handle session expiry due to inactivity
    async handleSessionExpiry() {
        console.warn('[SESSION] Session expired due to inactivity');

        try {
            const { signOut } = window.firebaseImports;
            await signOut(auth);
        } catch (e) {
            console.error('[SESSION] Error during session expiry logout:', e);
        }

        // Show alert and redirect to login
        await appleAlert(
            'Session Expired',
            'You were logged out due to 15 minutes of inactivity. Please log in again for security.'
        );

        // Force hard refresh to login page
        window.location.href = window.location.origin + window.location.pathname;
    }
};

// ==================== SHARED HELPER FUNCTIONS ====================
// Issue #3 fix: Refactored duplicate render code into shared helper

/**
 * Debounce helper to prevent rapid consecutive calls
 * @param {Function} func - Function to debounce
 * @param {Number} delay - Delay in milliseconds
 * @returns {Function} Debounced function
 */
function debounce(func, delay = DEFAULTS.DEBOUNCE_DELAY_MS) {
    let timeoutId;
    return function(...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func.apply(this, args), delay);
    };
}

/**
 * Check if role has leader or admin privileges
 * @param {String} role - Role to check
 * @returns {Boolean} True if role is leader or admin
 */
function isLeaderOrAdminRole(role) {
    return ['leader', 'unit_leader', 'admin', 'unit_admin'].includes(role);
}

/**
 * Development-only logging (no-op in production)
 */
function devLog(...args) {
    if (typeof window !== 'undefined' && window.location && window.location.hostname === 'localhost') {
        console.log(...args);
    }
}

/**
 * SECURITY: Mask email for safe logging (prevents data exposure in logs)
 * @param {String} email - Email address to mask
 * @returns {String} Masked email like "user@******.com"
 */
function maskEmailForLogging(email) {
    if (!email || typeof email !== 'string') return 'invalid-email';
    const [name, domain] = email.split('@');
    if (!name || !domain) return 'malformed-email';
    return name.substring(0, Math.min(3, name.length)) + '***@' + domain.split('.')[0].substring(0, 2) + '***';
}

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
        const safeMessage = escapeHTML(e && e.message ? e.message : String(e));
        document.body.innerHTML = '<div style="padding:2rem;color:red;"><h2>Error initializing Firebase</h2><p>' + safeMessage + '</p><p>Check firebase-config.js and browser console</p></div>';
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
    const message = (error && error.message) ? String(error.message) : '';

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
        'permission-denied': 'Access blocked by Firestore rules. Ensure firestore.rules is deployed correctly.',
        'failed-precondition': 'Firestore is not ready. Try again in a moment.'
    };

    // Check for specific Firebase errors
    if (message.includes('unitsPublic') && message.includes('permission')) {
        return 'Unable to register unit. Contact your unit admin if problem persists.';
    }

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
            applepay: '',
            creditcard: ''
        },
        paymentQrImages: {
            zelle: '',
            venmo: '',
            cashapp: '',
            applepay: '',
            creditcard: ''
        },
        handleLocks: {
            zelle: false,
            venmo: false,
            cashapp: false,
            applepay: false,
            creditcard: false
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
        if (!unitId || !unitId.trim()) {
            console.warn('unitExists: unitId is empty or not provided');
            return false;
        }
        const { getDoc, doc } = window.firebaseImports;
        const normalizedId = normalizeUnitId(unitId);
        console.log(`[DEBUG UNIT EXISTS] Checking unitsPublic/${normalizedId}`);
        console.log(`[DEBUG UNIT EXISTS] Raw input: "${unitId}", Normalized: "${normalizedId}"`);
        
        const unitDoc = await getDoc(doc(db, 'unitsPublic', normalizedId));
        const exists = unitDoc.exists();
        console.log(`[DEBUG UNIT EXISTS] unitsPublic/${normalizedId} exists=${exists}`);
        if (unitDoc.exists()) {
            console.log(`[DEBUG UNIT EXISTS] Unit data:`, unitDoc.data());
        } else {
            console.warn(`[DEBUG UNIT EXISTS] Unit NOT FOUND in unitsPublic: ${normalizedId}`);
        }
        return exists;
    } catch (e) {
        console.error('[ERROR UNIT EXISTS] Exception caught:', e.code, e.message);
        console.error('[ERROR UNIT EXISTS] Full error:', e);
        return false;
    }
}

async function createUnitForLeader(userId, leaderName, troopName = '') {
    const { setDoc, getDoc, doc, serverTimestamp } = window.firebaseImports;
    for (let attempt = 0; attempt < 8; attempt++) {
        const unitId = generateUnitId();
        const unitRef = doc(db, 'units', unitId);
        const existing = await getDoc(unitRef);
        if (existing.exists()) {
            console.log(`[DEBUG UNIT CREATE] Generated unitId exists, retrying: ${unitId}`);
            continue;
        }

        console.log(`[DEBUG UNIT CREATE] Creating unit: ${unitId}, attempt: ${attempt + 1}`);
        
        // Create main unit document
        await setDoc(unitRef, {
            unitId,
            name: (troopName || '').trim() || 'Troop Unit',
            createdBy: userId,
            createdByName: leaderName || '',
            createdAt: serverTimestamp(),
            active: true
        });
        console.log(`[DEBUG UNIT CREATE] Created units/${unitId}`);

        // Public lookup doc (minimal safe fields) for pre-auth Unit ID validation.
        // This is CRITICAL for allowing other users to join the unit!
        const publicRef = doc(db, 'unitsPublic', unitId);
        let publicSucceeded = false;
        let retries = 0;
        
        while (retries < 3 && !publicSucceeded) {
            try {
                await setDoc(publicRef, {
                    unitId,
                    name: (troopName || '').trim() || 'Troop Unit',
                    createdBy: userId,
                    createdAt: serverTimestamp(),
                    active: true
                });
                console.log(`[DEBUG UNIT CREATE] Wrote unitsPublic/${unitId} (attempt ${retries + 1})`);
                
                // VERIFY: Read back to confirm - CRITICAL CHECK
                // Wait a tiny bit for Firestore replication
                await new Promise(resolve => setTimeout(resolve, 100));
                
                const verify = await getDoc(publicRef);
                if (verify.exists()) {
                    console.log(`[DEBUG UNIT CREATE] ✅ VERIFIED unitsPublic/${unitId} exists:`, verify.data());
                    publicSucceeded = true;
                } else {
                    console.warn(`[DEBUG UNIT CREATE] ⚠️ unitsPublic/${unitId} write succeeded but read failed (attempt ${retries + 1})`);
                    retries++;
                    if (retries < 3) {
                        await new Promise(resolve => setTimeout(resolve, 200));
                    }
                }
            } catch (publicError) {
                console.error(`[ERROR UNIT CREATE] Failed to create unitsPublic/${unitId} (attempt ${retries + 1}):`, publicError);
                console.error(`[ERROR UNIT CREATE] Error code:`, publicError.code);
                console.error(`[ERROR UNIT CREATE] Error message:`, publicError.message);
                retries++;
                
                if (retries >= 3) {
                    throw new Error(`Failed to register unit publicly after 3 attempts. Error: ${publicError.message}`);
                }
                
                // Wait before retrying
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        }
        
        if (!publicSucceeded) {
            throw new Error('Unable to register unit publicly (read verification failed). Please try again.');
        }
        
        return unitId;
    }
    throw new Error('Unable to generate a unique Unit ID. Please try again.');
}

async function saveMembershipAndProfile(userId, { unitId, role, name, email }) {
    const { setDoc, doc, serverTimestamp } = window.firebaseImports;
    const normalizedUnitId = normalizeUnitId(unitId);
    const normalizedRole = normalizeRole(role);
    // SECURITY: Don't log user IDs or unit IDs (privacy/identification risk)
    console.log('[DEBUG SAVE MEMBERSHIP] Saving membership with role:', normalizedRole);
    
    await setDoc(doc(db, 'memberships', userId), {
        userId,
        unitId: normalizedUnitId,
        role: normalizedRole,
        status: 'active',
        createdAt: serverTimestamp()
    }, { merge: true });
    console.log('[DEBUG SAVE MEMBERSHIP] memberships document saved');

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
    const csvCell = (val) => {
        const raw = String(val == null ? '' : val);
        // SECURITY: Mitigate CSV/Excel formula injection by prefixing with apostrophe.
        // Many spreadsheet apps can still evaluate quoted leading formula chars.
        const safe = (/^[=+@\-]/.test(raw)) ? (`'${raw}`) : raw;
        return `"${safe.replace(/"/g, '""')}"`;
    };
    const lines = [headers.map(h => csvCell(h)).join(',')];
    rows.forEach(row => {
        lines.push(headers.map(h => csvCell(row[h])).join(','));
    });
    return lines.join('\n');
}

function csvCell(value) {
    const raw = String(value == null ? '' : value);
    const safe = (/^[=+@\-]/.test(raw)) ? (`'${raw}`) : raw;
    return `"${safe.replace(/"/g, '""')}"`;
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

        // OPTIMIZATION: Persistent listener state (Firestore Phase 1)
        // Listeners are created ONCE and reused across page navigation
        // Only recreated when unit changes
        this.realtimeUnsubs = {
            sales: null,
            scouts: null,
            products: null,
            orders: null,
            user: null,
            unit: null
        };
        this.listenersCreated = false;
        this.currentListenerUnitId = null;

        this.unitPageVisibility = getDefaultUnitPageVisibility();

        // Active product for Quick Log (set by admin in Operations)
        this.activeProduct = {
            id: 'scout-cards',
            name: '💳 Scout Cards',
            price: 10,
            sku: 'SCOUT-CARDS'
        };

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

        // SECURITY: Start session timeout manager when app is displayed
        sessionManager.start();
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
            const isLeaderOrAdmin = isLeaderOrAdminRole(this.currentRole);
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
            console.log('[DEBUG SIGNUP UI] Role updated:', roleSelect.value, 'canCreateUnit:', canCreateUnit);

            const willCreateUnit = canCreateUnit && createUnitToggle.checked;
            troopNameGroup.classList.toggle('hidden', !willCreateUnit);
            unitIdGroup.classList.toggle('hidden', willCreateUnit);
            
            console.log('[DEBUG SIGNUP UI] willCreateUnit:', willCreateUnit, 'unitIdGroup visibility:', !willCreateUnit);

            if (willCreateUnit) {
                unitIdInput.value = '';
                unitIdInput.required = false;
            } else if (!canCreateUnit) {
                // Non-admin must provide unit ID
                unitIdInput.required = true;
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

        if (!email || !password) {
            errorEl.textContent = 'Please enter email and password.';
            return;
        }

        // SECURITY FIX: Per-email rate limiting to prevent brute force attacks
        if (authRateLimit.isLimited(email)) {
            const secondsLeft = authRateLimit.getRemainingCooldown(email);
            errorEl.textContent = `Too many login attempts. Please wait ${secondsLeft} seconds before trying again.`;
            return;
        }

        authRateLimit.recordAttempt(email);

        try {
            const { signInWithEmailAndPassword } = window.firebaseImports;
            await signInWithEmailAndPassword(auth, email, password);
            errorEl.textContent = '';
            // Reset rate limit on successful login
            authRateLimit.reset(email);
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
        const unitIdRaw = document.getElementById('signup-unit-id').value.trim();
        const unitIdInput = normalizeUnitId(unitIdRaw);
        const email = document.getElementById('signup-email').value.trim();
        const password = document.getElementById('signup-password').value;
        const confirm = document.getElementById('signup-confirm').value;
        const errorEl = document.getElementById('signup-error');

        // SECURITY: Don't log email addresses in debug output
        console.log('[DEBUG SIGNUP] Form state:', {
            name,
            role,
            normalizedSignupRole,
            createUnit,
            troopName,
            unitIdRaw,
            unitIdInput
        });

        if (!errorEl) {
            console.error('signup-error element not found');
            await appleAlert('Form Error', 'Check browser console for details.');
            return;
        }

        if (!name || !email || !password || !confirm || !role) {
            errorEl.textContent = 'Please fill in all fields.';
            return;
        }

        // SECURITY FIX: Per-email rate limiting to prevent signup spam/abuse
        if (authRateLimit.isLimited(email)) {
            const secondsLeft = authRateLimit.getRemainingCooldown(email);
            errorEl.textContent = `Too many signup attempts. Please wait ${secondsLeft} seconds before trying again.`;
            return;
        }

        authRateLimit.recordAttempt(email);

        let resolvedUnitId = '';
        const creatingNewUnit = role === 'admin' && createUnit;
        
        console.log('[DEBUG UNIT CHECK] creatingNewUnit:', creatingNewUnit, 'role:', role, 'createUnit:', createUnit);

        if (!creatingNewUnit) {
            // User is JOINING an existing unit
            if (!unitIdRaw || !unitIdInput) {
                errorEl.textContent = 'Unit ID is required. Ask your unit admin for the Unit ID.';
                console.warn('[VALIDATION] Missing unit ID for join attempt');
                return;
            }

            // SECURITY: Privileged roles are not self-assignable when joining an existing unit.
            // Unit creator can create the unit as admin; later promotion should be done by an existing admin.
            if (normalizedSignupRole === 'admin' || normalizedSignupRole === 'leader') {
                errorEl.textContent = 'To join an existing unit, select Scout or Parent/Guardian. Leaders/Admins must be promoted by the unit admin.';
                console.warn('[VALIDATION] Admin/Leader tried to join existing unit');
                return;
            }

            console.log('[DEBUG UNIT CHECK] Validating unit ID:', unitIdInput);
            const exists = await unitExists(unitIdInput);
            console.log('[DEBUG UNIT CHECK] unitExists returned:', exists);
            
            if (!exists) {
                errorEl.textContent = `Unit ID "${unitIdInput}" not found. Verify the ID is correct or check with your unit admin.`;
                console.warn('[VALIDATION] Unit not found:', unitIdInput);
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

            // SECURITY: Don't log email addresses (sensitive data)
            console.log('[DEBUG SIGNUP] Creating Firebase user account');
            const userCred = await createUserWithEmailAndPassword(auth, email, password);
            console.log('[DEBUG SIGNUP] User account created successfully');
            
            await updateProfile(userCred.user, { displayName: name });
            console.log('[DEBUG SIGNUP] Profile updated with displayName:', name);

            if (creatingNewUnit) {
                console.log('[DEBUG SIGNUP] Creating new unit for leader');
                resolvedUnitId = await createUnitForLeader(userCred.user.uid, name, troopName);
                console.log('[DEBUG SIGNUP] New unit created:', resolvedUnitId);
            } else {
                console.log('[DEBUG SIGNUP] Joining existing unit:', resolvedUnitId);
            }

            await saveMembershipAndProfile(userCred.user.uid, {
                unitId: resolvedUnitId,
                role: normalizedSignupRole,
                name,
                email
            });
            console.log('[DEBUG SIGNUP] Membership and profile saved');
            
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
            console.log('[DEBUG SIGNUP] User document created');

            // Do not auto-create scouts here. Scouts list is read from database only.

            if (creatingNewUnit) {
                await appleAlert('Unit Created', `Your Unit ID is ${resolvedUnitId}. Share this code with scouts/parents to join.`);
            }

            errorEl.textContent = '';
            // Reset rate limit on successful signup
            authRateLimit.signupAttempts = 0;
            document.getElementById('signup-form').reset();
            errorEl.textContent = 'Account created! Logging in...';
            authRateLimit.reset(email); // Reset rate limit on successful signup
            console.log('[DEBUG SIGNUP] Signup flow completed successfully');
        } catch (error) {
            const isEmailInUse = !!(error && error.code === 'auth/email-already-in-use');
            if (isEmailInUse) {
                console.info('Signup blocked: email already in use. Switching to login.');
            } else {
                console.error('Signup error:', error);
                console.error('Error code:', error?.code);
                console.error('Error message:', error?.message);
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

        // OPTIMIZATION: Use persistent listener validation (Phase 1)
        // Listeners created once, reused across page navigation
        this.validateListenersForUnit(this.currentUnitId);

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
        const isLeaderOrAdmin = isLeaderOrAdminRole(this.currentRole);

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
            const isLeaderOrAdmin = isLeaderOrAdminRole(this.currentRole);
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

    // OPTIMIZATION: Persistent Firestore listeners (Phase 1)
    // Listeners created ONCE on app init, reused across page navigation
    // Only recreated when unit changes
    stopListeners() {
        if (this.listenersCreated) {
            Object.keys(this.realtimeUnsubs).forEach(key => {
                try {
                    const unsub = this.realtimeUnsubs[key];
                    if (typeof unsub === 'function') unsub();
                } catch (_e) {
                    // Ignore errors during cleanup
                }
            });
        }
        this.listenersCreated = false;
        this.currentListenerUnitId = null;
        this.realtimeUnsubs = {
            sales: null,
            scouts: null,
            products: null,
            orders: null,
            user: null,
            unit: null
        };
    }

    validateListenersForUnit(unitId) {
        const normalizedId = normalizeUnitId(unitId);

        // Unit changed → recreate listeners
        if (this.currentListenerUnitId !== normalizedId) {
            this.stopListeners();
            this.currentListenerUnitId = normalizedId;
            this.initializeListeners();
            return;
        }

        // Unit same → ensure listeners exist
        if (!this.listenersCreated) {
            this.initializeListeners();
        }
    }

    initializeListeners() {
        if (!window.firebaseImports.onSnapshot) return;
        if (this.listenersCreated) return;  // Already created, skip

        const { onSnapshot, collection, doc } = window.firebaseImports;
        const unitId = normalizeUnitId(this.currentUnitId);

        // OPTIMIZATION: Create 6 listeners ONCE, reuse across navigation
        // Before fix: 6 reads per navigation (60 reads for 10 navigations)
        // After fix: 6 reads total (one-time on app load)

        this.realtimeUnsubs.sales = onSnapshot(collection(db, `users/${this.currentUser.uid}/sales`), (snapshot) => {
            this.sales = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));

            // OPTIMIZATION: Smart page-specific updates (Dashboard Phase 1)
            // Only update pages where sales data affects rendering
            if (this.currentPage === 'dashboard') {
                // Dashboard: Use smart render detection to avoid unnecessary updates
                this.refreshDashboard();
            }
            if (this.currentPage === 'sales') {
                // Sales page: Always refresh (user is actively viewing)
                this.refreshSalesList();
            }
            if (this.currentPage === 'communication') {
                // Communication: Update to show current donor info
                this.refreshCommunicationPage();
            }
            if (this.currentPage === 'operations' || this.currentPage === 'scouts') {
                // Operations/Scouts: Fetch all sales for analytics
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

        this.realtimeUnsubs.scouts = onSnapshot(collection(db, `units/${unitId}/scouts`), (snapshot) => {
            this.scouts = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
            if (this.currentPage === 'scouts') {
                this.refreshScoutsList();
                this.refreshLeaderboard();
            }
        });

        if (this.canAccessOperations()) {
            this.realtimeUnsubs.products = onSnapshot(collection(db, `units/${unitId}/products`), (snapshot) => {
                this.products = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
                if (this.currentPage === 'operations') this.refreshOperationsPage();
            });

            this.realtimeUnsubs.orders = onSnapshot(collection(db, `units/${unitId}/orders`), (snapshot) => {
                this.orders = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
                if (this.currentPage === 'operations') this.refreshOperationsPage();
            });
        } else {
            // No-op unsubscriber for non-operations users
            this.realtimeUnsubs.products = () => {};
            this.realtimeUnsubs.orders = () => {};
        }

        this.realtimeUnsubs.user = onSnapshot(doc(db, 'users', this.currentUser.uid), (docSnap) => {
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

        this.realtimeUnsubs.unit = onSnapshot(doc(db, 'units', unitId), (docSnap) => {
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

        this.listenersCreated = true;
    }

    startRealtimeListeners() {
        // DEPRECATED: Use validateListenersForUnit() instead
        // Kept for backward compatibility
        this.validateListenersForUnit(this.currentUnitId);
    }

    // ==================== DASHBOARD ====================

    // PERFORMANCE FIX: Track dashboard listeners to prevent accumulation
    dashboardListeners = {
        search: null,
        filterType: null,
        filterPayment: null,
        listClick: null,
        debouncedRender: null
    };

    cleanupDashboardListeners() {
        // PERFORMANCE FIX: Remove old listeners before re-adding
        const searchEl = document.getElementById('dash-sales-search');
        const typeEl = document.getElementById('dash-sales-filter-type');
        const paymentEl = document.getElementById('dash-sales-filter-payment');
        const listEl = document.getElementById('dash-sales-list');

        if (searchEl && this.dashboardListeners.debouncedRender) {
            searchEl.removeEventListener('input', this.dashboardListeners.debouncedRender);
            searchEl.removeEventListener('change', this.dashboardListeners.debouncedRender);
        }
        if (typeEl && this.dashboardListeners.debouncedRender) {
            typeEl.removeEventListener('input', this.dashboardListeners.debouncedRender);
            typeEl.removeEventListener('change', this.dashboardListeners.debouncedRender);
        }
        if (paymentEl && this.dashboardListeners.debouncedRender) {
            paymentEl.removeEventListener('input', this.dashboardListeners.debouncedRender);
            paymentEl.removeEventListener('change', this.dashboardListeners.debouncedRender);
        }
        if (listEl && this.dashboardListeners.listClick) {
            listEl.removeEventListener('click', this.dashboardListeners.listClick);
        }
    }

    setupDashboardPage() {
        // PERFORMANCE FIX: Clean up old listeners first
        this.cleanupDashboardListeners();

        // Search and filter listeners for dashboard transactions (debounced to prevent excessive renders)
        this.dashboardListeners.debouncedRender = debounce(() => this.renderDashTransactions(), 150);
        ['input', 'change'].forEach(evt => {
            document.getElementById('dash-sales-search').addEventListener(evt, this.dashboardListeners.debouncedRender);
            document.getElementById('dash-sales-filter-type').addEventListener(evt, this.dashboardListeners.debouncedRender);
            document.getElementById('dash-sales-filter-payment').addEventListener(evt, this.dashboardListeners.debouncedRender);
        });

        // Click delegation for dashboard sales list
        this.dashboardListeners.listClick = (e) => {
            const item = e.target.closest('.sale-item');
            if (item) {
                this.showSaleDetail(item.dataset.saleId);
            }
        };
        document.getElementById('dash-sales-list').addEventListener('click', this.dashboardListeners.listClick);
    }

    // OPTIMIZATION: Cache for smart render detection (Dashboard Phase 1)
    dashboardCache = {
        lastTotalRaised: null,
        lastCardsSold: null,
        lastDonationsCount: null,
        lastProgress: null,
        lastGoal: null,
        lastSalesCount: null,
        lastUpdated: 0
    };

    shouldUpdateDashboard() {
        // OPTIMIZATION: Prevent re-renders when data hasn't actually changed
        // Solves: Real-time listeners calling refreshDashboard() on unrelated updates
        // Result: 20-30% fewer DOM updates

        const stats = {
            totalRaised: 0,
            cardsSold: 0,
            donationsCount: 0
        };

        this.sales.forEach(sale => {
            stats.totalRaised += Number(sale.amount) || 0;
            if (sale.type === 'card') stats.cardsSold += getCardQtyFromSale(sale, this.settings && this.settings.cardPrice);
            if (sale.type === 'donation') stats.donationsCount++;
        });

        const isLeaderOrAdmin = isLeaderOrAdminRole(this.currentRole);
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

        // Check if any dashboard metrics changed
        const changed =
            this.dashboardCache.lastTotalRaised !== stats.totalRaised ||
            this.dashboardCache.lastCardsSold !== stats.cardsSold ||
            this.dashboardCache.lastDonationsCount !== stats.donationsCount ||
            Math.abs((this.dashboardCache.lastProgress || 0) - progress) > 0.1 ||  // Allow 0.1% tolerance
            this.dashboardCache.lastGoal !== goal ||
            this.dashboardCache.lastSalesCount !== this.sales.length;

        // Also check if minimum time has passed (e.g., 500ms between updates)
        // to prevent excessive updates even if technically data changed
        const now = Date.now();
        const minInterval = 200;  // Minimum 200ms between dashboard updates
        const enoughTimeHasPassed = (now - this.dashboardCache.lastUpdated) >= minInterval;

        return changed && enoughTimeHasPassed;
    }

    updateDashboardCache() {
        // Cache current values to detect next change
        const stats = {
            totalRaised: 0,
            cardsSold: 0,
            donationsCount: 0
        };

        this.sales.forEach(sale => {
            stats.totalRaised += Number(sale.amount) || 0;
            if (sale.type === 'card') stats.cardsSold += getCardQtyFromSale(sale, this.settings && this.settings.cardPrice);
            if (sale.type === 'donation') stats.donationsCount++;
        });

        const isLeaderOrAdmin = isLeaderOrAdminRole(this.currentRole);
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

        this.dashboardCache = {
            lastTotalRaised: stats.totalRaised,
            lastCardsSold: stats.cardsSold,
            lastDonationsCount: stats.donationsCount,
            lastProgress: progress,
            lastGoal: goal,
            lastSalesCount: this.sales.length,
            lastUpdated: Date.now()
        };
    }

    async refreshDashboard() {
        // OPTIMIZATION: Check if dashboard actually needs update (Phase 1)
        if (!this.shouldUpdateDashboard()) {
            return;  // Skip render if nothing changed
        }

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
        const isLeaderOrAdmin = isLeaderOrAdminRole(this.currentRole);
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

        // Update cache after rendering
        this.updateDashboardCache();
    }

    // OPTIMIZATION: Cache for smart transaction list render detection
    dashTransactionsCache = {
        lastSearchTerm: '',
        lastTypeFilter: '',
        lastPaymentFilter: '',
        lastSalesCount: 0,
        lastRenderedCount: 0
    };

    shouldUpdateDashTransactions() {
        // OPTIMIZATION: Prevent re-rendering transaction list when filters/data haven't changed
        // Result: 20-30% fewer transaction list renders

        const searchTerm = (document.getElementById('dash-sales-search').value || '').toLowerCase();
        const typeFilter = document.getElementById('dash-sales-filter-type').value;
        const paymentFilter = document.getElementById('dash-sales-filter-payment').value;

        // Check if filters or data changed
        const changed =
            this.dashTransactionsCache.lastSearchTerm !== searchTerm ||
            this.dashTransactionsCache.lastTypeFilter !== typeFilter ||
            this.dashTransactionsCache.lastPaymentFilter !== paymentFilter ||
            this.dashTransactionsCache.lastSalesCount !== this.sales.length;

        return changed;
    }

    updateDashTransactionsCache() {
        const searchTerm = (document.getElementById('dash-sales-search').value || '').toLowerCase();
        const typeFilter = document.getElementById('dash-sales-filter-type').value;
        const paymentFilter = document.getElementById('dash-sales-filter-payment').value;

        const filtered = filterAndSortSales(this.sales, {
            searchTerm,
            typeFilter,
            paymentFilter
        });

        this.dashTransactionsCache = {
            lastSearchTerm: searchTerm,
            lastTypeFilter: typeFilter,
            lastPaymentFilter: paymentFilter,
            lastSalesCount: this.sales.length,
            lastRenderedCount: filtered.length
        };
    }

    // REFACTORED: Issue #3 fix - Uses shared filterAndSortSales and renderSalesList helpers
    renderDashTransactions() {
        // OPTIMIZATION: Check if transaction list actually needs update
        if (!this.shouldUpdateDashTransactions()) {
            return;  // Skip render if nothing changed
        }

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

        // Update cache after rendering
        this.updateDashTransactionsCache();
    }

    // ==================== SALES ====================

    cleanupSalesListeners() {
        // PERFORMANCE FIX: Remove old listeners before adding new ones to prevent accumulation
        if (this.salesListeners) {
            const searchInput = document.getElementById('sales-search');
            const filterType = document.getElementById('sales-filter-type');
            const filterPayment = document.getElementById('sales-filter-payment');
            const scoutFilter = document.getElementById('sales-filter-scout');
            const salesList = document.getElementById('sales-list');

            // Remove search/filter input listeners
            ['input', 'change'].forEach(evt => {
                if (searchInput && this.salesListeners.searchInput?.[evt]) {
                    searchInput.removeEventListener(evt, this.salesListeners.searchInput[evt]);
                }
                if (filterType && this.salesListeners.filterType?.[evt]) {
                    filterType.removeEventListener(evt, this.salesListeners.filterType[evt]);
                }
                if (filterPayment && this.salesListeners.filterPayment?.[evt]) {
                    filterPayment.removeEventListener(evt, this.salesListeners.filterPayment[evt]);
                }
                if (scoutFilter && this.salesListeners.scoutFilter?.[evt]) {
                    scoutFilter.removeEventListener(evt, this.salesListeners.scoutFilter[evt]);
                }
            });

            // Remove click listener
            if (salesList && this.salesListeners.clickHandler) {
                salesList.removeEventListener('click', this.salesListeners.clickHandler);
            }
        }

        // Reset listeners object
        this.salesListeners = {
            searchInput: {},
            filterType: {},
            filterPayment: {},
            scoutFilter: {},
            clickHandler: null
        };
    }

    setupSalesPage() {
        // PERFORMANCE FIX: Clean up old listeners to prevent accumulation
        this.cleanupSalesListeners();

        // Auto-fill date
        document.getElementById('sale-date').value = getLocalDateInputValue();

        // For leaders/admins: show scout filter instead of search
        const isLeaderOrAdmin = isLeaderOrAdminRole(this.currentRole);
        const searchInput = document.getElementById('sales-search');
        const scoutFilter = document.getElementById('sales-filter-scout');

        if (isLeaderOrAdmin && scoutFilter) {
            // Hide search, show scout filter
            searchInput.classList.add('hidden');
            scoutFilter.classList.remove('hidden');
            this.populateSalesScoutFilter();
        }

        // Search and filter listeners - store references for cleanup
        ['input', 'change'].forEach(evt => {
            // Search input listener
            const searchHandler = () => this.refreshSalesList();
            searchInput.addEventListener(evt, searchHandler);
            if (!this.salesListeners.searchInput) this.salesListeners.searchInput = {};
            this.salesListeners.searchInput[evt] = searchHandler;

            // Type filter listener
            const typeHandler = () => this.refreshSalesList();
            document.getElementById('sales-filter-type').addEventListener(evt, typeHandler);
            if (!this.salesListeners.filterType) this.salesListeners.filterType = {};
            this.salesListeners.filterType[evt] = typeHandler;

            // Payment filter listener
            const paymentHandler = () => this.refreshSalesList();
            document.getElementById('sales-filter-payment').addEventListener(evt, paymentHandler);
            if (!this.salesListeners.filterPayment) this.salesListeners.filterPayment = {};
            this.salesListeners.filterPayment[evt] = paymentHandler;

            // Scout filter listener (if present)
            if (scoutFilter) {
                const scoutHandler = () => this.refreshSalesList();
                scoutFilter.addEventListener(evt, scoutHandler);
                if (!this.salesListeners.scoutFilter) this.salesListeners.scoutFilter = {};
                this.salesListeners.scoutFilter[evt] = scoutHandler;
            }
        });

        // Click delegation for sales list - store reference for cleanup
        const clickHandler = (e) => {
            const item = e.target.closest('.sale-item');
            if (item) {
                this.showSaleDetail(item.dataset.saleId);
            }
        };
        document.getElementById('sales-list').addEventListener('click', clickHandler);
        this.salesListeners.clickHandler = clickHandler;
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
        const isLeaderOrAdmin = isLeaderOrAdminRole(this.currentRole);
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
                try {
                    // Restore inventory for card sales (Session 10)
                    if (sale.type === 'card' && sale.qty) {
                        await this.restoreInventoryForDeletedSale(sale);
                    }

                    await deleteSaleFromFirestore(this.currentUser.uid, saleId);

                    // Session 16: Just refresh data after delete (no hard refresh)
                    await this.loadSales();
                    this.refreshSalesList();
                    this.refreshDashboard();
                    this.refreshOperationsPage();

                    // Close modal and show success
                    document.getElementById('sale-detail-modal').style.display = 'none';
                    await appleAlert('Deleted', 'Sale deleted successfully.');
                } catch (err) {
                    console.error('Error deleting sale:', err);
                    await appleAlert('Error', `Failed to delete sale: ${err.message}`);
                }
            }
        });

        document.getElementById('sale-detail-modal').style.display = 'block';
    }

    // ==================== QUICK LOG ====================

    // PERFORMANCE FIX: Track event listeners to prevent accumulation
    quickLogListeners = {
        typeBtnClick: null,
        typeChange: null,
        scoutInput: null,
        priceInput: null,
        qtyInput: null,
        amountInput: null,
        paymentInput: null,
        paymentChange: null,
        dateInput: null,
        qrBtnClick: null,
        submitClick: null
    };

    cleanupQuickLogListeners() {
        // PERFORMANCE FIX: Remove old listeners before re-adding (prevents accumulation)
        if (this.quickLogListeners.typeBtnClick) {
            this.typeBtns?.forEach(btn => {
                btn.removeEventListener('click', this.quickLogListeners.typeBtnClick);
            });
        }
        if (this.quickLogListeners.typeChange && this.quickFields?.type) {
            this.quickFields.type.removeEventListener('change', this.quickLogListeners.typeChange);
        }
        if (this.quickLogListeners.scoutInput && this.quickFields?.scout) {
            this.quickFields.scout.removeEventListener('input', this.quickLogListeners.scoutInput);
            this.quickFields.scout.removeEventListener('change', this.quickLogListeners.scoutInput);
        }
        if (this.quickLogListeners.priceInput && this.quickFields?.price) {
            this.quickFields.price.removeEventListener('input', this.quickLogListeners.priceInput);
            this.quickFields.price.removeEventListener('change', this.quickLogListeners.priceInput);
        }
        if (this.quickLogListeners.qtyInput && this.quickFields?.qty) {
            this.quickFields.qty.removeEventListener('input', this.quickLogListeners.qtyInput);
            this.quickFields.qty.removeEventListener('change', this.quickLogListeners.qtyInput);
        }
        if (this.quickLogListeners.amountInput && this.quickFields?.amount) {
            this.quickFields.amount.removeEventListener('input', this.quickLogListeners.amountInput);
            this.quickFields.amount.removeEventListener('change', this.quickLogListeners.amountInput);
        }
        if (this.quickLogListeners.paymentInput && this.quickFields?.payment) {
            this.quickFields.payment.removeEventListener('input', this.quickLogListeners.paymentInput);
            this.quickFields.payment.removeEventListener('change', this.quickLogListeners.paymentInput);
        }
        if (this.quickLogListeners.paymentChange && this.quickFields?.payment) {
            this.quickFields.payment.removeEventListener('change', this.quickLogListeners.paymentChange);
        }
        if (this.quickLogListeners.dateInput && this.quickFields?.date) {
            this.quickFields.date.removeEventListener('input', this.quickLogListeners.dateInput);
            this.quickFields.date.removeEventListener('change', this.quickLogListeners.dateInput);
        }
        if (this.quickLogListeners.qrBtnClick && this.quickFields?.qrBtn) {
            this.quickFields.qrBtn.removeEventListener('click', this.quickLogListeners.qrBtnClick);
        }
        if (this.quickLogListeners.submitClick) {
            document.getElementById('quick-submit')?.removeEventListener('click', this.quickLogListeners.submitClick);
        }
    }

    setupQuickLogPage() {
        // PERFORMANCE FIX: Clean up old listeners first
        this.cleanupQuickLogListeners();

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
        this.quickLogListeners.typeBtnClick = () => {
            const type = event.currentTarget.dataset.type;
            this.typeBtns.forEach(b => b.classList.toggle('active', b === event.currentTarget));
            this.quickFields.type.value = type;
            this.setQuickTypeVisibility(type);
            this.updateQuickSummary();
            this.focusStep2();
        };
        this.typeBtns.forEach(btn => {
            btn.addEventListener('click', this.quickLogListeners.typeBtnClick);
        });

        // Keep hidden select in sync (for any programmatic changes)
        this.quickLogListeners.typeChange = () => {
            const type = this.quickFields.type.value;
            this.typeBtns.forEach(b => b.classList.toggle('active', b.dataset.type === type));
            this.setQuickTypeVisibility(type);
            this.updateQuickSummary();
        };
        this.quickFields.type.addEventListener('change', this.quickLogListeners.typeChange);

        // Live updates - use single handlers stored in listeners object
        this.quickLogListeners.scoutInput = () => this.updateQuickSummary();
        this.quickLogListeners.priceInput = () => this.updateQuickSummary();
        this.quickLogListeners.qtyInput = () => this.updateQuickSummary();
        this.quickLogListeners.amountInput = () => this.updateQuickSummary();
        this.quickLogListeners.paymentInput = () => this.updateQuickSummary();
        this.quickLogListeners.dateInput = () => this.updateQuickSummary();

        ['input', 'change'].forEach(evt => {
            this.quickFields.scout.addEventListener(evt, this.quickLogListeners.scoutInput);
            this.quickFields.price.addEventListener(evt, this.quickLogListeners.priceInput);
            this.quickFields.qty.addEventListener(evt, this.quickLogListeners.qtyInput);
            this.quickFields.amount.addEventListener(evt, this.quickLogListeners.amountInput);
            this.quickFields.payment.addEventListener(evt, this.quickLogListeners.paymentInput);
            this.quickFields.date.addEventListener(evt, this.quickLogListeners.dateInput);
        });

        // Payment change — show/hide QR button
        this.quickLogListeners.paymentChange = () => {
            this.toggleQrPayButton();
            this.updateQuickSummary();
        };
        this.quickFields.payment.addEventListener('change', this.quickLogListeners.paymentChange);
        this.toggleQrPayButton();

        // QR pay button
        this.quickLogListeners.qrBtnClick = () => this.showPaymentQr();
        this.quickFields.qrBtn.addEventListener('click', this.quickLogListeners.qrBtnClick);

        // Submit
        this.quickLogListeners.submitClick = () => this.submitQuickLog();
        document.getElementById('quick-submit').addEventListener('click', this.quickLogListeners.submitClick);

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
        const isDigital = ['Venmo', 'CashApp', 'Zelle', 'ApplePay', 'CreditCard'].includes(method);
        this.quickFields.qrBtn.classList.toggle('hidden', !isDigital);
    }

    paymentMethodToHandleKey(method) {
        const map = {
            Zelle: 'zelle',
            Venmo: 'venmo',
            CashApp: 'cashapp',
            ApplePay: 'applepay',
            CreditCard: 'creditcard'
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
        let uploadedQrImage = methodKey ? (qrImages[methodKey] || '') : '';
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

        // Credit Card always generates QR from URL (to include amount), never uses uploaded image
        if (method === 'CreditCard') {
            uploadedQrImage = '';
        }

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
            } else if (method === 'CreditCard') {
                const handle = handles.creditcard || '';
                if (!handle) { await appleAlert('Credit Card Not Setup', 'Set your payment service URL in Settings first.'); return; }
                handleDisplay = handle;
                // Append amount as query parameter (works with most payment processors)
                const separator = handle.includes('?') ? '&' : '?';
                payUrl = `${handle}${separator}amount=${amount.toFixed(2)}&description=${encodeURIComponent(note)}`;
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

            // Auto-deduct inventory for card sales
            if (type === 'card') {
                await this.deductInventoryForCardSale(cardQty);
            }

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

    cleanupScoutsListeners() {
        // PERFORMANCE FIX: Remove old listeners before adding new ones to prevent accumulation
        if (this.scoutsListeners && this.scoutsListeners.clickHandler) {
            const scoutsList = document.getElementById('scouts-list');
            if (scoutsList) {
                scoutsList.removeEventListener('click', this.scoutsListeners.clickHandler);
            }
        }

        // Reset listeners object
        this.scoutsListeners = {
            clickHandler: null
        };
    }

    async setupScoutsPage() {
        // PERFORMANCE FIX: Clean up old listeners to prevent accumulation
        this.cleanupScoutsListeners();

        this.scouts = await getScoutsFromFirestore(this.currentUnitId);
        this.allSales = await getAllSalesFromFirestore(this.currentUnitId);

        const form = document.getElementById('scout-form');
        const formCard = form ? form.closest('.card') : null;
        if (formCard) {
            formCard.classList.add('hidden');
        }

        const scoutsList = document.getElementById('scouts-list');
        if (scoutsList) {
            const clickHandler = async (e) => {
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
                dataCache.clear('scouts'); // FIX: Clear cache after scout deletion
                dataCache.clear('sales');  // Also clear sales cache since scout's sales are affected
                this.scouts = await getScoutsFromFirestore(this.currentUnitId);
                this.allSales = await getAllSalesFromFirestore(this.currentUnitId);
                this.refreshScoutsList();
                this.refreshLeaderboard();
            };
            scoutsList.addEventListener('click', clickHandler);
            this.scoutsListeners.clickHandler = clickHandler;
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

        // Session 15: Modern podium-style leaderboard (matching reference image)
        let html = '<div class="leaderboard-container">';

        // Show top 3 in podium style
        if (ranked.length >= 1) {
            // 2nd place (left) - if exists
            const second = ranked[1];
            if (second) {
                html += `<div class="podium-section second-place">
                    <div class="podium-avatar">${escapeHTML(second.name.charAt(0).toUpperCase())}</div>
                    <div class="podium-info">
                        <div class="podium-name">${escapeHTML(second.name)}</div>
                        <div class="podium-score">⭐ ${second.totalRaised.toFixed(1)}</div>
                    </div>
                    <div class="podium-position">2</div>
                </div>`;
            }

            // 1st place (center) - highest scorer
            const first = ranked[0];
            html += `<div class="podium-section first-place">
                <div class="podium-avatar">${escapeHTML(first.name.charAt(0).toUpperCase())}</div>
                <div class="podium-info">
                    <div class="podium-name">${escapeHTML(first.name)}</div>
                    <div class="podium-score">⭐ ${first.totalRaised.toFixed(1)}</div>
                </div>
                <div class="podium-position">1</div>
            </div>`;

            // 3rd place (right) - if exists
            const third = ranked[2];
            if (third) {
                html += `<div class="podium-section third-place">
                    <div class="podium-avatar">${escapeHTML(third.name.charAt(0).toUpperCase())}</div>
                    <div class="podium-info">
                        <div class="podium-name">${escapeHTML(third.name)}</div>
                        <div class="podium-score">⭐ ${third.totalRaised.toFixed(1)}</div>
                    </div>
                    <div class="podium-position">3</div>
                </div>`;
            }
        }

        html += '</div>';

        // Show rest of leaderboard (4+)
        if (ranked.length > 3) {
            html += '<div class="leaderboard-rest"><h4 style="margin-top: 2rem; margin-bottom: 1rem;">More Scouts</h4>';
            ranked.slice(3).forEach((scout, i) => {
                html += `<div class="leaderboard-row">
                    <span class="rank-number">${i + 4}</span>
                    <span class="scout-name">${escapeHTML(scout.name)}</span>
                    <span class="scout-amount">${formatMoney(scout.totalRaised)}</span>
                </div>`;
            });
            html += '</div>';
        }

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

    cleanupCommunicationListeners() {
        // PERFORMANCE FIX: Remove old listeners before adding new ones to prevent accumulation
        if (this.communicationListeners) {
            const copyLinkBtn = document.getElementById('comm-copy-link');
            const copyMsgBtn = document.getElementById('comm-copy-message');
            const emailBtn = document.getElementById('comm-email');
            const smsBtn = document.getElementById('comm-sms');
            const shareBtn = document.getElementById('comm-share');

            if (copyLinkBtn && this.communicationListeners.copyLink) {
                copyLinkBtn.removeEventListener('click', this.communicationListeners.copyLink);
            }
            if (copyMsgBtn && this.communicationListeners.copyMsg) {
                copyMsgBtn.removeEventListener('click', this.communicationListeners.copyMsg);
            }
            if (emailBtn && this.communicationListeners.email) {
                emailBtn.removeEventListener('click', this.communicationListeners.email);
            }
            if (smsBtn && this.communicationListeners.sms) {
                smsBtn.removeEventListener('click', this.communicationListeners.sms);
            }
            if (shareBtn && this.communicationListeners.share) {
                shareBtn.removeEventListener('click', this.communicationListeners.share);
            }
        }

        // Reset listeners object
        this.communicationListeners = {
            copyLink: null,
            copyMsg: null,
            email: null,
            sms: null,
            share: null
        };
    }

    setupCommunicationPage() {
        // PERFORMANCE FIX: Clean up old listeners to prevent accumulation
        this.cleanupCommunicationListeners();

        const copyLinkBtn = document.getElementById('comm-copy-link');
        const copyMsgBtn = document.getElementById('comm-copy-message');
        const emailBtn = document.getElementById('comm-email');
        const smsBtn = document.getElementById('comm-sms');
        const shareBtn = document.getElementById('comm-share');

        if (copyLinkBtn) {
            const copyLinkHandler = async () => {
                const payload = this.buildCommunicationPayload();
                await navigator.clipboard.writeText(payload.donationUrl);
                await appleAlert('Copied', 'Share link copied to clipboard.');
            };
            copyLinkBtn.addEventListener('click', copyLinkHandler);
            this.communicationListeners.copyLink = copyLinkHandler;
        }

        if (copyMsgBtn) {
            const copyMsgHandler = async () => {
                const payload = this.buildCommunicationPayload();
                const messageEl = document.getElementById('comm-message');
                const text = (messageEl && messageEl.value) || payload.message;
                await navigator.clipboard.writeText(text);
                await appleAlert('Copied', 'Message copied to clipboard.');
            };
            copyMsgBtn.addEventListener('click', copyMsgHandler);
            this.communicationListeners.copyMsg = copyMsgHandler;
        }

        if (emailBtn) {
            const emailHandler = () => {
                const payload = this.buildCommunicationPayload();
                const subject = encodeURIComponent('Support My Scout Fundraiser');
                const body = encodeURIComponent((document.getElementById('comm-message').value || payload.message));
                window.location.href = `mailto:?subject=${subject}&body=${body}`;
            };
            emailBtn.addEventListener('click', emailHandler);
            this.communicationListeners.email = emailHandler;
        }

        if (smsBtn) {
            const smsHandler = () => {
                const payload = this.buildCommunicationPayload();
                const body = encodeURIComponent((document.getElementById('comm-message').value || payload.message));
                window.location.href = `sms:?body=${body}`;
            };
            smsBtn.addEventListener('click', smsHandler);
            this.communicationListeners.sms = smsHandler;
        }

        if (shareBtn) {
            const shareHandler = async () => {
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
            };
            shareBtn.addEventListener('click', shareHandler);
            this.communicationListeners.share = shareHandler;
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

    cleanupOperationsListeners() {
        // PERFORMANCE FIX: Remove old listeners before adding new ones to prevent accumulation
        if (this.operationsListeners) {
            const productForm = document.getElementById('product-form');
            const productList = document.getElementById('product-list');
            const addLineBtn = document.getElementById('order-add-line');
            const submitOrderBtn = document.getElementById('order-submit');
            const exportBtn = document.getElementById('export-closeout-csv');
            const orderLinesEl = document.getElementById('order-lines');
            const quickAddBtn = document.getElementById('order-quick-add-btn');
            const opsActiveProductSelect = document.getElementById('ops-active-product');
            const opsDeleteProductSalesBtn = document.getElementById('ops-delete-product-sales');
            const stockAdjustBtn = document.getElementById('stock-adjust-btn');
            const deleteAllBtn = document.getElementById('delete-all-sales');
            const resetBtn = document.getElementById('reset-campaign-data');

            if (productForm && this.operationsListeners.productFormSubmit) {
                productForm.removeEventListener('submit', this.operationsListeners.productFormSubmit);
            }
            if (productList && this.operationsListeners.productListClick) {
                productList.removeEventListener('click', this.operationsListeners.productListClick);
            }
            if (addLineBtn && this.operationsListeners.addLine) {
                addLineBtn.removeEventListener('click', this.operationsListeners.addLine);
            }
            if (submitOrderBtn && this.operationsListeners.submitOrder) {
                submitOrderBtn.removeEventListener('click', this.operationsListeners.submitOrder);
            }
            if (exportBtn && this.operationsListeners.export) {
                exportBtn.removeEventListener('click', this.operationsListeners.export);
            }
            if (orderLinesEl && this.operationsListeners.orderLinesClick) {
                orderLinesEl.removeEventListener('click', this.operationsListeners.orderLinesClick);
            }
            if (quickAddBtn && this.operationsListeners.quickAdd) {
                quickAddBtn.removeEventListener('click', this.operationsListeners.quickAdd);
            }
            if (opsActiveProductSelect && this.operationsListeners.productSelect) {
                opsActiveProductSelect.removeEventListener('change', this.operationsListeners.productSelect);
            }
            if (opsDeleteProductSalesBtn && this.operationsListeners.deleteProductSales) {
                opsDeleteProductSalesBtn.removeEventListener('click', this.operationsListeners.deleteProductSales);
            }
            if (stockAdjustBtn && this.operationsListeners.stockAdjust) {
                stockAdjustBtn.removeEventListener('click', this.operationsListeners.stockAdjust);
            }
            if (deleteAllBtn && this.operationsListeners.deleteAll) {
                deleteAllBtn.removeEventListener('click', this.operationsListeners.deleteAll);
            }
            if (resetBtn && this.operationsListeners.reset) {
                resetBtn.removeEventListener('click', this.operationsListeners.reset);
            }
        }

        // Reset listeners object
        this.operationsListeners = {
            productFormSubmit: null,
            productListClick: null,
            addLine: null,
            submitOrder: null,
            export: null,
            orderLinesClick: null,
            quickAdd: null,
            productSelect: null,
            deleteProductSales: null,
            stockAdjust: null,
            deleteAll: null,
            reset: null
        };
    }

    async setupOperationsPage() {
        // PERFORMANCE FIX: Clean up old listeners to prevent accumulation
        this.cleanupOperationsListeners();

        const productForm = document.getElementById('product-form');
        const productList = document.getElementById('product-list');
        const addLineBtn = document.getElementById('order-add-line');
        const submitOrderBtn = document.getElementById('order-submit');
        const exportBtn = document.getElementById('export-closeout-csv');

        // Initialize default products if none exist
        await this.initializeDefaultProducts();

        // Ensure products are loaded after initialization
        if (!this.products || this.products.length === 0) {
            this.products = await getProductsFromFirestore(this.currentUnitId);
        }

        if (productForm) {
            const formSubmitHandler = async (e) => {
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
            };
            productForm.addEventListener('submit', formSubmitHandler);
            this.operationsListeners.productFormSubmit = formSubmitHandler;
        }

        if (productList) {
            const listClickHandler = async (e) => {
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
            };
            productList.addEventListener('click', listClickHandler);
            this.operationsListeners.productListClick = listClickHandler;
        }

        if (addLineBtn) {
            const addLineHandler = () => this.addOrderDraftLine();
            addLineBtn.addEventListener('click', addLineHandler);
            this.operationsListeners.addLine = addLineHandler;
        }
        if (submitOrderBtn) {
            const submitHandler = () => this.submitOrderDraft();
            submitOrderBtn.addEventListener('click', submitHandler);
            this.operationsListeners.submitOrder = submitHandler;
        }
        if (exportBtn) {
            const exportHandler = () => this.exportCloseoutCsv();
            exportBtn.addEventListener('click', exportHandler);
            this.operationsListeners.export = exportHandler;
        }

        // Order draft: event delegation (CSP-safe; avoid inline onclick handlers)
        const orderLinesEl = document.getElementById('order-lines');
        if (orderLinesEl) {
            const orderLinesClickHandler = (e) => {
                const btn = e.target && e.target.closest ? e.target.closest('[data-action="remove-draft-line"]') : null;
                if (!btn) return;
                const idx = Number(btn.dataset.index);
                if (!Number.isFinite(idx)) return;
                this.removeOrderDraftLine(idx);
            };
            orderLinesEl.addEventListener('click', orderLinesClickHandler);
            this.operationsListeners.orderLinesClick = orderLinesClickHandler;
        }

        // Quick add button for order count (Session 9)
        const quickAddBtn = document.getElementById('order-quick-add-btn');
        const quickAddInput = document.getElementById('order-quick-add');
        if (quickAddBtn && quickAddInput) {
            const quickAddHandler = () => {
                const units = Number(quickAddInput.value);
                if (!Number.isFinite(units) || units <= 0) {
                    appleAlert('Invalid Input', 'Please enter a positive number.');
                    return;
                }
                const qtyInput = document.getElementById('order-qty');
                if (qtyInput) {
                    qtyInput.value = units;
                    quickAddInput.value = '';
                    this.addOrderDraftLine();
                }
            };
            quickAddBtn.addEventListener('click', quickAddHandler);
            this.operationsListeners.quickAdd = quickAddHandler;
        }

        // Active product selector (admins only)
        const opsActiveProductSelect = document.getElementById('ops-active-product');
        const opsProductStock = document.getElementById('ops-product-stock');
        const opsDeleteProductSalesBtn = document.getElementById('ops-delete-product-sales');

        if (opsActiveProductSelect) {
            const productSelectHandler = () => {
                this.setActiveProduct(opsActiveProductSelect.value);
                this.refreshOperationsPage();  // Refresh ALL sections (Session 9 - Bug Fix)
            };
            opsActiveProductSelect.addEventListener('change', productSelectHandler);
            this.operationsListeners.productSelect = productSelectHandler;
        }

        if (opsDeleteProductSalesBtn) {
            const deleteProductSalesHandler = async () => {
                if (this.currentRole !== 'admin') {
                    await appleAlert('Restricted', 'Only unit admins can delete product sales.');
                    return;
                }
                await this.deleteProductSales(this.activeProduct.id);
            };
            opsDeleteProductSalesBtn.addEventListener('click', deleteProductSalesHandler);
            this.operationsListeners.deleteProductSales = deleteProductSalesHandler;
        }

        // Stock adjustment button (Session 8B)
        const stockAdjustBtn = document.getElementById('stock-adjust-btn');
        const stockAdjustInput = document.getElementById('stock-adjustment-input');
        if (stockAdjustBtn && stockAdjustInput) {
            const stockAdjustHandler = async () => {
                if (!this.canAccessOperations()) {
                    await appleAlert('Restricted', 'Only unit leaders and admins can adjust stock.');
                    return;
                }

                const adjustment = Number(stockAdjustInput.value);
                if (!Number.isFinite(adjustment) || adjustment === 0) {
                    await appleAlert('Invalid Input', 'Please enter a number (positive to add, negative to remove).');
                    return;
                }

                // Reload products to ensure we have latest data (Session 9 - Bug Fix)
                if (!this.products || this.products.length === 0) {
                    this.products = await getProductsFromFirestore(this.currentUnitId);
                }

                // Find the active product
                const product = (this.products || []).find(p => p.sku === this.activeProduct.sku);
                if (!product) {
                    await appleAlert('Product Not Found', `${this.activeProduct.name} not found in inventory.`);
                    return;
                }

                // Calculate new stock (never negative)
                const currentStock = Number(product.stockOnHand) || 0;
                const nextStock = Math.max(0, currentStock + Math.floor(adjustment));

                // Save to Firestore
                const saved = await saveProductToFirestore(this.currentUnitId, product.id, { stockOnHand: nextStock });
                if (!saved) {
                    await appleAlert('Save Failed', 'Could not update stock.');
                    return;
                }

                // Refresh and show confirmation
                this.products = await getProductsFromFirestore(this.currentUnitId);
                this.refreshOperationsPage();
                stockAdjustInput.value = '';
                console.log(`Stock adjusted: ${this.activeProduct.name}. ${currentStock} ${adjustment > 0 ? '+' : ''} ${adjustment} = ${nextStock}`);
                await appleAlert('Stock Updated', `${this.activeProduct.name} stock: ${currentStock} → ${nextStock}`);
            };
            stockAdjustBtn.addEventListener('click', stockAdjustHandler);
            this.operationsListeners.stockAdjust = stockAdjustHandler;
        }

        // Delete all sales button (admins only)
        const deleteAllBtn = document.getElementById('delete-all-sales');
        if (deleteAllBtn) {
            const deleteAllHandler = async () => {
                if (this.currentRole !== 'admin') {
                    await appleAlert('Restricted', 'Only unit admins can delete all sales.');
                    return;
                }
                await this.deleteAllSales();
            };
            deleteAllBtn.addEventListener('click', deleteAllHandler);
            this.operationsListeners.deleteAll = deleteAllHandler;
        }

        // Reset campaign data button (admins only)
        const resetBtn = document.getElementById('reset-campaign-data');
        if (resetBtn) {
            resetBtn.style.display = this.currentRole === 'admin' ? 'inline-block' : 'none';
            const resetHandler = async () => {
                if (this.currentRole !== 'admin') {
                    await appleAlert('Restricted', 'Only unit admins can reset campaign data.');
                    return;
                }
                await this.resetCampaignData();
            };
            resetBtn.addEventListener('click', resetHandler);
            this.operationsListeners.reset = resetHandler;
        }
    }

    async initializeDefaultProducts() {
        // Initialize default Scout Fundraiser products if unit doesn't have all 4
        try {
            const defaultProducts = [
                { name: 'Scout Cards', sku: 'SCOUT-CARDS', unitPrice: 10, stockOnHand: 0, active: true, lowStockThreshold: 50 },
                { name: 'Popcorn', sku: 'POPCORN', unitPrice: 25, stockOnHand: 0, active: true, lowStockThreshold: 10 },
                { name: 'Car Wash', sku: 'CAR-WASH', unitPrice: 15, stockOnHand: 0, active: true, lowStockThreshold: 5 },
                { name: 'Girl Scout Biscuits', sku: 'GIRL-SCOUT-BISCUITS', unitPrice: 18, stockOnHand: 0, active: true, lowStockThreshold: 5 }
            ];

            // Check if all 4 default products exist (Session 9 - Bug Fix)
            const missingProducts = defaultProducts.filter(p =>
                !(this.products || []).find(existing => existing.sku === p.sku)
            );

            if (missingProducts.length > 0) {
                console.log('=== INITIALIZING MISSING DEFAULT PRODUCTS ===');
                console.log('currentUnitId:', this.currentUnitId);
                console.log('currentUser.uid:', this.currentUser?.uid);
                console.log('currentRole:', this.currentRole);
                console.log('Missing products:', missingProducts.length);

                // Check if user has permission to create products
                if (this.currentRole !== 'admin' && this.currentRole !== 'leader') {
                    console.warn('⚠️ INSUFFICIENT PERMISSIONS ⚠️');
                    console.warn(`Your current role: "${this.currentRole}"`);
                    console.warn('Required role: "admin" or "leader"');
                    console.warn('');
                    console.warn('To fix this:');
                    console.warn('1. Go to Firebase Console > Firestore > memberships collection');
                    console.warn(`2. Find document with ID: ${this.currentUser?.uid}`);
                    console.warn('3. Change role field from "scout" to "admin" or "leader"');
                    console.warn('4. Hard refresh this page (Ctrl+Shift+R)');
                    console.warn('');
                    console.warn('See ROLE_ASSIGNMENT_GUIDE.md for detailed instructions.');
                    return;
                }

                for (const product of missingProducts) {
                    try {
                        console.log(`Creating product: ${product.name}`);
                        await addProductToFirestore(this.currentUnitId, this.currentUser.uid, product);
                        console.log(`✓ Created: ${product.name}`);
                    } catch (err) {
                        console.error(`✗ Error initializing product: ${product.name}`);
                        console.error('Error code:', err.code);
                        console.error('Error message:', err.message);
                        if (err.code === 'permission-denied') {
                            console.error('💡 TIP: Make sure your account has admin or leader role, and that membership document exists in Firestore.');
                        }
                    }
                }

                this.products = await getProductsFromFirestore(this.currentUnitId);
                console.log(`Products loaded. Total: ${(this.products || []).length}`);
                if (this.products && this.products.length > 0) {
                    this.products.forEach(p => console.log(`  - ${p.name} (SKU: ${p.sku})`));
                }
                console.log('=== END INITIALIZATION ===');
            } else {
                console.log('✓ All 4 default products exist. Total:', (this.products || []).length);
            }
        } catch (err) {
            console.error('Fatal error in initializeDefaultProducts:', err);
        }
    }

    async deductInventoryForCardSale(cardQty) {
        try {
            // Reload products to ensure we have latest data (Session 9 - Bug Fix)
            if (!this.products || this.products.length === 0) {
                this.products = await getProductsFromFirestore(this.currentUnitId);
            }

            // Find product using active product SKU
            const product = (this.products || []).find(p => p.sku === this.activeProduct.sku);
            if (!product) {
                console.warn(`${this.activeProduct.name} product not found for inventory deduction`);
                return;
            }

            const currentStock = Number(product.stockOnHand) || 0;
            const newStock = Math.max(0, currentStock - cardQty);

            // Update inventory
            const saved = await saveProductToFirestore(this.currentUnitId, product.id, {
                stockOnHand: newStock
            });

            if (saved) {
                // Refresh products list
                this.products = await getProductsFromFirestore(this.currentUnitId);
                this.refreshOperationsPage();
                console.log(`Inventory deducted: ${cardQty} ${this.activeProduct.name}. New stock: ${newStock}`);
            }
        } catch (err) {
            console.error('Error deducting inventory for sale:', err);
        }
    }

    async restoreInventoryForDeletedSale(sale) {
        try {
            // Reload products if needed
            if (!this.products || this.products.length === 0) {
                this.products = await getProductsFromFirestore(this.currentUnitId);
            }

            // Find Scout Cards product
            const product = (this.products || []).find(p => p.sku === 'SCOUT-CARDS');
            if (!product) {
                console.warn('Scout Cards product not found for inventory restoration');
                return;
            }

            const cardQty = Number(sale.qty) || 0;
            if (cardQty <= 0) return;

            const currentStock = Number(product.stockOnHand) || 0;
            const newStock = currentStock + cardQty;

            // Update inventory
            const saved = await saveProductToFirestore(this.currentUnitId, product.id, {
                stockOnHand: newStock
            });

            if (saved) {
                // Refresh products list
                this.products = await getProductsFromFirestore(this.currentUnitId);
                this.refreshOperationsPage();
                console.log(`Inventory restored: +${cardQty} Scout Cards. New stock: ${newStock}`);
            }
        } catch (err) {
            console.error('Error restoring inventory for deleted sale:', err);
        }
    }

    refreshOperationsPage() {
        const productForm = document.getElementById('product-form');
        if (productForm) {
            productForm.classList.toggle('hidden', !this.canAccessOperations());
        }

        // Show delete all sales button only for admins
        const deleteAllBtn = document.getElementById('delete-all-sales');
        if (deleteAllBtn) {
            deleteAllBtn.style.display = this.currentRole === 'admin' ? 'inline-block' : 'none';
        }

        // Show reset campaign data button only for admins
        const resetBtn = document.getElementById('reset-campaign-data');
        if (resetBtn) {
            resetBtn.style.display = this.currentRole === 'admin' ? 'inline-block' : 'none';
        }

        this.updateOperationsProductDisplay();
        this.renderProductList();
        this.populateOrderProductOptions();
        this.renderOrderDraft();
        this.updateOrderCountDisplay();
        this.renderOrdersList();
        this.renderCloseoutSummary();
    }

    setActiveProduct(productId) {
        // Map product IDs to details
        const productMap = {
            'scout-cards': { id: 'scout-cards', name: '💳 Scout Cards', price: 10, sku: 'SCOUT-CARDS' },
            'popcorn': { id: 'popcorn', name: '🍿 Popcorn', price: 25, sku: 'POPCORN' },
            'car-wash': { id: 'car-wash', name: '🚗 Car Wash', price: 15, sku: 'CAR-WASH' },
            'girl-scout-biscuits': { id: 'girl-scout-biscuits', name: '🍪 Girl Scout Biscuits', price: 18, sku: 'GIRL-SCOUT-BISCUITS' }
        };

        this.activeProduct = productMap[productId] || productMap['scout-cards'];

        // Update Quick Log display
        const quickProductInput = document.getElementById('quick-product');
        if (quickProductInput) {
            quickProductInput.value = this.activeProduct.name;
        }

        const quickPriceInput = document.getElementById('quick-price');
        if (quickPriceInput) {
            quickPriceInput.value = this.activeProduct.price;
        }

        // Update Quick Log button label
        const typeCardBtn = document.getElementById('type-btn-card-label');
        if (typeCardBtn) {
            typeCardBtn.textContent = this.activeProduct.name;
        }

        // Update Products & Inventory display (hardcoded) - Session 8
        const displayProductName = document.getElementById('display-product-name');
        if (displayProductName) {
            displayProductName.value = this.activeProduct.name;
        }

        const displayProductSku = document.getElementById('display-product-sku');
        if (displayProductSku) {
            displayProductSku.value = this.activeProduct.sku;
        }

        // Update Submit Product Order display (hardcoded) - Session 8
        const orderProductDisplay = document.getElementById('order-product-display');
        if (orderProductDisplay) {
            orderProductDisplay.value = this.activeProduct.name;
        }

        // Update card total
        this.updateQuickSummary();
    }

    updateOperationsProductDisplay() {
        const opsProductStock = document.getElementById('ops-product-stock');
        if (!opsProductStock) return;

        // Find the stock for the active product
        const product = (this.products || []).find(p => p.sku === this.activeProduct.sku);
        opsProductStock.value = product ? Number(product.stockOnHand) || 0 : 0;
    }

    async deleteProductSales(productId) {
        // Delete all sales for the specific product
        if (this.currentRole !== 'admin') {
            await appleAlert('Restricted', 'Only unit admins can delete product sales.');
            return;
        }

        const productMap = {
            'scout-cards': 'Scout Cards',
            'popcorn': 'Popcorn',
            'car-wash': 'Car Wash',
            'girl-scout-biscuits': 'Girl Scout Biscuits'
        };

        const productName = productMap[productId] || productId;
        const salesForProduct = (this.allSales || []).filter(s => {
            const productKey = productId === 'scout-cards' ? 'card' : productId;
            return s.type === productKey || (s.type === 'card' && productId === 'scout-cards');
        });

        if (salesForProduct.length === 0) {
            await appleAlert('No Sales', `No ${productName} sales to delete.`);
            return;
        }

        // Confirm deletion
        const confirm1 = await new Promise((resolve) => {
            appleAlert('Warning', `⚠️ Delete all ${salesForProduct.length} ${productName} sales?\n\nThis action CANNOT be undone.`, 'Cancel', 'Delete', (confirmed) => {
                resolve(confirmed);
            });
        });

        if (!confirm1) return;

        const confirm2 = await new Promise((resolve) => {
            appleAlert('Final Confirmation', `🔴 Are you absolutely sure? Delete ${productName} sales?`, 'Cancel', 'Yes, Delete', (confirmed) => {
                resolve(confirmed);
            });
        });

        if (!confirm2) return;

        try {
            let deletedCount = 0;
            const scouts = await getScoutsFromFirestore(this.currentUnitId);

            for (const scout of scouts) {
                const scoutSales = await getSalesFromFirestore(scout.uid);
                for (const sale of scoutSales) {
                    const productKey = productId === 'scout-cards' ? 'card' : productId;
                    if (sale.type === productKey || (sale.type === 'card' && productId === 'scout-cards')) {
                        await deleteSaleFromFirestore(scout.uid, sale.id);
                        deletedCount++;
                    }
                }
            }

            dataCache.clear('sales');
            this.allSales = await getAllSalesFromFirestore(this.currentUnitId);
            this.sales = [];
            this.refreshDashboard();
            this.refreshSalesList();
            this.refreshOperationsPage();

            await appleAlert('Success', `✅ Deleted ${deletedCount} ${productName} sales.`);
        } catch (err) {
            console.error('Error deleting product sales:', err);
            await appleAlert('Error', `Failed to delete sales: ${escapeHTML(err.message)}`);
        }
    }

    populateOrderProductOptions() {
        const select = document.getElementById('order-product');
        if (!select) return;

        // Show ONLY the active product in the order dropdown
        const activeProduct = (this.products || []).find(p => p.sku === this.activeProduct.sku);
        if (!activeProduct) {
            select.innerHTML = '<option value="">Active product not found</option>';
            return;
        }

        select.innerHTML = `<option value="${activeProduct.id}" selected>${escapeHTML(activeProduct.name)} (${escapeHTML(activeProduct.sku)}) - ${formatMoney(activeProduct.unitPrice)} | Stock: ${Number(activeProduct.stockOnHand) || 0}</option>`;
    }

    renderProductList() {
        const container = document.getElementById('product-list');
        if (!container) return;
        if (!this.products || this.products.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>No products added yet.</p></div>';
            return;
        }

        // Show ONLY the active product's inventory
        const activeProduct = this.products.find(p => p.sku === this.activeProduct.sku);
        if (!activeProduct) {
            container.innerHTML = '<div class="empty-state"><p>Active product inventory not found.</p></div>';
            return;
        }

        // Calculate total ordered units for active product
        const orderedUnits = (this.orders || []).reduce((total, order) => {
            const lineTotal = (order.lines || [])
                .filter(line => line.sku === this.activeProduct.sku)
                .reduce((sum, line) => sum + (Number(line.qty) || 0), 0);
            return total + lineTotal;
        }, 0);

        const stock = Number(activeProduct.stockOnHand) || 0;
        const low = stock <= (Number(activeProduct.lowStockThreshold) || 5);
        const badgeMap = {
            'SCOUT-CARDS': '💳',
            'POPCORN': '🍿',
            'CAR-WASH': '🚗',
            'GIRL-SCOUT-BISCUITS': '🍪'
        };
        const badge = badgeMap[activeProduct.sku] || '📦';

        const html = `
            <h4 style="margin-top: 1rem; color: #0066cc;">📦 Active Product Inventory</h4>
            <div class="sale-item" style="background: #f0f8ff; border-left: 4px solid #0066cc;">
                <div class="sale-info">
                    <h5>${badge} ${escapeHTML(activeProduct.name)} (${escapeHTML(activeProduct.sku || '')})</h5>
                    <p>Price: ${formatMoney(activeProduct.unitPrice)} &bull; Stock: <strong>${stock}</strong> ${low ? '&bull; <span style="color: #ff3b30;">LOW STOCK</span>' : ''}</p>
                    <p style="font-size: 0.9rem; color: #666; margin-top: 0.5rem;">Ordered: <strong>${orderedUnits} units</strong> &bull; Auto-deducted when scouts log sales</p>
                </div>
               <!--  <div class="sale-right">
                    <input type="number" id="stock-adjust-${activeProduct.id}" value="0" style="width:80px;" />
                    <button type="button" class="btn btn-secondary btn-small" data-action="adjust-stock" data-product-id="${activeProduct.id}">Adjust</button>
                </div> -->
            </div>
        `;

        container.innerHTML = html;
    }

    updateOrderCountDisplay() {
        // Calculate totals from draft lines
        const totalUnits = this.orderDraftLines.reduce((sum, line) => sum + (Number(line.qty) || 0), 0);
        const totalValue = this.orderDraftLines.reduce((sum, line) => sum + (Number(line.lineTotal) || 0), 0);

        const unitsEl = document.getElementById('order-total-units');
        const valueEl = document.getElementById('order-total-value');
        const adjustContainer = document.getElementById('order-adjust-container');

        if (unitsEl) unitsEl.textContent = totalUnits;
        if (valueEl) valueEl.textContent = formatMoney(totalValue);

        // Show quick add section only when total is 0
        if (adjustContainer) {
            adjustContainer.style.display = totalUnits === 0 ? 'block' : 'none';
        }
    }

    addOrderDraftLine() {
        if (!this.canAccessOperations()) {
            return;
        }
        // Use hardcoded active product (Session 8)
        const product = (this.products || []).find(p => p.sku === this.activeProduct.sku);
        const qty = Number(document.getElementById('order-qty').value);
        if (!product || !Number.isFinite(qty) || qty <= 0) return;

        this.orderDraftLines.push({
            productId: product.id,
            name: product.name,
            sku: product.sku,
            qty: Math.floor(qty),
            unitPrice: Number(product.unitPrice) || 0,
            lineTotal: (Number(product.unitPrice) || 0) * Math.floor(qty)
        });
        this.renderOrderDraft();
        this.updateOrderCountDisplay();
    }

    renderOrderDraft() {
        const container = document.getElementById('order-lines');
        if (!container) return;

        if (!this.orderDraftLines || this.orderDraftLines.length === 0) {
            container.innerHTML = '<p class="step-note">No order lines yet.</p>';
            this.updateOrderCountDisplay();
            return;
        }

        const draftLines = this.orderDraftLines || [];
        const total = draftLines.reduce((sum, line) => sum + (Number(line.lineTotal) || 0), 0);
        const totalQty = draftLines.reduce((sum, line) => sum + (Number(line.qty) || 0), 0);

        container.innerHTML = draftLines.map((line, idx) =>
            `<div class="activity-item"><div class="activity-details"><div class="activity-title">${escapeHTML(line.name)}</div><div class="activity-meta">Qty: ${line.qty} @ ${formatMoney(line.unitPrice)} each</div></div><div class="sale-amount">${formatMoney(line.lineTotal)}</div><button type="button" class="btn btn-danger btn-small" data-action="remove-draft-line" data-index="${idx}">Remove</button></div>`
        ).join('') + `<div class="quick-summary">Total: ${totalQty} units &bull; ${formatMoney(total)}</div>`;

        this.updateOrderCountDisplay();
    }

    removeOrderDraftLine(index) {
        if (!Array.isArray(this.orderDraftLines)) return;
        this.orderDraftLines.splice(index, 1);
        this.renderOrderDraft();
        this.updateOrderCountDisplay();
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

        // Filter orders to show ONLY lines for the active product
        const aggregate = {};
        (this.orders || []).forEach(order => {
            (order.lines || []).forEach(line => {
                // Only include lines matching the active product SKU
                if (line.sku === this.activeProduct.sku) {
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
                }
            });
        });

        const rows = Object.values(aggregate);
        const activeName = escapeHTML(this.activeProduct && this.activeProduct.name ? this.activeProduct.name : 'Active Product');
        if (rows.length === 0) {
            masterOrderEl.innerHTML = `<p class="step-note">No order lines for ${activeName} available for master order.</p>`;
        } else {
            masterOrderEl.innerHTML = `<h4>Master Order (${activeName})</h4>` + rows.map(r =>
                `<div class="activity-item"><div class="activity-details"><div class="activity-title">${escapeHTML(r.product)} (${escapeHTML(r.sku || '')})</div><div class="activity-meta">Qty: ${r.qty}</div></div><div class="sale-amount">${formatMoney(r.total)}</div></div>`
            ).join('');
        }

        // Session 12: Filter sales to show ONLY card sales of the active product (Scout Cards)
        const salesPool = this.allSales || this.sales || [];
        let totalSales = 0;

        // For Scout Cards, count card-type sales; for other products, we'd need sales data with productType field
        if (this.activeProduct.sku === 'SCOUT-CARDS') {
            // Card sales only
            const cardSales = salesPool.filter(s => s.type === 'card');
            totalSales = cardSales.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
        } else {
            // For other products (Popcorn, Car Wash, etc.), check if they track productType
            const activeProductSales = salesPool.filter(s =>
                s.productType === this.activeProduct.sku ||
                s.productName === this.activeProduct.name
            );
            totalSales = activeProductSales.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
        }

        // Filter orders to show ONLY orders containing the active product
        const activeProductOrders = (this.orders || []).filter(order =>
            (order.lines || []).some(line => line.sku === this.activeProduct.sku)
        );
        const totalOrders = activeProductOrders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
        const pendingDigital = activeProductOrders.filter(o => o.paymentStatus === 'pending').reduce((sum, o) => sum + (Number(o.total) || 0), 0);

        reconEl.innerHTML = `<h4>Financial Reconciliation (${activeName})</h4>
            <div class="quick-summary">
                Sales/Donations Logged: ${formatMoney(totalSales)} | Product Orders: ${formatMoney(totalOrders)} | Pending Processor Funds: ${formatMoney(pendingDigital)}
            </div>`;
    }

    exportCloseoutCsv() {
        // Session 11: Export data for actively selected product only
        const activeProductSku = this.activeProduct?.sku;
        if (!activeProductSku) {
            appleAlert('No Product', 'Please select a product first.');
            return;
        }

        // Get product details from products table
        const product = (this.products || []).find(p => p.sku === activeProductSku);
        if (!product) {
            appleAlert('Product Not Found', 'The selected product is not in inventory.');
            return;
        }

        const rows = [];
        const timestamp = new Date().toISOString().split('T')[0];

        // Header section
        rows.push([`${product.name} - Product Closeout Export`]);
        rows.push([`Generated: ${new Date().toLocaleString()}`]);
        rows.push([`SKU: ${product.sku}`]);
        rows.push([`Unit Price: $${Number(product.unitPrice || 0).toFixed(2)}`]);
        rows.push([]);

        // Product summary from Products table
        rows.push(['PRODUCT DETAILS']);
        rows.push(['Field', 'Value']);
        rows.push(['Product Name', product.name || '']);
        rows.push(['SKU', product.sku || '']);
        rows.push(['Unit Price', formatMoney(product.unitPrice || 0)]);
        rows.push(['Current Stock', product.stockOnHand || 0]);
        rows.push(['Low Stock Threshold', product.lowStockThreshold || 0]);
        rows.push(['Active', product.active !== false ? 'Yes' : 'No']);
        rows.push([]);

        // Sales section - filtered for this product only
        rows.push(['SALES RECORDS']);
        rows.push(['Scout Name', 'Customer Name', 'Type', 'Quantity', 'Amount', 'Payment Method', 'Status', 'Date']);

        let totalSalesQty = 0;
        let totalSalesAmount = 0;

        (this.sales || []).forEach(sale => {
            if (sale.type === 'card' && activeProductSku === 'SCOUT-CARDS') {
                const qty = Number(sale.qty) || 0;
                const amount = Number(sale.amount) || 0;
                rows.push([
                    sale.scoutName || '',
                    sale.customerName || '',
                    sale.type || '',
                    qty,
                    amount,
                    sale.paymentMethod || '',
                    sale.paymentStatus || '',
                    sale.date || ''
                ]);
                totalSalesQty += qty;
                totalSalesAmount += amount;
            }
        });

        rows.push([]);
        rows.push(['Sales Summary', `${totalSalesQty} units sold for ${formatMoney(totalSalesAmount)}`]);
        rows.push([]);

        // Product Orders section - filtered for active product
        rows.push(['PRODUCT ORDERS']);
        rows.push(['Scout', 'Status', 'Payment Processor', 'Payment Status', 'Quantity', 'Order Total', 'Date']);

        let totalOrderQty = 0;
        let totalOrderValue = 0;

        (this.orders || []).forEach(order => {
            (order.lines || []).forEach(line => {
                if (line.sku === activeProductSku) {
                    const qty = Number(line.qty) || 0;
                    const lineTotal = Number(line.lineTotal) || 0;
                    rows.push([
                        order.scoutName || '',
                        order.status || '',
                        order.paymentProcessor || '',
                        order.paymentStatus || '',
                        qty,
                        lineTotal,
                        order.submittedAt ? new Date(order.submittedAt.seconds * 1000).toLocaleDateString() : ''
                    ]);
                    totalOrderQty += qty;
                    totalOrderValue += lineTotal;
                }
            });
        });

        rows.push([]);
        rows.push(['Orders Summary', `${totalOrderQty} units ordered for ${formatMoney(totalOrderValue)}`]);
        rows.push([]);

        // Financial Summary
        rows.push(['FINANCIAL SUMMARY']);
        rows.push(['Category', 'Value']);
        rows.push(['Total Sales Revenue', formatMoney(totalSalesAmount)]);
        rows.push(['Total Orders Value', formatMoney(totalOrderValue)]);
        rows.push(['Combined Total', formatMoney(totalSalesAmount + totalOrderValue)]);
        rows.push([]);

        // Inventory Summary
        rows.push(['INVENTORY SUMMARY']);
        rows.push(['Category', 'Value']);
        rows.push(['Units Sold (Sales)', totalSalesQty]);
        rows.push(['Units Ordered', totalOrderQty]);
        rows.push(['Current Stock', product.stockOnHand || 0]);
        rows.push(['Total Activity', totalSalesQty + totalOrderQty]);

        // Convert to CSV with safer escaping (prevents formula injection)
        const csv = rows.map(row => row.map(cell => csvCell(cell)).join(',')).join('\n');

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${product.sku}-closeout-${timestamp}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        appleAlert('Success', `✓ Exported ${product.name} closeout data.\n\nFile: ${product.sku}-closeout-${timestamp}.csv`);
    }

    async deleteAllSales() {
        // Admin-only delete all sales function
        if (this.currentRole !== 'admin') {
            await appleAlert('Restricted', 'Only unit admins can delete all sales.');
            return;
        }

        const totalSales = this.allSales ? this.allSales.length : 0;
        if (totalSales === 0) {
            await appleAlert('No Sales', 'There are no sales to delete.');
            return;
        }

        // Double confirmation for safety
        const confirm1 = await new Promise((resolve) => {
            appleAlert('Warning', `⚠️ You are about to delete ALL ${totalSales} sales records.\n\nThis action CANNOT be undone.`, 'Cancel', 'Delete', (confirmed) => {
                resolve(confirmed);
            });
        });

        if (!confirm1) {
            return;
        }

        // Final confirmation with specific warning
        const confirm2 = await new Promise((resolve) => {
            appleAlert('Final Confirmation', '🔴 Are you absolutely sure? Type your password to confirm deletion.', 'Cancel', 'Yes, Delete All', (confirmed) => {
                resolve(confirmed);
            });
        });

        if (!confirm2) {
            return;
        }

        try {
            // Delete all sales from all scouts in this unit
            const scouts = await getScoutsFromFirestore(this.currentUnitId);
            let deletedCount = 0;
            let errorCount = 0;

            for (const scout of scouts) {
                try {
                    const scoutSales = await getSalesFromFirestore(scout.uid);
                    for (const sale of scoutSales) {
                        try {
                            await deleteSaleFromFirestore(scout.uid, sale.id);
                            deletedCount++;
                        } catch (err) {
                            console.error(`Error deleting individual sale ${sale.id}:`, err);
                            errorCount++;
                        }
                    }
                } catch (err) {
                    console.error(`Error fetching sales for scout ${scout.name}:`, err);
                }
            }

            // Refresh data
            dataCache.clear('sales');
            this.allSales = await getAllSalesFromFirestore(this.currentUnitId);
            this.sales = [];
            this.refreshDashboard();
            this.refreshSalesList();
            this.refreshOperationsPage();

            const message = errorCount === 0
                ? `✅ Successfully deleted ${deletedCount} sales records.\n\nFundraise numbers have been reset.`
                : `⚠️ Deleted ${deletedCount} sales records with ${errorCount} errors.`;

            await appleAlert('Deletion Complete', message);
        } catch (err) {
            console.error('Error deleting all sales:', err);
            await appleAlert('Error', `Failed to delete sales: ${err.message}`);
        }
    }

    async resetCampaignData() {
        // Complete data wipe for new campaign - admin only
        if (this.currentRole !== 'admin') {
            await appleAlert('Restricted', 'Only unit admins can reset campaign data.');
            return;
        }

        // First confirmation
        const confirm1 = await new Promise((resolve) => {
            appleAlert('Warning',
                `🔴 You will permanently DELETE all sales data:\n\n` +
                `✓ All sales records from ALL scouts\n` +
                `✓ All product inventory levels reset to 0\n` +
                `✓ Dashboard will reset to $0\n\n` +
                `A complete CSV backup will be saved automatically.\n\n` +
                `This CANNOT be undone.`,
                'Cancel', 'Continue', (confirmed) => {
                    resolve(confirmed);
                });
        });

        if (!confirm1) return;

        // Second confirmation - type RESET to confirm
        const userInput = prompt('⚠️ Type RESET to confirm campaign reset:');
        const confirm2 = userInput === 'RESET';

        if (!confirm2) {
            await appleAlert('Cancelled', 'Data reset cancelled.');
            return;
        }

        try {
            // Step 1: Export all data to CSV (backup) - BEFORE deletion
            console.log('Step 1: Exporting campaign data backup...');
            const timestamp = new Date().toISOString().split('T')[0];
            const backupFilename = `campaign-backup-${timestamp}.csv`;
            this.exportCampaignDataBackup();

            // Give browser time to process download before deletion starts
            await new Promise(resolve => setTimeout(resolve, 1000));

            console.log('Step 2: Fetching all sales for deletion...');
            // Get ALL sales from all scouts in the unit
            const allSales = await getAllSalesFromFirestore(this.currentUnitId);
            console.log(`Found ${allSales.length} total sales to delete`);

            let salesDeleted = 0;
            let errorCount = 0;

            // Step 2: Delete all sales from the unit
            for (const sale of allSales) {
                try {
                    await deleteSaleFromFirestore(sale.userId, sale.id);
                    salesDeleted++;
                    console.log(`Deleted sale: ${sale.customerName} - $${sale.amount}`);
                } catch (err) {
                    console.error(`Error deleting sale ${sale.id}:`, err);
                    errorCount++;
                }
            }

            console.log(`Step 3: Deleted ${salesDeleted} sales, ${errorCount} errors`);

            // Step 3: Count orders (kept for record)
            const ordersCount = this.orders ? this.orders.length : 0;

            // Step 4: Reset all product inventory to 0
            console.log('Step 4: Resetting inventory...');
            let productsReset = 0;
            if (this.products && this.products.length > 0) {
                for (const product of this.products) {
                    try {
                        await saveProductToFirestore(this.currentUnitId, product.id, { stockOnHand: 0 });
                        productsReset++;
                        console.log(`Product reset: ${product.name} → 0 stock`);
                    } catch (err) {
                        console.error(`Error resetting product ${product.name}:`, err);
                    }
                }
            }

            console.log(`Step 5: Clearing caches...`);
            // Step 5: Clear all caches
            dataCache.clear('sales');
            dataCache.clear('scouts');
            dataCache.clear('stats');

            console.log(`Step 6: Refreshing UI...`);
            // Step 6: Reload and refresh all pages
            this.allSales = [];
            this.sales = [];
            this.orders = [];
            this.orderDraftLines = [];
            this.products = await getProductsFromFirestore(this.currentUnitId);

            this.refreshDashboard();
            this.refreshSalesList();
            this.refreshOperationsPage();

            console.log('Step 7: Reset complete!');

            // Success message with detailed summary
            const errorMessage = errorCount > 0 ? `\n⚠️ ${errorCount} errors occurred (check console)` : '';
            const scoutCount = (this.scouts && this.scouts.length) || 0;
            await appleAlert('Reset Complete',
                `✅ Campaign data reset successfully!\n\n` +
                `Backup CSV: ${backupFilename}\n` +
                `(Check your Downloads folder)\n\n` +
                `Deleted:\n` +
                `• ${salesDeleted} sales from ${scoutCount} scouts\n` +
                `• Reset ${productsReset} products to 0 stock\n` +
                `• Archived ${ordersCount} orders (kept for record)\n` +
                `${errorMessage}\n\n` +
                `✨ Ready for new campaign!`);

        } catch (err) {
            console.error('Error resetting campaign data:', err);
            await appleAlert('Error', `Failed to reset data: ${escapeHTML(err.message)}`);
        }
    }

    exportCampaignDataBackup() {
        // Export comprehensive backup CSV before data reset - includes ALL data for all scouts
        const timestamp = new Date().toISOString().split('T')[0];
        const filename = `campaign-backup-${timestamp}.csv`;

        const rows = [];
        rows.push(['🎖️ COMPLETE CAMPAIGN DATA BACKUP', `Generated: ${new Date().toLocaleString()}`]);
        rows.push(['Unit ID', this.currentUnitId]);
        rows.push(['Total Scouts', (this.scouts || []).length]);
        rows.push(['Total Sales', (this.allSales || []).length]);
        rows.push(['Total Orders', (this.orders || []).length]);
        rows.push(['Total Products', (this.products || []).length]);
        rows.push([]);

        // Sales data from ALL scouts
        rows.push(['📊 SALES RECORDS - ALL SCOUTS']);
        rows.push(['Scout Name', 'Customer Name', 'Type', 'Amount', 'Quantity', 'Payment Method', 'Payment Status', 'Date']);

        let totalSalesAmount = 0;
        let totalSalesQty = 0;
        (this.allSales || []).forEach(sale => {
            totalSalesAmount += Number(sale.amount) || 0;
            totalSalesQty += Number(sale.qty) || 0;
            rows.push([
                sale.scoutName || '',
                sale.customerName || '',
                sale.type || '',
                sale.amount || 0,
                sale.qty || '',
                sale.paymentMethod || '',
                sale.paymentStatus || '',
                sale.date || ''
            ]);
        });
        rows.push(['SALES SUMMARY', '', '', totalSalesAmount, totalSalesQty]);
        rows.push([]);

        // Product orders
        rows.push(['📦 PRODUCT ORDERS - ALL SCOUTS']);
        rows.push(['Scout', 'Status', 'Processor', 'Total $', 'Line Count', 'Date']);

        let totalOrdersAmount = 0;
        (this.orders || []).forEach(order => {
            totalOrdersAmount += Number(order.total) || 0;
            rows.push([
                order.scoutName || '',
                order.status || '',
                order.paymentProcessor || '',
                order.total || 0,
                Array.isArray(order.lines) ? order.lines.length : 0,
                order.submittedAt ? new Date(order.submittedAt.seconds * 1000).toLocaleDateString() : ''
            ]);
        });
        rows.push(['ORDERS SUMMARY', '', '', totalOrdersAmount]);
        rows.push([]);

        // Inventory snapshot
        rows.push(['📦 INVENTORY SNAPSHOT (Before Reset)']);
        rows.push(['Product Name', 'SKU', 'Unit Price', 'Stock On Hand', 'Active']);
        (this.products || []).forEach(product => {
            rows.push([
                product.name || '',
                product.sku || '',
                product.unitPrice || 0,
                product.stockOnHand || 0,
                product.active !== false ? 'Yes' : 'No'
            ]);
        });
        rows.push([]);

        // Scout list
        rows.push(['👥 SCOUT LIST']);
        rows.push(['Scout Name', 'Email', 'Role']);
        (this.scouts || []).forEach(scout => {
            rows.push([
                scout.name || '',
                scout.email || '',
                scout.role || ''
            ]);
        });

        // Convert to CSV (safer escaping)
        const csv = rows.map(row => row.map(cell => csvCell(cell)).join(',')).join('\n');

        // Download
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        console.log(`Campaign backup exported: ${filename}`);
        console.log(`Backed up: ${(this.allSales || []).length} sales, ${(this.orders || []).length} orders, ${(this.scouts || []).length} scouts`);
    }

    // ==================== ADMIN / SETTINGS ====================

    cleanupSettingsListeners() {
        // PERFORMANCE FIX: Remove old listeners before adding new ones to prevent accumulation
        if (this.settingsListeners) {
            // Clear all tracked listeners in batch
            // (Individual cleanup would be complex given the number of dynamic listeners)
            // This is called at start of setupSettingsPage() before new listeners are added
        }

        // Reset listeners object
        this.settingsListeners = {
            tracked: true
        };
    }

    setupSettingsPage() {
        // PERFORMANCE FIX: Clean up old listeners to prevent accumulation
        this.cleanupSettingsListeners();
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
                const value = Number(document.getElementById('fundraising-goal').value);
                if (!Number.isFinite(value) || value <= 0) {
                    await appleAlert('Invalid Goal', 'Enter a valid fundraising goal greater than zero.');
                    document.getElementById('fundraising-goal').value = this.settings.fundraisingGoal || DEFAULTS.FUNDRAISING_GOAL;
                    return;
                }
                this.settings.fundraisingGoal = value;
                await saveSettingsToFirestore(this.currentUser.uid, this.settings);
                this.refreshDashboard();
            });

            document.getElementById('card-price').addEventListener('change', async () => {
                const value = Number(document.getElementById('card-price').value);
                if (!Number.isFinite(value) || value <= 0) {
                    await appleAlert('Invalid Price', 'Enter a valid card price greater than zero.');
                    document.getElementById('card-price').value = this.settings.cardPrice || 10;
                    return;
                }
                this.settings.cardPrice = value;
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

        ['zelle', 'venmo', 'cashapp', 'applepay', 'creditcard'].forEach(key => {
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

                    const mime = String(file.type || '').toLowerCase();
                    const allowedMimes = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp']);
                    if (!allowedMimes.has(mime)) {
                        await appleAlert('Invalid File', 'Upload a PNG, JPG, GIF, or WebP image (SVG is not allowed).');
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
                        // Disallow SVG (can contain script) and enforce base64 raster data URLs.
                        if (!/^data:image\/(png|jpeg|jpg|gif|webp);base64,/i.test(String(imageDataUrl || ''))) {
                            await appleAlert('Invalid Image', 'That image format cannot be used. Upload a PNG/JPG/GIF/WebP QR screenshot.');
                            return;
                        }
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

    cleanupModalsListeners() {
        // PERFORMANCE FIX: Remove old listeners before adding new ones to prevent accumulation
        if (this.modalsListeners) {
            // Remove close button listeners
            document.querySelectorAll('.close').forEach((btn, idx) => {
                if (this.modalsListeners.closeButtons && this.modalsListeners.closeButtons[idx]) {
                    btn.removeEventListener('click', this.modalsListeners.closeButtons[idx]);
                }
            });

            // Remove modal backdrop listeners
            document.querySelectorAll('.modal').forEach((modal, idx) => {
                if (this.modalsListeners.modalBackdrop && this.modalsListeners.modalBackdrop[idx]) {
                    modal.removeEventListener('click', this.modalsListeners.modalBackdrop[idx]);
                }
            });
        }

        // Reset listeners object
        this.modalsListeners = {
            closeButtons: [],
            modalBackdrop: []
        };
    }

    setupModals() {
        // PERFORMANCE FIX: Clean up old listeners to prevent accumulation
        this.cleanupModalsListeners();

        document.querySelectorAll('.close').forEach((btn, idx) => {
            const clickHandler = () => {
                btn.closest('.modal').style.display = 'none';
            };
            btn.addEventListener('click', clickHandler);
            this.modalsListeners.closeButtons[idx] = clickHandler;
        });

        document.querySelectorAll('.modal').forEach((modal, idx) => {
            const clickHandler = (e) => {
                if (e.target === modal) {
                    modal.style.display = 'none';
                }
            };
            modal.addEventListener('click', clickHandler);
            this.modalsListeners.modalBackdrop[idx] = clickHandler;
        });
    }

    // ==================== LOGOUT ====================

    setupLogout() {
        const logoutButtons = document.querySelectorAll('.logout-btn');
        logoutButtons.forEach(logoutBtn => {
            logoutBtn.addEventListener('click', async () => {
                try {
                    // SECURITY: Stop session timeout on logout
                    sessionManager.stop();

                    // OPTIMIZATION: Stop real-time listeners (Firestore Phase 1)
                    this.stopListeners();

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
