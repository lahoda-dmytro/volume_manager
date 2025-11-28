import { Message, messageType } from './types';

interface MediaElementWithSource extends HTMLMediaElement {
    _source?: MediaElementAudioSourceNode;
    _hooked?: boolean;
    _fallbackMode?: boolean;
    _locked?: boolean;
}

let audioCtx: AudioContext | null = null;
let gainNode: GainNode | null = null;
let currentVolume = 1;

// Capture native volume setter/getter to bypass our own lock
const nativeVolumeSetter = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume')?.set;
const nativeVolumeGetter = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume')?.get;

function applyVolume(element: HTMLMediaElement, volume: number) {
    if (nativeVolumeSetter) {
        nativeVolumeSetter.call(element, volume);
    } else {
        element.volume = volume;
    }
}

function initAudioContext() {
    if (!audioCtx) {
        audioCtx = new AudioContext();
        gainNode = audioCtx.createGain();
        gainNode.connect(audioCtx.destination);
        gainNode.gain.value = currentVolume;
    } else if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

function isCrossOrigin(url: string): boolean {
    if (!url) return false;
    try {
        const origin = new URL(url).origin;
        return origin !== window.location.origin;
    } catch (e) {
        return false;
    }
}

function shouldForceFallback(): boolean {
    return window.location.hostname.includes('tiktok.com') || window.location.hostname.includes('meet.google.com');
}

function shouldLockVolume(): boolean {
    // Only lock volume for Google Meet because it aggressively fights back
    // TikTok works better with "Last One Wins" (no lock)
    return window.location.hostname.includes('meet.google.com');
}

function lockElement(element: MediaElementWithSource) {
    if (element._locked) return;

    try {
        Object.defineProperty(element, 'volume', {
            get() {
                // Return the actual volume (or what the site expects if we wanted to lie, but actual is fine)
                return nativeVolumeGetter ? nativeVolumeGetter.call(this) : 1;
            },
            set(value) {
                // IGNORE attempts by the site to set volume
                // We only allow changes via applyVolume (which uses the native setter directly)
                // console.log('Blocked site from setting volume to:', value);
            },
            configurable: true
        });
        element._locked = true;
    } catch (e) {
        console.warn("Volume Manager: Failed to lock element", e);
    }
}

function hookElement(element: MediaElementWithSource) {
    if (element._hooked) return;

    // Check for forced fallback domains (TikTok, Meet)
    // We also check for cross-origin without CORS
    const isUnsafe = (element.currentSrc && isCrossOrigin(element.currentSrc) && element.crossOrigin !== "anonymous");

    if (shouldForceFallback() || isUnsafe) {
        element._fallbackMode = true;
        element._hooked = true; // Mark as hooked so we don't retry

        // Only lock if specifically required (Meet)
        if (shouldLockVolume()) {
            lockElement(element);
        }

        // Apply initial volume
        applyVolume(element, Math.min(currentVolume, 1));
        return;
    }

    initAudioContext();
    if (!audioCtx || !gainNode) return;

    try {
        const source = audioCtx.createMediaElementSource(element);
        source.connect(gainNode);
        element._source = source;
        element._hooked = true;
    } catch (e) {
        // Fallback if hooking fails
        element._fallbackMode = true;
        element._hooked = true;
        if (shouldLockVolume()) {
            lockElement(element);
        }
        applyVolume(element, Math.min(currentVolume, 1));
    }
}

function hookAllMediaElements() {
    const mediaElements = document.querySelectorAll('audio, video');
    mediaElements.forEach((el) => hookElement(el as MediaElementWithSource));
}

const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
            if (node instanceof HTMLMediaElement) {
                hookElement(node as MediaElementWithSource);
            } else if (node instanceof HTMLElement) {
                const mediaElements = node.querySelectorAll('audio, video');
                mediaElements.forEach((el) => hookElement(el as MediaElementWithSource));
            }
        });
    });
});

observer.observe(document.body, {
    childList: true,
    subtree: true
});

const originalPlay = HTMLMediaElement.prototype.play;
HTMLMediaElement.prototype.play = function () {
    hookElement(this as MediaElementWithSource);
    return originalPlay.apply(this, arguments as any);
};

setInterval(() => {
    hookAllMediaElements();

    // Enforce volume for fallback elements
    const mediaElements = document.querySelectorAll('audio, video');
    mediaElements.forEach((el) => {
        const element = el as MediaElementWithSource;

        // Enforce mute if volume is 0
        if (currentVolume === 0) {
            element.muted = true;
        }

        if (element._fallbackMode) {
            // Only enforce lock/volume if it SHOULD be locked (Meet)
            if (shouldLockVolume()) {
                lockElement(element);
                applyVolume(element, Math.min(currentVolume, 1));
            }
            // For TikTok (not locked), we do NOT enforce volume here.
            // This allows the user to change it via the native slider without it jumping back.
        }
    });
}, 1000);

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hookAllMediaElements);
} else {
    hookAllMediaElements();
}

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
    if (message.msg === messageType.setVolume) {
        currentVolume = message.volume;

        initAudioContext();
        if (gainNode) {
            if (currentVolume === 0) {
                gainNode.gain.value = 0;
            } else {
                gainNode.gain.value = currentVolume;
            }
        }

        const mediaElements = document.querySelectorAll('audio, video');
        mediaElements.forEach((el) => {
            const element = el as MediaElementWithSource;

            // Force mute if volume is 0
            if (currentVolume === 0) {
                element.muted = true;
            } else {
                element.muted = false;
            }

            if (element._fallbackMode) {
                applyVolume(element, Math.min(currentVolume, 1));
            }
            // For hooked elements (Web Audio), we do nothing here (gainNode handles it)
        });
    }
});
