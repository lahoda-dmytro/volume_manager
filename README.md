# Volume Manager

**Volume Manager** is an open-source browser extension designed for granular audio control within the browsing environment. This tool enables independent volume adjustment for individual tabs, allowing users to amplify or attenuate audio output on a per-tab basis without affecting global system settings.

## Limitations
Due to specific audio stream implementations and Content Security Policies (CSP), this extension is currently **incompatible** with:
* Spotify
* SoundCloud

## Installation 
```bash
# install dependencies
npm install

# build for production
npm run build

# build for development (watch mode)
npm run dev
