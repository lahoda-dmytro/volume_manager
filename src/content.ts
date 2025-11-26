import { Message, messageType } from './types';

interface MediaElementWithSource extends HTMLMediaElement {
    _source?: MediaElementAudioSourceNode;
    _hooked?: boolean;
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

function hookElement(element: MediaElementWithSource) {
    if (element._hooked) return;

    initAudioContext();
    if (!audioCtx || !gainNode) return;

    try {
        // Try to set crossOrigin to anonymous to avoid CORS issues with some CDNs
        if (!element.crossOrigin) {
            element.crossOrigin = "anonymous";
        }

        const source = audioCtx.createMediaElementSource(element);
        source.connect(gainNode);
        element._source = source;
        element._hooked = true;
        console.log("Volume Manager: Hooked element", element);
    } catch (e) {
        console.warn("Volume Manager: Failed to hook element (likely CORS)", e);
        // Even if we fail to hook, we mark it as hooked to avoid spamming errors
        element._hooked = true;
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
        initAudioContext();
        if (gainNode) {
            // Explicitly handle 0 to ensure silence
            if (currentVolume === 0) {
                gainNode.gain.value = 0;
            } else {
                gainNode.gain.value = currentVolume;
            }
        }
    }
});
