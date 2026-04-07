/*
 * openPod Tagger - Audio file tagger using acoustic fingerprinting
 * Copyright (C) 2026 Barış Atasoy
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
const { app } = require('electron');

// Force disable sandbox on Linux (fixes DEB package)
if (process.platform === 'linux') {
    app.commandLine.appendSwitch('no-sandbox');
    app.commandLine.appendSwitch('disable-gpu-sandbox');
    app.commandLine.appendSwitch('disable-zygote-sandbox');
}

const {  BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const jsmediatags = require('jsmediatags');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const Store = require('electron-store');
const fetch = require('node-fetch');
const NodeID3 = require('node-id3');
 
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const { execSync } = require('child_process');



if (process.platform === 'linux') {
    const { app } = require('electron');
    app.commandLine.appendSwitch('no-sandbox');
    app.commandLine.appendSwitch('disable-gpu-sandbox');
}


// Check for required dependencies
function checkDependencies() {
    try {
        execSync('which fpcalc', { stdio: 'ignore' });
        console.log('✓ fpcalc found');
    } catch (error) {
        console.warn('⚠️ fpcalc not found. Please install libchromaprint-tools:');
        console.warn('   sudo apt-get install libchromaprint-tools');
        
        // Show dialog to user (if in renderer process)
        if (require('electron').dialog) {
            require('electron').dialog.showMessageBox({
                type: 'warning',
                title: 'Missing Dependency',
                message: 'fpcalc (chromaprint) is not installed',
                detail: 'openPod Tagger requires libchromaprint-tools for acoustic fingerprinting.\n\nPlease run: sudo apt-get install libchromaprint-tools',
                buttons: ['OK']
            });
        }
    }
}

// Call after app ready
app.whenReady().then(() => {
    checkDependencies();
    createWindow();
});


// Helper function to get correct file path in production
function getResourcePath(relativePath) {
  if (isDev) {
    return path.join(__dirname, relativePath);
  }
  return path.join(process.resourcesPath, relativePath);
}

// Settings store
const store = new Store({
  defaults: {
    lastfmApiKey: '',
    geniusApiKey: '',
    acoustidApiKey: '',
    language: 'en'   
  }
});

let mainWindow;
let settingsWindow;

// Disable sandbox for compatibility
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');

// Supported audio formats
const SUPPORTED_FORMATS = ['.mp3', '.flac'];

// MusicBrainz API wrapper
class SimpleMusicBrainzAPI {
  constructor() {
    this.baseUrl = 'https://musicbrainz.org/ws/2';
    this.userAgent = 'MyMusicTagger/1.0.0 ( user@example.com )';
  }

  async searchRecording(query) {
    const url = `${this.baseUrl}/recording?query=${encodeURIComponent(query)}&fmt=json&limit=1`;
    
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': this.userAgent
        }
      });
      
      if (!response.ok) return { recordings: [] };
      
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('MusicBrainz API error:', error);
      return { recordings: [] };
    }
  }
}

const mbApi = new SimpleMusicBrainzAPI();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
    }
  });

  mainWindow.loadFile('index.html');
  
  // Get current language for menu
  const currentLang = store.get('language', 'en');
  
  // Menu translations
  const menuLabels = {
    en: { file: 'File', settings: 'Settings', view: 'View', reload: 'Reload', forceReload: 'Force Reload', toggleDevTools: 'Toggle Developer Tools', resetZoom: 'Reset Zoom', zoomIn: 'Zoom In', zoomOut: 'Zoom Out', toggleFullscreen: 'Toggle Fullscreen', quit: 'Quit' },
    tr: { file: 'Dosya', settings: 'Ayarlar', view: 'Görünüm', reload: 'Yenile', forceReload: 'Zorla Yenile', toggleDevTools: 'Geliştirici Araçlarını Aç/Kapat', resetZoom: 'Yakınlaştırmayı Sıfırla', zoomIn: 'Yakınlaştır', zoomOut: 'Uzaklaştır', toggleFullscreen: 'Tam Ekran Aç/Kapat', quit: 'Çıkış' },
    de: { file: 'Datei', settings: 'Einstellungen', view: 'Ansicht', reload: 'Neu laden', forceReload: 'Erzwingen', toggleDevTools: 'Entwicklertools', resetZoom: 'Zoom zurücksetzen', zoomIn: 'Vergrößern', zoomOut: 'Verkleinern', toggleFullscreen: 'Vollbild', quit: 'Beenden' },
    es: { file: 'Archivo', settings: 'Configuración', view: 'Ver', reload: 'Recargar', forceReload: 'Forzar recarga', toggleDevTools: 'Alternar herramientas de desarrollo', resetZoom: 'Restablecer zoom', zoomIn: 'Acercar', zoomOut: 'Alejar', toggleFullscreen: 'Pantalla completa', quit: 'Salir' },
    fr: { file: 'Fichier', settings: 'Paramètres', view: 'Vue', reload: 'Recharger', forceReload: 'Recharger forcément', toggleDevTools: 'Outils de développement', resetZoom: 'Réinitialiser le zoom', zoomIn: 'Zoom avant', zoomOut: 'Zoom arrière', toggleFullscreen: 'Plein écran', quit: 'Quitter' }
  };
  
  const labels = menuLabels[currentLang] || menuLabels.en;
  
  const menuTemplate = [
    {
      label: labels.file,
      submenu: [
        {
          label: labels.settings,
          click: () => openSettingsWindow(),
          accelerator: 'CmdOrCtrl+,'
        },
        { type: 'separator' },
        { role: 'quit', label: labels.quit }
      ]
    },
    {
      label: labels.view,
      submenu: [
        { role: 'reload', label: labels.reload },
        { role: 'forcereload', label: labels.forceReload },
        { role: 'toggledevtools', label: labels.toggleDevTools },
        { type: 'separator' },
        { role: 'resetzoom', label: labels.resetZoom },
        { role: 'zoomin', label: labels.zoomIn },
        { role: 'zoomout', label: labels.zoomOut },
        { type: 'separator' },
        { role: 'togglefullscreen', label: labels.toggleFullscreen }
      ]
    }
  ];
  
  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
}


function openSettingsWindow() {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.focus();
        return;
    }
    
    settingsWindow = new BrowserWindow({
        width: 550,
        height: 500,
        parent: mainWindow,
        modal: true,
        show: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });
    
    const settingsPath = path.join(__dirname, 'settings.html');
    console.log('Loading settings from:', settingsPath);
    
    settingsWindow.loadFile(settingsPath).catch(err => {
        console.error('Failed to load settings.html:', err);
    });
    
    settingsWindow.once('ready-to-show', () => {
        if (settingsWindow && !settingsWindow.isDestroyed()) {
            settingsWindow.show();
        }
    });
    
    settingsWindow.on('closed', () => {
        settingsWindow = null;
    });
}
// Scan directory for audio files
// Fast scan - only get filenames and check if tags exist quickly
async function scanDirectory(directoryPath) {
  console.log(`Starting scan of: ${directoryPath}`);
  const startTime = Date.now();
  const files = [];
  
  async function scan(dir) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await scan(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (SUPPORTED_FORMATS.includes(ext)) {
            files.push({
              path: fullPath,
              name: entry.name,
              format: ext.substring(1),
              hasTags: false,
              tags: {}
            });
          }
        }
      }
    } catch (error) {
      console.error(`Error scanning ${dir}:`, error);
    }
  }
  
  await scan(directoryPath);
  console.log(`Scan found ${files.length} files in ${Date.now() - startTime}ms`);
  return files;
}

// Quick tag check - much faster than full read
function quickTagCheck(filePath) {
  return new Promise((resolve) => {
    // Use a timeout to avoid hanging
    const timeout = setTimeout(() => resolve(false), 2000);
    
    jsmediatags.read(filePath, {
      onSuccess: (tag) => {
        clearTimeout(timeout);
        const hasTags = !!(tag.tags.title || tag.tags.artist || tag.tags.album);
        resolve(hasTags);
      },
      onError: () => {
        clearTimeout(timeout);
        resolve(false);
      }
    });
  });
}
// Read basic tags from audio file
function readTags(filePath) {
  return new Promise((resolve) => {
    jsmediatags.read(filePath, {
      onSuccess: (tag) => {
        const hasTags = !!(tag.tags.title || tag.tags.artist || tag.tags.album);
        resolve({ hasTags, data: tag.tags });
      },
      onError: () => {
        resolve({ hasTags: false, data: {} });
      }
    });
  });
}

// Read detailed tags including cover art and lyrics - IMPROVED VERSION
// Read detailed tags including cover art (FAST VERSION - no lyrics waiting)
async function readDetailedTags(filePath) {
  return new Promise((resolve) => {
    jsmediatags.read(filePath, {
      onSuccess: (tag) => {
        const tags = {};
        const picture = tag.tags.picture;
        let coverArt = null;
        
        // Extract all common tags
        if (tag.tags.title) tags.title = tag.tags.title;
        if (tag.tags.artist) tags.artist = tag.tags.artist;
        if (tag.tags.album) tags.album = tag.tags.album;
        if (tag.tags.year) tags.year = tag.tags.year;
        if (tag.tags.track) tags.track = tag.tags.track;
        if (tag.tags.genre) tags.genre = tag.tags.genre;
        if (tag.tags.comment) tags.comment = tag.tags.comment.text || tag.tags.comment;
        if (tag.tags.composer) tags.composer = tag.tags.composer;
        if (tag.tags.lyricist) tags.lyricist = tag.tags.lyricist;
        if (tag.tags.albumArtist) tags.albumArtist = tag.tags.albumArtist;
        if (tag.tags.disk) tags.disk = tag.tags.disk;
        
        // Check for lyrics in tags (fast, no external calls)
        let hasLyrics = false;
        if (tag.tags.lyrics || tag.tags.LYRICS || tag.tags.uslt || tag.tags.USLT) {
          hasLyrics = true;
          tags.lyrics = tag.tags.lyrics || tag.tags.LYRICS || tag.tags.uslt?.text || tag.tags.USLT?.text;
        }
        
        // Extract cover art if present
        if (picture && picture.data) {
          try {
            let base64String = '';
            for (let i = 0; i < picture.data.length; i++) {
              base64String += String.fromCharCode(picture.data[i]);
            }
            coverArt = `data:${picture.format};base64,${btoa(base64String)}`;
          } catch (error) {
            console.error('Error extracting cover art:', error);
          }
        }
        
        resolve({
          success: true,
          tags: tags,
          coverArt: coverArt,
          hasLyrics: hasLyrics
        });
      },
      onError: (error) => {
        console.error('Error reading tags:', error);
        resolve({
          success: false,
          tags: {},
          coverArt: null,
          hasLyrics: false,
          error: error.type
        });
      }
    });
  });
}
 
 
// Read FLAC lyrics using metaflac command
async function readFLACLyrics(filePath) {
  return new Promise((resolve) => {
    const command = `metaflac --list "${filePath}" | grep -i "LYRICS=" | head -1`;
    
    exec(command, (error, stdout, stderr) => {
      if (error || !stdout) {
        resolve(null);
        return;
      }
      
      // Extract lyrics from output format: "    comment[7]: LYRICS=I wanna run..."
      const match = stdout.match(/LYRICS=(.+)$/m);
      if (match && match[1]) {
        // Unescape newlines if they were escaped
        let lyrics = match[1].replace(/\\n/g, '\n');
        resolve(lyrics);
      } else {
        resolve(null);
      }
    });
  });
}

 
// Write cover art to FLAC - PRESERVING existing tags
async function writeCoverArtToFLAC(filePath, coverBuffer) {
  const tempCoverPath = `/tmp/cover_${Date.now()}.jpg`;
  
  return new Promise((resolve, reject) => {
    require('fs').writeFile(tempCoverPath, coverBuffer, (err) => {
      if (err) {
        reject(err);
        return;
      }
      
      const dir = path.dirname(filePath);
      const filename = path.basename(filePath);
      
      // Remove old pictures but preserve other tags
      const command = `cd "${dir}" && metaflac --remove --block-type=PICTURE "${filename}" 2>/dev/null || true && metaflac --import-picture-from="${tempCoverPath}" "${filename}" && rm "${tempCoverPath}"`;
      
      exec(command, (error, stdout, stderr) => {
        try { require('fs').unlinkSync(tempCoverPath); } catch(e) {}
        
        if (error) {
          console.error('FLAC cover art error:', error);
          reject(error);
        } else {
          console.log('✓ Cover art saved to FLAC while preserving other tags');
          resolve(true);
        }
      });
    });
  });
}
// Write cover art to MP3 file


// Write cover art to MP3 file - Using node-id3
// Write cover art to MP3 - Using node-id3 (preserves all tags)
async function writeCoverArtToMP3(filePath, coverBuffer, coverFormat) {
  return new Promise((resolve, reject) => {
    try {
      // Read existing tags first
      const existingTags = NodeID3.read(filePath);
      
      // Prepare the image object
      const imageData = {
        mime: coverFormat || 'image/jpeg',
        type: {
          id: 3,
          name: 'front cover'
        },
        description: 'Cover',
        imageBuffer: coverBuffer
      };
      
      // Merge existing tags with new cover art
      const tagsToWrite = {
        title: existingTags.title,
        artist: existingTags.artist,
        album: existingTags.album,
        year: existingTags.year,
        trackNumber: existingTags.trackNumber,
        genre: existingTags.genre,
        comment: existingTags.comment,
        composer: existingTags.composer,
        image: imageData
      };
      
      // Also preserve lyrics if they exist
      if (existingTags.unsynchronisedLyrics) {
        tagsToWrite.unsynchronisedLyrics = existingTags.unsynchronisedLyrics;
      }
      
      // Remove undefined values
      Object.keys(tagsToWrite).forEach(key => {
        if (tagsToWrite[key] === undefined || tagsToWrite[key] === null) {
          delete tagsToWrite[key];
        }
      });
      
      // Write back all tags
      const success = NodeID3.update(tagsToWrite, filePath);
      if (success) {
        console.log('✓ Cover art saved while preserving all tags');
        resolve(true);
      } else {
        reject(new Error('Failed to write tags'));
      }
    } catch (error) {
      console.error('Error writing cover art:', error);
      reject(error);
    }
  });
}



// Write lyrics to MP3 file using helper
async function writeLyricsToMP3(filePath, lyrics, isSynced = false) {
  return await updateMP3Tags(filePath, {
    unsynchronisedLyrics: {
      language: 'eng',
      text: lyrics
    }
  });
}

// Apply cover art to all files in a folder
async function applyCoverArtToAllFiles(folderPath, coverBuffer, coverFormat) {
  const files = await scanDirectory(folderPath);
  const results = [];
  
  for (const file of files) {
    try {
      if (file.format === 'mp3') {
        await writeCoverArtToMP3(file.path, coverBuffer, coverFormat);
      } else if (file.format === 'flac') {
        await writeCoverArtToFLAC(file.path, coverBuffer);
      }
      results.push({ file: file.name, success: true });
    } catch (error) {
      results.push({ file: file.name, success: false, error: error.message });
    }
  }
  
  return results;
}

// Search MusicBrainz for track info
async function searchMusicBrainz(filename) {
  const trackName = path.basename(filename, path.extname(filename))
    .replace(/[_-]/g, ' ')
    .replace(/^\d+\s*/, '');
  
  try {
    const result = await mbApi.searchRecording(trackName);
    
    if (result.recordings && result.recordings.length > 0) {
      const recording = result.recordings[0];
      const release = recording.releases ? recording.releases[0] : null;
      
      let artist = '';
      if (recording['artist-credit'] && recording['artist-credit'][0]) {
        artist = recording['artist-credit'][0].name;
      }
      
      return {
        title: recording.title || trackName,
        artist: artist || 'Unknown Artist',
        album: release ? release.title : 'Unknown Album',
        year: release && release['first-release-date'] 
          ? release['first-release-date'].substring(0, 4) : '',
        trackNumber: recording.number || '1',
        success: true
      };
    }
  } catch (error) {
    console.error(`Error searching for ${filename}:`, error);
  }
  
  return { success: false };
}

// Fetch cover art from MusicBrainz Cover Art Archive
async function fetchCoverArt(artist, album) {
  try {
    const searchUrl = `https://musicbrainz.org/ws/2/release?query=artist:${encodeURIComponent(artist)}%20AND%20release:${encodeURIComponent(album)}&fmt=json&limit=1`;
    
    const searchResponse = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'MyMusicTagger/1.0.0 ( user@example.com )'
      }
    });
    
    if (!searchResponse.ok) return null;
    
    const searchData = await searchResponse.json();
    
    if (!searchData.releases || searchData.releases.length === 0) return null;
    
    const releaseId = searchData.releases[0].id;
    const coverUrl = `https://coverartarchive.org/release/${releaseId}/front`;
    
    const coverResponse = await fetch(coverUrl);
    
    if (coverResponse.ok) {
      const coverArrayBuffer = await coverResponse.arrayBuffer();
      const coverBuffer = Buffer.from(coverArrayBuffer);
      const contentType = coverResponse.headers.get('content-type');
      
      return {
        data: coverBuffer,
        format: contentType,
        source: 'MusicBrainz'
      };
    }
  } catch (error) {
    console.error('Error fetching cover art:', error);
  }
  
  return null;
}

// Fetch cover art from Last.fm API
async function fetchCoverArtFromLastFM(artist, album) {
  const API_KEY = store.get('lastfmApiKey');
  
  if (!API_KEY) {
    return null;
  }
  
  try {
    const url = `https://ws.audioscrobbler.com/2.0/?method=album.getinfo&api_key=${API_KEY}&artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}&format=json`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.album && data.album.image && data.album.image.length > 0) {
      const images = data.album.image;
      let largestImage = null;
      
      for (const img of images) {
        if (img['#text'] && img['#text'].startsWith('http')) {
          if (img.size === 'extralarge' || img.size === 'mega') {
            largestImage = img['#text'];
            break;
          }
          largestImage = img['#text'];
        }
      }
      
      if (largestImage) {
        const imageResponse = await fetch(largestImage);
        
        if (imageResponse.ok) {
          const imageArrayBuffer = await imageResponse.arrayBuffer();
          const imageBuffer = Buffer.from(imageArrayBuffer);
          
          return {
            data: imageBuffer,
            format: imageResponse.headers.get('content-type') || 'image/jpeg',
            source: 'Last.fm'
          };
        }
      }
    }
  } catch (error) {
    console.error('Error fetching from Last.fm:', error);
  }
  
  return null;
}

// Search for cover art
async function searchAndFetchCoverArt(filePath, currentTags) {
  let artist = currentTags.artist || currentTags.artist_name;
  let album = currentTags.album || currentTags.album_name;
  
  if (!artist || !album) {
    const filename = path.basename(filePath, path.extname(filePath));
    let parts = filename.split(/[-_–]/);
    parts = parts.map(p => p.trim());
    
    if (parts.length >= 2) {
      artist = artist || parts[0];
      album = album || parts[1];
    }
    
    if (album) {
      album = album.replace(/^\d+\s*/, '');
    }
  }
  
  if (!artist || !album) {
    return { success: false, error: 'Could not determine artist and album from tags or filename' };
  }
  
  console.log(`Searching cover art for: "${artist}" - "${album}"`);
  
  let coverArt = await fetchCoverArtFromLastFM(artist, album);
  let source = 'Last.fm';
  
  if (!coverArt) {
    console.log('Not found on Last.fm, trying MusicBrainz...');
    coverArt = await fetchCoverArt(artist, album);
    source = 'MusicBrainz';
  }
  
  if (coverArt) {
    try {
      if (filePath.endsWith('.flac')) {
        await writeCoverArtToFLAC(filePath, coverArt.data);
      } else if (filePath.endsWith('.mp3')) {
        await writeCoverArtToMP3(filePath, coverArt.data, coverArt.format);
      }
      return { 
        success: true, 
        message: `Cover art added successfully from ${source}!`,
        source: source,
        coverData: coverArt.data,
        coverFormat: coverArt.format
      };
    } catch (error) {
      console.error('Error writing cover art:', error);
      return { success: false, error: `Failed to write cover art: ${error.message}` };
    }
  }
  
  return { success: false, error: `No cover art found for "${artist} - ${album}"` };
}

// ============ LYRICS FUNCTIONS ============

// Fetch lyrics from LRCLIB (free, no API key required)
async function fetchLyricsFromLRCLIB(artist, title) {
  try {
    const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(`${artist} ${title}`)}`;
    const searchResponse = await fetch(searchUrl);
    
    if (!searchResponse.ok) return null;
    
    const searchData = await searchResponse.json();
    
    if (!searchData.length) return null;
    
    const bestMatch = searchData.find(
      song => song.artistName.toLowerCase() === artist.toLowerCase() ||
              song.trackName.toLowerCase() === title.toLowerCase()
    ) || searchData[0];
    
    const detailsUrl = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(bestMatch.artistName)}&track_name=${encodeURIComponent(bestMatch.trackName)}`;
    const detailsResponse = await fetch(detailsUrl);
    
    if (!detailsResponse.ok) return null;
    
    const lyricsData = await detailsResponse.json();
    
    return {
      plainLyrics: lyricsData.plainLyrics || null,
      syncedLyrics: lyricsData.syncedLyrics || null
    };
  } catch (error) {
    console.error('Error fetching from LRCLIB:', error.message);
    return null;
  }
}

// Fetch lyrics from ChartLyrics (free fallback)
async function fetchLyricsFromChartLyrics(artist, title) {
  try {
    const url = `https://api.chartlyrics.com/apiv1.asmx/SearchLyricDirect?artist=${encodeURIComponent(artist)}&song=${encodeURIComponent(title)}`;
    const response = await fetch(url);
    const text = await response.text();
    
    const lyricsMatch = text.match(/<Lyric>([\s\S]*?)<\/Lyric>/);
    if (lyricsMatch && lyricsMatch[1]) {
      return lyricsMatch[1]
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .trim();
    }
    
    return null;
  } catch (error) {
    console.error('Error fetching from ChartLyrics:', error.message);
    return null;
  }
}

// Fetch lyrics from Genius API (requires API key)
async function fetchLyricsFromGenius(artist, title) {
  const GENIUS_API_KEY = store.get('geniusApiKey');
  
  if (!GENIUS_API_KEY) {
    return null;
  }
  
  try {
    const searchUrl = `https://api.genius.com/search?q=${encodeURIComponent(`${artist} ${title}`)}`;
    const searchResponse = await fetch(searchUrl, {
      headers: {
        'Authorization': `Bearer ${GENIUS_API_KEY}`
      }
    });
    
    if (!searchResponse.ok) return null;
    
    const searchData = await searchResponse.json();
    
    if (!searchData.response.hits.length) return null;
    
    const songPath = searchData.response.hits[0].result.path;
    const songUrl = `https://genius.com${songPath}`;
    
    const pageResponse = await fetch(songUrl);
    const html = await pageResponse.text();
    
    const lyricsMatch = html.match(/<div[^>]*data-lyrics-container="true"[^>]*>([\s\S]*?)<\/div>/gi);
    
    if (!lyricsMatch) return null;
    
    let lyrics = '';
    for (const match of lyricsMatch) {
      const cleanText = match.replace(/<[^>]*>/g, '');
      lyrics += cleanText + '\n';
    }
    
    lyrics = lyrics
      .replace(/\[[^\]]*\]/g, '\n$&\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    
    return lyrics || null;
  } catch (error) {
    console.error('Error fetching from Genius:', error.message);
    return null;
  }
}

// Main lyrics fetching function
async function fetchLyrics(artist, title) {
  if (!artist || !title) {
    return { success: false, error: 'Artist and title are required' };
  }
  
  console.log(`Fetching lyrics for: ${artist} - ${title}`);
  
  // Try LRCLIB first
  let lyricsData = await fetchLyricsFromLRCLIB(artist, title);
  if (lyricsData && (lyricsData.plainLyrics || lyricsData.syncedLyrics)) {
    return {
      success: true,
      lyrics: lyricsData.plainLyrics || lyricsData.syncedLyrics,
      source: 'LRCLIB',
      synced: !!lyricsData.syncedLyrics
    };
  }
  
  // Try ChartLyrics
  let lyrics = await fetchLyricsFromChartLyrics(artist, title);
  if (lyrics) {
    return {
      success: true,
      lyrics: lyrics,
      source: 'ChartLyrics',
      synced: false
    };
  }
  
  // Try Genius last
  lyrics = await fetchLyricsFromGenius(artist, title);
  if (lyrics) {
    return {
      success: true,
      lyrics: lyrics,
      source: 'Genius',
      synced: false
    };
  }
  
  return { success: false, error: 'No lyrics found for this song' };
}
 
 
// Write lyrics to MP3 - Using node-id3 (preserves all tags)
async function writeLyricsToFile(filePath, lyrics, isSynced = false) {
  return new Promise((resolve, reject) => {
    if (filePath.endsWith('.mp3')) {
      try {
        // Read existing tags
        const existingTags = NodeID3.read(filePath);
        
        // Merge existing tags with new lyrics
        const tagsToWrite = {
          title: existingTags.title,
          artist: existingTags.artist,
          album: existingTags.album,
          year: existingTags.year,
          trackNumber: existingTags.trackNumber,
          genre: existingTags.genre,
          comment: existingTags.comment,
          composer: existingTags.composer,
          unsynchronisedLyrics: {
            language: 'eng',
            text: lyrics
          }
        };
        
        // Also preserve cover art if it exists
        if (existingTags.image) {
          tagsToWrite.image = existingTags.image;
        }
        
        // Remove undefined values
        Object.keys(tagsToWrite).forEach(key => {
          if (tagsToWrite[key] === undefined || tagsToWrite[key] === null) {
            delete tagsToWrite[key];
          }
        });
        
        // Write back all tags
        const success = NodeID3.update(tagsToWrite, filePath);
        if (success) {
          console.log('✓ Lyrics saved while preserving all tags');
          resolve(true);
        } else {
          reject(new Error('Failed to write lyrics'));
        }
      } catch (error) {
        console.error('Error writing lyrics:', error);
        reject(error);
      }
    } 
    else if (filePath.endsWith('.flac')) {
      // FLAC handling remains the same
      const escapedLyrics = lyrics
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\$/g, '\\$')
        .replace(/`/g, '\\`')
        .replace(/\n/g, '\\n');
      
      const command = `metaflac --set-tag=LYRICS="${escapedLyrics}" "${filePath}"`;
      
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error('FLAC lyrics error:', error);
          reject(error);
        } else {
          console.log('✓ Lyrics saved to FLAC');
          resolve(true);
        }
      });
    } else {
      reject(new Error('Unsupported format: ' + path.extname(filePath)));
    }
  });
}


// Helper function to safely update MP3 tags without losing existing data
async function updateMP3Tags(filePath, newTags) {
  return new Promise((resolve, reject) => {
    try {
      // Read existing tags
      const existingTags = NodeID3.read(filePath);
      
      // Merge existing tags with new tags (new tags take precedence)
      const mergedTags = {
        title: newTags.title !== undefined ? newTags.title : existingTags.title,
        artist: newTags.artist !== undefined ? newTags.artist : existingTags.artist,
        album: newTags.album !== undefined ? newTags.album : existingTags.album,
        year: newTags.year !== undefined ? newTags.year : existingTags.year,
        trackNumber: newTags.trackNumber !== undefined ? newTags.trackNumber : existingTags.trackNumber,
        genre: newTags.genre !== undefined ? newTags.genre : existingTags.genre,
        comment: newTags.comment !== undefined ? newTags.comment : existingTags.comment,
        image: newTags.image !== undefined ? newTags.image : existingTags.image,
        unsynchronisedLyrics: newTags.unsynchronisedLyrics !== undefined ? newTags.unsynchronisedLyrics : existingTags.unsynchronisedLyrics
      };
      
      // Remove undefined values
      Object.keys(mergedTags).forEach(key => {
        if (mergedTags[key] === undefined) {
          delete mergedTags[key];
        }
      });
      
      NodeID3.write(mergedTags, filePath, (err) => {
        if (err) reject(err);
        else resolve(true);
      });
    } catch (error) {
      reject(error);
    }
  });
}

// Alternative FLAC lyrics writer using temp file
async function writeLyricsToFLACAlternative(filePath, lyrics) {
  const fsSync = require('fs');
  const tempFile = `/tmp/lyrics_${Date.now()}.txt`;
  
  return new Promise((resolve, reject) => {
    // Write lyrics to temp file
    fsSync.writeFile(tempFile, lyrics, 'utf8', (err) => {
      if (err) {
        reject(err);
        return;
      }
      
      const dir = path.dirname(filePath);
      const filename = path.basename(filePath);
      
      // Change to directory and import lyrics from file
      const command = `cd "${dir}" && metaflac --remove-tag=LYRICS "${filename}" 2>/dev/null ; metaflac --set-tag-from-file=LYRICS="${tempFile}" "${filename}" && rm "${tempFile}"`;
      
      exec(command, (error, stdout, stderr) => {
        try { fsSync.unlinkSync(tempFile); } catch(e) {}
        
        if (error) {
          console.error('Alternative FLAC lyrics error:', error);
          reject(error);
        } else {
          resolve(true);
        }
      });
    });
  });
}


// Write tags to file

// Also update the regular writeTags function for consistency
async function writeTags(filePath, tags) {
  return new Promise((resolve, reject) => {
    if (filePath.endsWith('.mp3')) {
      try {
        // Read existing tags first
        const existingTags = NodeID3.read(filePath);
        
        // Merge with new tags
        const tagsToWrite = {
          title: tags.title || existingTags.title,
          artist: tags.artist || existingTags.artist,
          album: tags.album || existingTags.album,
          year: tags.year || existingTags.year,
          trackNumber: tags.trackNumber || existingTags.trackNumber,
          genre: existingTags.genre,
          comment: existingTags.comment,
          image: existingTags.image,
          unsynchronisedLyrics: existingTags.unsynchronisedLyrics
        };
        
        // Remove undefined values
        Object.keys(tagsToWrite).forEach(key => {
          if (tagsToWrite[key] === undefined || tagsToWrite[key] === null) {
            delete tagsToWrite[key];
          }
        });
        
        const success = NodeID3.update(tagsToWrite, filePath);
        if (success) {
          console.log('✓ Tags saved successfully');
          resolve(true);
        } else {
          reject(new Error('Failed to write tags'));
        }
      } catch (error) {
        console.error('Error writing tags:', error);
        reject(error);
      }
    } 
    else if (filePath.endsWith('.flac')) {
      const commands = [
        `metaflac --remove-tag=TITLE --remove-tag=ARTIST --remove-tag=ALBUM --remove-tag=DATE --remove-tag=TRACKNUMBER "${filePath}" 2>/dev/null || true`,
        `metaflac --set-tag=TITLE="${tags.title.replace(/"/g, '\\"')}" "${filePath}"`,
        `metaflac --set-tag=ARTIST="${tags.artist.replace(/"/g, '\\"')}" "${filePath}"`,
        `metaflac --set-tag=ALBUM="${tags.album.replace(/"/g, '\\"')}" "${filePath}"`,
        `metaflac --set-tag=DATE="${tags.year}" "${filePath}"`,
        `metaflac --set-tag=TRACKNUMBER="${tags.trackNumber}" "${filePath}"`
      ];
      
      execPromise(commands.join(' && '))
        .then(() => resolve(true))
        .catch(reject);
    } else {
      reject(new Error('Unsupported format'));
    }
  });
}
// ============ ACOUSTIC FINGERPRINTING FUNCTIONS ============

// Generate fingerprint using fpcalc
async function generateFingerprint(filePath) {
  return new Promise((resolve, reject) => {
    exec(`fpcalc -json "${filePath}"`, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`fpcalc failed: ${error.message}. Install with: sudo apt-get install libchromaprint-tools`));
        return;
      }
      
      try {
        const result = JSON.parse(stdout);
        resolve({
          duration: Math.round(result.duration),
          fingerprint: result.fingerprint
        });
      } catch (e) {
        reject(new Error('Failed to parse fpcalc output'));
      }
    });
  });
}

// Look up fingerprint on AcoustID
// Look up fingerprint on AcoustID
async function lookupAcoustid(fingerprint, duration) {
  const apiKey = store.get('acoustidApiKey');
  
  if (!apiKey) {
    throw new Error('AcoustID API key not configured. Please add it in Settings.');
  }
  
  const url = `https://api.acoustid.org/v2/lookup?client=${apiKey}&meta=recordings+releases&duration=${duration}&fingerprint=${encodeURIComponent(fingerprint)}`;
  
  console.log('Calling AcoustID API...');
  const response = await fetch(url);
  const data = await response.json();
  
  console.log('AcoustID response status:', data.status);
  
  if (data.status !== 'ok') {
    throw new Error(`AcoustID lookup failed: ${data.status}`);
  }
  
  return data.results || [];
}

// Identify file using acoustic fingerprint
// Identify file using acoustic fingerprint
// Identify file using acoustic fingerprint - FULLY FIXED
async function identifyFileByAcoustic(filePath) {
  console.log(`Generating fingerprint for: ${filePath}`);
  
  try {
    // Generate fingerprint
    const { duration, fingerprint } = await generateFingerprint(filePath);
    console.log(`Fingerprint generated, duration: ${duration}s`);
    
    // Look up on AcoustID
    const results = await lookupAcoustid(fingerprint, duration);
    
    if (!results || results.length === 0) {
      return { success: false, error: 'No matches found in AcoustID database' };
    }
    
    // Process results to get clean list for user selection
    const matches = [];
    for (const result of results) {
      const score = result.score;
      if (!result.recordings || result.recordings.length === 0) continue;
      
      for (const recording of result.recordings) {
        try {
          // Get artist name safely
          let artist = 'Unknown';
          if (recording.artists && recording.artists[0] && recording.artists[0].name) {
            artist = recording.artists[0].name;
          } else if (recording['artist-credit'] && recording['artist-credit'][0] && recording['artist-credit'][0].name) {
            artist = recording['artist-credit'][0].name;
          }
          
          // Get album and year safely
          let album = 'Unknown';
          let year = '';
          if (recording.releases && recording.releases[0]) {
            const release = recording.releases[0];
            album = release.title || 'Unknown';
            
            // Safely extract year - handle multiple possible formats
            if (release.date) {
              if (typeof release.date === 'string') {
                year = release.date.substring(0, 4);
              } else if (typeof release.date === 'object' && release.date !== null) {
                // Try to get year from various possible object properties
                year = release.date.year || release.date['#text'] || '';
                if (year && typeof year !== 'string') year = String(year);
              }
            }
          }
          
          matches.push({
            recordingId: recording.id || '',
            title: recording.title || 'Unknown',
            artist: artist,
            album: album,
            year: year,
            score: score || 0,
            trackNumber: recording.track?.number || ''
          });
        } catch (err) {
          console.error('Error processing recording:', err);
          continue;
        }
      }
    }
    
    if (matches.length === 0) {
      return { success: false, error: 'No valid matches found' };
    }
    
    console.log(`Found ${matches.length} matches`);
    return { success: true, matches: matches.slice(0, 10) };
  } catch (error) {
    console.error('Acoustic identification error:', error);
    return { success: false, error: error.message };
  }
}

// Tag file with selected match from acoustic identification
async function tagFileWithSelection(filePath, selectedMatch) {
  try {
    const tags = {
      title: selectedMatch.title,
      artist: selectedMatch.artist,
      album: selectedMatch.album,
      year: selectedMatch.year,
      trackNumber: selectedMatch.trackNumber || '1'
    };
    
    await writeTags(filePath, tags);
    return { success: true, tags: tags };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
// ============ IPC HANDLERS ============
// Acoustic fingerprint IPC handlers
ipcMain.handle('identify-file-acoustic', async (event, filePath) => {
  return await identifyFileByAcoustic(filePath);
});

ipcMain.handle('tag-file-with-selection', async (event, filePath, selectedMatch) => {
  try {
    const tags = {
      title: selectedMatch.title,
      artist: selectedMatch.artist,
      album: selectedMatch.album,
      year: selectedMatch.year || '',
      trackNumber: selectedMatch.trackNumber || '1'
    };
    
    console.log('Tagging file with:', tags);
    await writeTags(filePath, tags);
    return { success: true, tags: tags };
  } catch (error) {
    console.error('Tagging error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return result.filePaths[0];
});

ipcMain.handle('scan-folder', async (event, folderPath) => {
  return await scanDirectory(folderPath);
});

ipcMain.handle('get-file-details', async (event, filePath) => {
  return await readDetailedTags(filePath);
});

ipcMain.handle('get-flac-lyrics', async (event, filePath) => {
  if (filePath.endsWith('.flac')) {
    return await readFLACLyrics(filePath);
  }
  return null;
});

ipcMain.handle('tag-file', async (event, filePath, filename) => {
  const musicBrainzData = await searchMusicBrainz(filename);
  
  if (musicBrainzData.success) {
    try {
      await writeTags(filePath, musicBrainzData);
      return { success: true, tags: musicBrainzData };
    } catch (error) {
      console.error('Error writing tags:', error);
      return { success: false, error: error.message };
    }
  }
  
  return { success: false, error: 'Not found in MusicBrainz' };
});

ipcMain.handle('tag-all-files', async (event, files) => {
  const results = [];
  
  for (const file of files) {
    const musicBrainzData = await searchMusicBrainz(file.name);
    
    if (musicBrainzData.success) {
      try {
        await writeTags(file.path, musicBrainzData);
        results.push({
          file: file.name,
          success: true,
          tags: musicBrainzData
        });
      } catch (error) {
        results.push({
          file: file.name,
          success: false,
          error: error.message
        });
      }
    } else {
      results.push({
        file: file.name,
        success: false,
        error: 'Not found in MusicBrainz'
      });
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  return results;
});

ipcMain.handle('fetch-cover-art', async (event, filePath, tags) => {
  return await searchAndFetchCoverArt(filePath, tags);
});
ipcMain.handle('quick-tag-check', async (event, filePath) => {
  return await quickTagCheck(filePath);
});
ipcMain.handle('apply-cover-to-all', async (event, folderPath, coverData, coverFormat) => {
  return await applyCoverArtToAllFiles(folderPath, coverData, coverFormat);
});

ipcMain.handle('get-settings', async () => {
  return {
    lastfmApiKey: store.get('lastfmApiKey'),
    geniusApiKey: store.get('geniusApiKey'),
    acoustidApiKey: store.get('acoustidApiKey'),
    language: store.get('language', 'en')
  };
});

ipcMain.handle('save-settings', async (event, settings) => {
  store.set('lastfmApiKey', settings.lastfmApiKey);
  store.set('geniusApiKey', settings.geniusApiKey);
  store.set('acoustidApiKey', settings.acoustidApiKey);
  store.set('language', settings.language);
  return { success: true };
});

// Lyrics IPC handlers
ipcMain.handle('fetch-lyrics', async (event, artist, title) => {
  return await fetchLyrics(artist, title);
});

// Debug function to test lyrics detection
ipcMain.handle('test-lyrics-detection', async (event, filePath) => {
  const result = await readFLACLyrics(filePath);
  console.log(`Test lyrics for ${filePath}:`, result);
  return { lyrics: result };
});

ipcMain.handle('write-lyrics-to-file', async (event, filePath, lyrics, isSynced) => {
  try {
    // Try primary method
    await writeLyricsToFile(filePath, lyrics, isSynced);
    return { success: true };
  } catch (error) {
    console.error('Primary lyrics write failed:', error);
    
    // Try alternative method for FLAC
    if (filePath.endsWith('.flac')) {
      try {
        await writeLyricsToFLACAlternative(filePath, lyrics);
        return { success: true, method: 'alternative' };
      } catch (error2) {
        console.error('Alternative lyrics write also failed:', error2);
        return { success: false, error: error2.message };
      }
    }
    
    return { success: false, error: error.message };
  }
});

// Add restart handler
ipcMain.handle('restart-app', () => {
  app.relaunch();
  app.exit();
});




app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

// Watch for language changes
store.onDidChange('language', (newValue, oldValue) => {
  if (newValue !== oldValue) {
    // Recreate window to update menu
    mainWindow.reload();
  }
});