// Firebase bootstrap (module) - extracted from index.html to comply with CSP (no inline scripts)

// Import Firebase modules
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  signOut,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  doc,
  addDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

// Make Firebase globals available to app.js
window.firebaseImports = {
  initializeApp,
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  signOut,
  sendPasswordResetEmail,
  getFirestore,
  collection,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  doc,
  addDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
  onSnapshot
};

// Helper: load a script and return a promise
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.body.appendChild(s);
  });
}

// Load QR libraries in parallel (not blocking)
loadScript('https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js').catch(() => {});
loadScript('jsqr.min.js').catch(() => {});

// Fix SVG icons - add viewBox to all icon SVGs
function fixIconSvgs() {
  document
    .querySelectorAll('svg.icon, svg.icon-btn, svg.icon-heading, svg.icon-heading-sm, svg.icon-header')
    .forEach(svg => {
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    });
}

// Run immediately
fixIconSvgs();

// Watch for dynamically added icons
const iconObserver = new MutationObserver(fixIconSvgs);
iconObserver.observe(document.body, { childList: true, subtree: true });

// Load firebase-config FIRST, then app.js, then initialize
await loadScript('firebase-config.js');
await loadScript('app.js');

// DOMContentLoaded has already fired by now (module scripts are deferred),
// so call initializeFirebase directly
if (typeof window.initializeFirebase === 'function') {
  window.initializeFirebase();
}
