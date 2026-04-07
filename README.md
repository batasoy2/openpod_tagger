# openPod Tagger

<p align="center">
  <img src="assets/icon.png" alt="openPod Tagger Logo" width="128">
</p>

<p align="center">
  <strong>Automatically tag MP3 and FLAC files using acoustic fingerprinting</strong>
  <p>Note: Though this is an Electron app, I've not tested it in Windows, and due to metaflac CLI tool I used, it would not run on Windows. Mac OS? Don't know. Never tried, never will.</p>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#usage">Usage</a> •
  <a href="#building">Building</a> •
  <a href="#license">License</a>
</p>

## Features

- 🎵 **Acoustic Fingerprinting** - Identifies songs by their actual audio content using AcoustID (not filename!)
- 📝 **Automatic Tagging** - Writes metadata (title, artist, album, year, track number) to your files
- 🖼️ **Cover Art** - Fetches and embeds album artwork from Last.fm and MusicBrainz
- 📃 **Lyrics** - Downloads and saves lyrics from LRCLIB, ChartLyrics, and Genius
- 🌍 **Multi-language** - Supports English, Türkçe, Deutsch, Español, Français
- 🐧 **Linux Native** - Available as DEB package and AppImage
- ⚡ **Fast & Lightweight** - Built with Electron for a responsive desktop experience


## Installation

For .deb package: npx electron-builder --linux appimage -c.electronVersion=27.0.0
AppImage: npx electron-builder --linux deb -c.electronVersion=27.0.0 

### Install from source:

# Clone the repository
git clone https://github.com/batasoy2/openpod_tagger.git
cd openpod_tagger

# Install dependencies
npm install

# Run the app
npm start

API Keys (Free)

The following API keys are optional but recommended for full functionality:
Service	Purpose	Get API Key
AcoustID	Song identification (required)	Get free key
Last.fm	Cover art	Get free key
Genius	Lyrics	Get free key
Usage
Quick Start

    Launch openPod Tagger

    Go to File → Settings and add your API keys

    Select a folder containing MP3/FLAC files

    Click "Identify" on any untagged file

    Choose the correct match from the list

    The file is automatically tagged!

Features in Detail
🔍 Acoustic Identification

    Uses fpcalc to generate audio fingerprints

    Queries AcoustID database for matches

    Shows confidence scores for each match

    Works even with filenames like track01.mp3

🖼️ Cover Art

    Automatically fetches from Last.fm (high quality)

    Falls back to MusicBrainz Cover Art Archive

    Apply cover to single file or entire folder

📃 Lyrics

    Fetches from LRCLIB (free, no API key)

    Falls back to ChartLyrics and Genius

    Saves lyrics directly to file tags



### Ubuntu / Debian (DEB Package)

```bash
# Download the .deb file from releases
sudo dpkg -i openpod-tagger_1.0.0_amd64.deb
sudo apt-get install -f  # Fix dependencies
**


