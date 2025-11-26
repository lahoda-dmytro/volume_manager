import { Message, messageType } from './types';

interface MediaElementWithSource extends HTMLMediaElement {
    _source?: MediaElementAudioSourceNode;
    _hooked?: boolean;
    _fallbackMode?: boolean;
}

let audioCtx: AudioContext | null = null;
let gainNode: GainNode | null = null;
let currentVolume = 1;

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
    // TikTok uses blob URLs that look same-origin but are backed by tainted resources
    // Attempting to hook them results in silence, so we force fallback
    return window.location.hostname.includes('tiktok.com');
}

function hookElement(element: MediaElementWithSource) {
    if (element._hooked || element._fallbackMode) return;

    // Check for forced fallback domains (like TikTok)
    if (shouldForceFallback()) {
        console.log("Volume Manager: Forcing fallback mode for this domain.");
        element._fallbackMode = true;
        element.volume = Math.min(currentVolume, 1);
        return;
    }

    // Check for unsafe cross-origin content
    if (element.currentSrc && isCrossOrigin(element.currentSrc) && element.crossOrigin !== "anonymous") {
        console.warn("Volume Manager: Element is cross-origin without CORS. Falling back to native volume control.", element);
        element._fallbackMode = true;
        element.volume = Math.min(currentVolume, 1);
        return;
    }

    initAudioContext();
    if (!audioCtx || !gainNode) return;

    try {
        const source = audioCtx.createMediaElementSource(element);
        source.connect(gainNode);
        element._source = source;
        element._hooked = true;
        console.log("Volume Manager: Hooked element", element);
    } catch (e) {
        console.warn("Volume Manager: Failed to hook element (likely CORS)", e);
        // Fallback if hooking fails
        element._fallbackMode = true;
        element.volume = Math.min(currentVolume, 1);
    }
}

function hookAllMediaElements() {
    const mediaElements = document.querySelectorAll('audio, video');
    mediaElements.forEach((el) => hookElement(el as MediaElementWithSource));
}

// 1. MutationObserver for DOM changes
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

// 2. Monkey patch play() to catch elements created in memory
const originalPlay = HTMLMediaElement.prototype.play;
HTMLMediaElement.prototype.play = function () {
    hookElement(this as MediaElementWithSource);
    return originalPlay.apply(this, arguments as any);
};

// 3. Periodic check for stragglers (aggressive fallback)
setInterval(hookAllMediaElements, 2000);

// Initial hook
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hookAllMediaElements);
} else {
    hookAllMediaElements();
}

// Listen for messages
chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
    if (message.msg === messageType.setVolume) {
        currentVolume = message.volume;

        // Update Web Audio Gain
        initAudioContext();
        if (gainNode) {
            if (currentVolume === 0) {
                gainNode.gain.value = 0;
            } else {
                gainNode.gain.value = currentVolume;
            }
        }

        // Update Fallback Elements
        const mediaElements = document.querySelectorAll('audio, video');
        mediaElements.forEach((el) => {
            const element = el as MediaElementWithSource;
            if (element._fallbackMode || !element._hooked) {
                // For fallback elements, we can only set volume up to 1.0 (100%)
                element.volume = Math.min(currentVolume, 1);
            } else {
                // For hooked elements, ensure native volume is 1 so GainNode handles the rest
                element.volume = 1;
            }
        });
    }
});
