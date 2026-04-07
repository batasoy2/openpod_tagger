// i18n.js - Internationalization module
const Store = require('electron-store');
const fs = require('fs');
const path = require('path');

const store = new Store();
let currentLocale = store.get('language', 'en');
let translations = {};

function loadTranslations(locale) {
  try {
    // For renderer process, we need to use IPC or read differently
    let fileContent;
    
    if (typeof window !== 'undefined' && window.require) {
      // In renderer process, use fs from electron
      const fs = window.require('fs');
      const filePath = path.join(__dirname, 'locales', `${locale}.json`);
      if (fs.existsSync(filePath)) {
        fileContent = fs.readFileSync(filePath, 'utf8');
      }
    } else {
      // In main process
      const filePath = path.join(__dirname, 'locales', `${locale}.json`);
      if (fs.existsSync(filePath)) {
        fileContent = fs.readFileSync(filePath, 'utf8');
      }
    }
    
    if (fileContent) {
      translations = JSON.parse(fileContent);
      return true;
    } else {
      console.warn(`Translation file not found for locale: ${locale}`);
      if (locale !== 'en') {
        return loadTranslations('en');
      }
      return false;
    }
  } catch (error) {
    console.error(`Failed to load translations for ${locale}:`, error);
    if (locale !== 'en') {
      return loadTranslations('en');
    }
    return false;
  }
}

function t(key, params = {}) {
  const keys = key.split('.');
  let value = translations;
  
  for (const k of keys) {
    if (value && value[k] !== undefined) {
      value = value[k];
    } else {
      return key;
    }
  }
  
  if (typeof value === 'string' && Object.keys(params).length > 0) {
    return value.replace(/\{(\w+)\}/g, (match, paramKey) => {
      return params[paramKey] !== undefined ? params[paramKey] : match;
    });
  }
  
  return value;
}

function getCurrentLocale() {
  return currentLocale;
}

function setLocale(locale) {
  if (loadTranslations(locale)) {
    currentLocale = locale;
    store.set('language', locale);
    return true;
  }
  return false;
}

function getAvailableLocales() {
  return ['en', 'tr', 'de', 'es', 'fr'];
}

// Load initial translations
loadTranslations(currentLocale);

// Export for both main and renderer
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { t, getCurrentLocale, setLocale, loadTranslations, getAvailableLocales };
}