// Scout Fundraiser App - Firebase Online Version
// Complete working implementation

// ==================== GLOBAL STATE ====================
let db, auth, currentUser = null;
let app = null;
let deferredInstallPrompt = null;
const MAX_QR_IMAGE_FILE_BYTES = 300 * 1024;
const MAX_QR_IMAGE_DATAURL_BYTES = 350 * 1024;

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
function waitForFirebase(maxRetries = 50) {
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

function formatDate(dateVal) {
    if (!dateVal) return '';
    // If it's a YYYY-MM-DD string, parse as local time (not UTC)
    if (typeof dateVal === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
        const [y, m, d] = dateVal.split('-').map(Number);
        return new Date(y, m - 1, d).toLocaleDateString();
    }
    return new Date(dateVal).toLocaleDateString();
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
        fundraisingGoal: 5000,
        cardPrice: 20,
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

// ==================== FIRESTORE SCOUT HELPERS (SHARED) ====================

// Scouts are stored in a shared top-level 'scouts' collection so all users see the same roster
async function addScoutToFirestore(userId, scoutData) {
    try {
        const { collection, addDoc, serverTimestamp } = window.firebaseImports;
        const docRef = await addDoc(collection(db, 'scouts'), {
            ...scoutData,
            addedBy: userId,
            createdAt: serverTimestamp()
        });
        return docRef.id;
    } catch (e) {
        console.error('Error adding scout:', e);
        throw e;
    }
}

async function getScoutsFromFirestore() {
    try {
        const { collection, query, getDocs } = window.firebaseImports;
        const q = query(collection(db, 'scouts'));
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (e) {
        console.error('Error getting scouts:', e);
        return [];
    }
}

async function deleteScoutFromFirestore(scoutId) {
    try {
        const { deleteDoc, doc } = window.firebaseImports;
        await deleteDoc(doc(db, `scouts/${scoutId}`));
    } catch (e) {
        console.error('Error deleting scout:', e);
    }
}

// Migrate scouts from old per-user location to shared collection (runs once per user)
async function migrateScoutsToShared(userId) {
    try {
        const { collection, query, getDocs, doc, getDoc, setDoc } = window.firebaseImports;

        // Check if this user already migrated
        const userDoc = await getDoc(doc(db, 'users', userId));
        if (userDoc.exists() && userDoc.data().scoutsMigrated) return;

        // Read old per-user scouts
        const oldScoutsSnap = await getDocs(query(collection(db, `users/${userId}/scouts`)));
        if (oldScoutsSnap.empty) {
            // Nothing to migrate, but mark as done
            await setDoc(doc(db, 'users', userId), { scoutsMigrated: true }, { merge: true });
            return;
        }

        // Get existing shared scouts to avoid duplicates
        const sharedScouts = await getScoutsFromFirestore();
        const sharedNames = new Set(sharedScouts.map(s => s.name.toLowerCase()));

        for (const scoutDoc of oldScoutsSnap.docs) {
            const data = scoutDoc.data();
            if (data.name && !sharedNames.has(data.name.toLowerCase())) {
                await addScoutToFirestore(userId, { name: data.name, goal: data.goal || 2000 });
                sharedNames.add(data.name.toLowerCase());
                console.log('Migrated scout:', data.name);
            }
        }

        // Mark migration complete
        await setDoc(doc(db, 'users', userId), { scoutsMigrated: true }, { merge: true });
        console.log('Scout migration complete for user:', userId);
    } catch (e) {
        console.error('Scout migration error:', e);
    }
}

// Also add the logged-in user to shared roster if not already present
async function ensureUserInRoster(userId, displayName) {
    if (!displayName) return;
    try {
        const scouts = await getScoutsFromFirestore();
        const exists = scouts.some(s => s.name.toLowerCase() === displayName.toLowerCase());
        if (!exists) {
            await addScoutToFirestore(userId, { name: displayName, goal: 2000 });
            console.log('Added current user to shared roster:', displayName);
        }
    } catch (e) {
        console.error('Error ensuring user in roster:', e);
    }
}

// Get ALL sales from ALL users (for leaderboard and troop stats)
async function getAllSalesFromFirestore() {
    try {
        const { collection, getDocs } = window.firebaseImports;
        const usersSnap = await getDocs(collection(db, 'users'));
        let allSales = [];

        for (const userDoc of usersSnap.docs) {
            const salesSnap = await getDocs(collection(db, `users/${userDoc.id}/sales`));
            salesSnap.forEach(saleDoc => {
                allSales.push({ id: saleDoc.id, userId: userDoc.id, ...saleDoc.data() });
            });
        }

        return allSales;
    } catch (e) {
        console.error('Error getting all sales:', e);
        return [];
    }
}

async function getTroopStats() {
    try {
        const allSales = await getAllSalesFromFirestore();
        let totalRaised = 0;
        let totalCards = 0;
        let totalDonations = 0;

        allSales.forEach(sale => {
            totalRaised += Number(sale.amount) || 0;
            if (sale.type === 'card') totalCards++;
            if (sale.type === 'donation') totalDonations++;
        });

        const scouts = await getScoutsFromFirestore();
        return { totalRaised, totalCards, totalDonations, scoutCount: scouts.length };
    } catch (e) {
        console.error('Error getting troop stats:', e);
        return { totalRaised: 0, totalCards: 0, totalDonations: 0, scoutCount: 0 };
    }
}

// ==================== MAIN APP CLASS ====================

class ScoutFundraiserApp {
    constructor() {
        this.currentPage = 'quicklog';
        this.currentUser = currentUser;
        this.settings = null;
        this.sales = [];

        this.init();
    }

    init() {
        if (!currentUser) {
            this.setupAuthUI();
            this.showLanding();
        } else {
            this.setupApp().then(() => this.showApp());
        }
    }

    handleAuthChange(user) {
        this.currentUser = user;
        if (user) {
            this.setupApp().then(() => this.showApp());
        } else {
            this.showLanding();
        }
    }

    showLanding() {
        document.getElementById('landing-page').style.display = 'flex';
        document.getElementById('app-shell').classList.add('hidden');
    }

    showApp() {
        document.getElementById('landing-page').style.display = 'none';
        document.getElementById('app-shell').classList.remove('hidden');
        this.refreshDashboard();
    }

    // ==================== AUTHENTICATION ====================

    setupAuthUI() {
        console.log('setupAuthUI() called - Setting up auth forms');
        const authTabs = document.querySelectorAll('.auth-tab-btn');
        const authForms = document.querySelectorAll('.auth-form');
        
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
        
        console.log('Login form found:', !!loginForm);
        console.log('Signup form found:', !!signupForm);

        if (loginForm) {
            loginForm.addEventListener('submit', (e) => {
                console.log('Login form submitted');
                e.preventDefault();
                this.handleLogin();
            });
        }

        if (signupForm) {
            signupForm.addEventListener('submit', (e) => {
                console.log('Signup form submitted');
                e.preventDefault();
                this.handleSignup();
            });
        }
    }

    async handleLogin() {
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;
        const errorEl = document.getElementById('login-error');

        if (!email || !password) {
            errorEl.textContent = 'Please enter email and password.';
            return;
        }

        try {
            const { signInWithEmailAndPassword } = window.firebaseImports;
            await signInWithEmailAndPassword(auth, email, password);
            errorEl.textContent = '';
        } catch (error) {
            errorEl.textContent = error.message || 'Login failed. Please try again.';
        }
    }

    async handleSignup() {
        const name = document.getElementById('signup-name').value.trim();
        const email = document.getElementById('signup-email').value.trim();
        const password = document.getElementById('signup-password').value;
        const confirm = document.getElementById('signup-confirm').value;
        const errorEl = document.getElementById('signup-error');

        if (!errorEl) {
            console.error('signup-error element not found');
            await appleAlert('Form Error', 'Check browser console for details.');
            return;
        }

        if (!name || !email || !password || !confirm) {
            errorEl.textContent = 'Please fill in all fields.';
            return;
        }

        if (password !== confirm) {
            errorEl.textContent = 'Passwords do not match.';
            return;
        }

        if (password.length < 6) {
            errorEl.textContent = 'Password must be at least 6 characters.';
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
            
            const userSettings = getDefaultSettings();
            await setDoc(
                doc(db, 'users', userCred.user.uid),
                {
                    name,
                    email,
                    settings: userSettings,
                    createdAt: new Date().toISOString()
                }
            );

            // Auto-add this scout to the shared roster (non-blocking — don't let this fail signup)
            try {
                await ensureUserInRoster(userCred.user.uid, name);
            } catch (rosterErr) {
                console.warn('Could not auto-add to roster (will retry on login):', rosterErr);
            }

            errorEl.textContent = '';
            document.getElementById('signup-form').reset();
            errorEl.textContent = 'Account created! Logging in...';
        } catch (error) {
            console.error('Signup error:', error);
            errorEl.textContent = error.message || 'Signup failed. Please try again.';
        }
    }

    // ==================== APP SETUP ====================

    async setupApp() {
        this.settings = await loadSettingsFromFirestore(this.currentUser.uid);
        await this.loadSales();

        // Migrate old per-user scouts to shared collection & ensure user is in roster
        await migrateScoutsToShared(this.currentUser.uid);
        await ensureUserInRoster(this.currentUser.uid, (this.currentUser.displayName || '').trim());

        // Only bind event listeners once to prevent duplicates
        if (!this._setupDone) {
            this._setupDone = true;
            this.setupNavigation();
            this.setupQuickLogPage();
            this.setupDashboardPage();
            this.setupSalesPage();
            await this.setupScoutsPage();
            this.setupSettingsPage();
            this.setupLogout();
            this.setupModals();
        }

        const initialPage = window.location.hash.replace('#', '') || 'quicklog';
        this.navigateTo(initialPage);
    }

    async loadSales() {
        this.sales = await getSalesFromFirestore(this.currentUser.uid);
    }

    // ==================== NAVIGATION ====================

    setupNavigation() {
        const navButtons = document.querySelectorAll('.nav-btn');
        navButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const page = btn.dataset.page;
                this.navigateTo(page);
                window.location.hash = page;
            });
        });
    }

    async navigateTo(page) {
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.page === page);
        });

        document.querySelectorAll('.page').forEach(p => {
            p.classList.toggle('active', p.id === page + '-page');
        });

        this.currentPage = page;

        // Reload fresh data from Firestore on every page switch
        await this.loadSales();

        if (page === 'quicklog') {
            this.scouts = await getScoutsFromFirestore();
            this.populateScoutDropdown();
            document.getElementById('quick-scout').focus();
        }
        if (page === 'dashboard') this.refreshDashboard();
        if (page === 'sales') this.refreshSalesList();
        if (page === 'scouts') {
            this.scouts = await getScoutsFromFirestore();
            this.allSales = await getAllSalesFromFirestore();
            this.refreshScoutsList();
            this.refreshLeaderboard();
        }
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
            if (sale.type === 'card') stats.cardsSold++;
            if (sale.type === 'donation') stats.donationsCount++;
        });

        const goal = (this.settings && this.settings.fundraisingGoal) || 5000;
        const progress = goal > 0 ? (stats.totalRaised / goal) * 100 : 0;

        document.getElementById('total-raised').textContent = formatMoney(stats.totalRaised);
        document.getElementById('cards-sold').textContent = stats.cardsSold;
        document.getElementById('donations-count').textContent = stats.donationsCount;
        document.getElementById('scouts-active').textContent = stats.scoutsActive;
        document.getElementById('goal-progress').style.width = Math.min(progress, 100) + '%';
        document.getElementById('goal-pct').textContent = progress.toFixed(1) + '%';
        document.getElementById('goal-progress-text').textContent = formatMoney(stats.totalRaised) + ' of ' + formatMoney(goal);

        this.renderDashTransactions();
    }

    renderDashTransactions() {
        const searchTerm = (document.getElementById('dash-sales-search').value || '').toLowerCase();
        const typeFilter = document.getElementById('dash-sales-filter-type').value;
        const paymentFilter = document.getElementById('dash-sales-filter-payment').value;

        let filtered = [...this.sales];

        if (searchTerm) {
            filtered = filtered.filter(s =>
                (s.customerName || '').toLowerCase().includes(searchTerm) ||
                (s.scoutName || '').toLowerCase().includes(searchTerm)
            );
        }

        if (typeFilter && typeFilter !== 'all') {
            filtered = filtered.filter(s => s.type === typeFilter);
        }

        if (paymentFilter && paymentFilter !== 'all') {
            filtered = filtered.filter(s => s.paymentMethod === paymentFilter);
        }

        filtered.sort((a, b) => {
            const dateA = a.date ? new Date(a.date) : new Date(0);
            const dateB = b.date ? new Date(b.date) : new Date(0);
            return dateB - dateA;
        });

        const container = document.getElementById('dash-sales-list');

        if (filtered.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><svg class="icon"><use href="#icon-receipt"/></svg></div><p>No sales found</p></div>';
            return;
        }

        let html = '';
        filtered.forEach(sale => {
            const typeClass = sale.type === 'card' ? 'card-sale' : 'donation';
            const typeLabel = sale.type === 'card' ? 'Scout Card' : 'Donation';

            html += `<div class="sale-item" data-sale-id="${sale.id}">
                <div class="sale-info">
                    <h5>${escapeHTML(sale.scoutName || this.currentUser.displayName || 'Scout')}</h5>
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

    // ==================== SALES ====================

    setupSalesPage() {
        // Auto-fill date
        document.getElementById('sale-date').value = getLocalDateInputValue();

        // Search and filter listeners
        ['input', 'change'].forEach(evt => {
            document.getElementById('sales-search').addEventListener(evt, () => this.refreshSalesList());
            document.getElementById('sales-filter-type').addEventListener(evt, () => this.refreshSalesList());
            document.getElementById('sales-filter-payment').addEventListener(evt, () => this.refreshSalesList());
        });

        // Click delegation for sales list
        document.getElementById('sales-list').addEventListener('click', (e) => {
            const item = e.target.closest('.sale-item');
            if (item) {
                this.showSaleDetail(item.dataset.saleId);
            }
        });
    }

    async refreshSalesList() {
        const searchTerm = document.getElementById('sales-search').value.toLowerCase();
        const typeFilter = document.getElementById('sales-filter-type').value;
        const paymentFilter = document.getElementById('sales-filter-payment').value;

        let filtered = this.sales;

        if (searchTerm) {
            filtered = filtered.filter(s =>
                (s.customerName || '').toLowerCase().includes(searchTerm)
            );
        }

        if (typeFilter && typeFilter !== 'all') {
            filtered = filtered.filter(s => s.type === typeFilter);
        }

        if (paymentFilter && paymentFilter !== 'all') {
            filtered = filtered.filter(s => s.paymentMethod === paymentFilter);
        }

        filtered = filtered.sort((a, b) => {
            const dateA = a.date ? new Date(a.date) : new Date(0);
            const dateB = b.date ? new Date(b.date) : new Date(0);
            return dateB - dateA;
        });

        const container = document.getElementById('sales-list');

        if (filtered.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><svg class="icon"><use href="#icon-receipt"/></svg></div><p>No sales found</p></div>';
            return;
        }

        let html = '';
        filtered.forEach(sale => {
            const typeClass = sale.type === 'card' ? 'card-sale' : 'donation';
            const typeLabel = sale.type === 'card' ? 'Scout Card' : 'Donation';

            html += `<div class="sale-item" data-sale-id="${sale.id}">
                <div class="sale-info">
                    <h5>${escapeHTML(sale.scoutName || this.currentUser.displayName || 'Scout')}</h5>
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
        this.quickFields.price.value = this.settings.cardPrice || 20;

        // Populate scout dropdown
        this.populateScoutDropdown();

        // Apply field controls from admin settings
        this.applyFieldControls();

        // Type toggle buttons
        this.typeBtns = document.querySelectorAll('.type-toggle-btn');
        this.typeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const type = btn.dataset.type;
                this.typeBtns.forEach(b => b.classList.toggle('active', b === btn));
                this.quickFields.type.value = type;
                this.setQuickTypeVisibility(type);
                this.updateQuickSummary();
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
        if (type === 'card') {
            const price = Number(this.quickFields.price.value);
            const qty = Number(this.quickFields.qty.value);
            if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(qty) || qty <= 0) {
                await appleAlert('Invalid Input', 'Please enter valid card price and quantity.');
                return;
            }
            amount = price * qty;
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
            const saleData = {
                type,
                amount,
                paymentMethod,
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
            this.quickFields.price.value = this.settings.cardPrice || 20;
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
        this.scouts = await getScoutsFromFirestore();
        this.allSales = await getAllSalesFromFirestore();

        const form = document.getElementById('scout-form');
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const nameInput = document.getElementById('scout-name');
            const goalInput = document.getElementById('scout-goal');
            const name = nameInput.value.trim();
            const goal = Number(goalInput.value) || 2000;

            if (!name) {
                await appleAlert('Name Required', 'Please enter a scout name.');
                return;
            }

            try {
                await addScoutToFirestore(this.currentUser.uid, { name, goal });
                this.scouts = await getScoutsFromFirestore();
                this.refreshScoutsList();
                this.refreshLeaderboard();
                this.populateScoutDropdown();
                nameInput.value = '';
                goalInput.value = 2000;
            } catch (e) {
                await appleAlert('Error', 'Error adding scout: ' + e.message);
            }
        });

        this.refreshScoutsList();
        this.refreshLeaderboard();
    }

    refreshScoutsList() {
        const container = document.getElementById('scouts-list');
        if (!container) return;

        if (!this.scouts || this.scouts.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><svg class="icon"><use href="#icon-users"/></svg></div><p>No scouts added yet. Add your first scout above!</p></div>';
            return;
        }

        // Use allSales (from all users) so totals reflect the whole troop
        const salesPool = this.allSales || this.sales || [];

        let html = '';
        this.scouts.forEach(scout => {
            const nameLower = scout.name.toLowerCase();
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
                </div>
            </div>`;
        });

        container.innerHTML = html;

    }

    refreshLeaderboard() {
        const container = document.getElementById('leaderboard');
        if (!container) return;

        if (!this.scouts || this.scouts.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>Add scouts to see the leaderboard</p></div>';
            return;
        }

        // Use allSales (from all users) so leaderboard reflects the whole troop
        const salesPool = this.allSales || this.sales || [];

        const ranked = this.scouts.map(scout => {
            const nameLower = scout.name.toLowerCase();
            const scoutSales = salesPool.filter(s =>
                (s.scoutName || s.customerName || '').toLowerCase() === nameLower
            );
            const totalRaised = scoutSales.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
            const cardsSold = scoutSales.filter(s => s.type === 'card').length;
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

    // ==================== ADMIN / SETTINGS ====================

    setupSettingsPage() {
        // Profile display
        const name = this.currentUser.displayName || 'Scout';
        const email = this.currentUser.email || '';
        document.getElementById('admin-name').textContent = name;
        document.getElementById('admin-email').textContent = email;
        document.getElementById('admin-avatar').textContent = name.charAt(0).toUpperCase();

        // Fundraising settings
        document.getElementById('fundraising-goal').value = this.settings.fundraisingGoal || 5000;
        document.getElementById('card-price').value = this.settings.cardPrice || 20;

        document.getElementById('fundraising-goal').addEventListener('change', async () => {
            this.settings.fundraisingGoal = Number(document.getElementById('fundraising-goal').value) || 5000;
            await saveSettingsToFirestore(this.currentUser.uid, this.settings);
            this.refreshDashboard();
        });

        document.getElementById('card-price').addEventListener('change', async () => {
            this.settings.cardPrice = Number(document.getElementById('card-price').value) || 20;
            await saveSettingsToFirestore(this.currentUser.uid, this.settings);
            this.quickFields.price.value = this.settings.cardPrice;
        });

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
                } catch (error) {
                    console.error('Logout error:', error);
                }
            });
        });
    }
}

// ==================== START APP ====================

// Expose for module script in index.html
window.initializeFirebase = initializeFirebase;
