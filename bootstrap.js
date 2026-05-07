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
import { ICON_SHAPES } from './icon-shapes.js';

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

function shadeHexColor(hex, factor) {
  const clean = String(hex || '').replace('#', '');
  if (clean.length !== 6) return hex;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const nr = Math.max(0, Math.min(255, Math.round(r * factor)));
  const ng = Math.max(0, Math.min(255, Math.round(g * factor)));
  const nb = Math.max(0, Math.min(255, Math.round(b * factor)));
  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
}

function getIconVariant(icon) {
  return icon.group === 'Transactions' ? 'playful' : 'rich';
}

function getIconBaseColor(icon) {
  const variant = getIconVariant(icon);
  return icon.colors?.[variant] || icon.colors?.rich || icon.colors?.playful || null;
}

function renderShapeTemplate(template, vars) {
  return String(template || '')
    .replace(/\{G\}/g, vars.G)
    .replace(/\{S\}/g, vars.S)
    .replace(/\{HI\}/g, vars.HI)
    .replace(/\{HI2\}/g, vars.HI2);
}

async function loadSharedIconsConfig() {
  try {
    const response = await fetch('icons.json', { cache: 'no-cache' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.warn('[icons] Unable to load icons.json:', error);
    return null;
  }
}

function applySharedIconTheme(config) {
  if (!config || !Array.isArray(config.icons)) return;

  config.icons.forEach(icon => {
    const baseColor = getIconBaseColor(icon);
    if (!baseColor || !icon.slot) return;

    const gradient = document.getElementById(`icon-grad-${icon.slot}`);
    if (gradient) {
      const stops = gradient.querySelectorAll('stop');
      if (stops[0]) stops[0].setAttribute('stop-color', shadeHexColor(baseColor, 1.38));
      if (stops[1]) stops[1].setAttribute('stop-color', shadeHexColor(baseColor, 1.06));
      if (stops[2]) stops[2].setAttribute('stop-color', shadeHexColor(baseColor, 0.68));
    }

    const symbol = document.getElementById(`icon-${icon.slot}`);
    if (symbol) {
      const shape = ICON_SHAPES[icon.slot];
      if (shape) {
        const vars = {
          G: `url(#icon-grad-${icon.slot})`,
          S: shadeHexColor(baseColor, 0.8),
          HI: 'rgba(255,255,255,0.82)',
          HI2: 'rgba(255,255,255,0.55)'
        };
        symbol.innerHTML = `${renderShapeTemplate(shape.front, vars)}${renderShapeTemplate(shape.highlight, vars)}`;
      } else {
        symbol.querySelectorAll('[stroke]').forEach(node => {
          const stroke = String(node.getAttribute('stroke') || '').replace(/\s+/g, '').toLowerCase();
          if (!stroke || stroke === 'none' || stroke.startsWith('url(') || stroke === '#fff' || stroke === '#ffffff') return;
          if (stroke.includes('255,255,255')) return;
          node.setAttribute('stroke', shadeHexColor(baseColor, 0.8));
        });
      }
    }
  });

  const settings = config.icons.find(icon => icon.slot === 'settings');
  const settingsColor = settings ? getIconBaseColor(settings) : null;
  if (settingsColor) {
    document.documentElement.style.setProperty('--icon-settings-rich', settingsColor);
  }
}

// Load QR libraries in parallel (not blocking)
loadScript('https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js').catch(() => {});
loadScript('jsqr.min.js').catch(() => {});

// Fix SVG icons - add viewBox to all icon SVGs
function fixIconSvgs() {
  document
    .querySelectorAll('svg.icon, svg.icon-btn, svg.icon-heading, svg.icon-heading-sm, svg.icon-header')
    .forEach(svg => {
      if (!svg.hasAttribute('viewBox')) {
        svg.setAttribute('viewBox', '0 0 64 64');
      }
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    });
}

// Fallback: render icon shapes from ICON_SHAPES using static gradient IDs already in index.html.
// Called when icons.json is unavailable so symbols are never left empty.
function renderFallbackIcons() {
  Object.entries(ICON_SHAPES).forEach(([slot, shape]) => {
    const symbol = document.getElementById(`icon-${slot}`);
    if (!symbol || symbol.innerHTML.trim()) return; // already populated
    const vars = {
      G: `url(#icon-grad-${slot})`,
      S: 'rgba(0,0,0,0.28)',
      HI: 'rgba(255,255,255,0.82)',
      HI2: 'rgba(255,255,255,0.55)'
    };
    symbol.innerHTML = `${renderShapeTemplate(shape.front, vars)}${renderShapeTemplate(shape.highlight, vars)}`;
  });
}

// Run immediately
fixIconSvgs();

// Render fallback shapes first so icons are never blank during fetch
renderFallbackIcons();

// Apply shared icon palette from icons.json (used by both app and review page)
const sharedIconsConfig = await loadSharedIconsConfig();
if (sharedIconsConfig) {
  applySharedIconTheme(sharedIconsConfig);
} else {
  console.warn('[icons] Falling back to static gradient colours — icons.json unavailable.');
}

// Watch for dynamically added icons
const iconObserver = new MutationObserver(fixIconSvgs);
iconObserver.observe(document.body, { childList: true, subtree: true });

// Load firebase-config FIRST, then app.js, then receipt.js, then initialize
await loadScript('firebase-config.js');
await loadScript('app.js');
await loadScript('receipt.js');

// DOMContentLoaded has already fired by now (module scripts are deferred),
// so call initializeFirebase directly
if (typeof window.initializeFirebase === 'function') {
  window.initializeFirebase();
}
