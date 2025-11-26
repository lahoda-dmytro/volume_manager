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
    return window.location.hostname.includes('tiktok.com');
}

function hookElement(element: MediaElementWithSource) {
    if (element._hooked || element._fallbackMode) return;

    if (shouldForceFallback()) {
        console.log("Volume Manager: Forcing fallback mode for this domain.");
        element._fallbackMode = true;
        element.volume = Math.min(currentVolume, 1);
        return;
    }

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
        element._fallbackMode = true;
        element.volume = Math.min(currentVolume, 1);
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

setInterval(hookAllMediaElements, 2000);

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
            if (element._fallbackMode || !element._hooked) {
                element.volume = Math.min(currentVolume, 1);
            }
        });
    }
});
