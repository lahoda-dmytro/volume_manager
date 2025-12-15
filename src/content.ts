import { Message, messageType } from './types';

// @ts-ignore
const runtime = (typeof chrome !== 'undefined' ? chrome : browser).runtime;

let targetVolume: number = 1;
const managedElements = new WeakSet<HTMLMediaElement>();

// Логер (лише для Google Meet)
function log(msg: string, ...args: any[]) {
    if (window.location.hostname.includes('google.com')) {
        console.log(`[VolumeManager] ${msg}`, ...args);
    }
}

// === ГОЛОВНА ЛОГІКА КОНТРОЛЮ ===

function enforceVolume(element: HTMLMediaElement) {
    // Якщо це "мертвий" елемент, не чіпаємо
    if (!element) return;

    // Жорстка перевірка різниці
    if (Math.abs(element.volume - targetVolume) > 0.001) {
        element.volume = targetVolume;
    }

    // Синхронізація Mute
    if (targetVolume === 0 && !element.muted) {
        element.muted = true;
    } else if (targetVolume > 0 && element.muted) {
        // Увага: Meet може м'ютити сам, але ми пріоритетніші, якщо користувач виставив звук
        element.muted = false;
    }
}

function hookElement(element: HTMLMediaElement) {
    if (managedElements.has(element)) return;

    log('HOOKED new audio source:', element);
    managedElements.add(element);

    // 1. Одразу застосовуємо гучність
    enforceVolume(element);

    // 2. Слухаємо будь-які спроби змінити гучність
    element.addEventListener('volumechange', (e) => {
        if (e.isTrusted) enforceVolume(element);
    });

    // 3. Інші події життєвого циклу
    element.addEventListener('play', () => enforceVolume(element));
    element.addEventListener('loadedmetadata', () => enforceVolume(element));
    element.addEventListener('durationchange', () => enforceVolume(element)); // Часто спрацьовує при стрімах
}

// === ЯДЕРНИЙ ПОШУК (Shadow DOM + Recursion) ===

function scanDOM(root: Document | ShadowRoot | HTMLElement) {
    // 1. Шукаємо звичайні теги
    const elements = root.querySelectorAll('audio, video');
    elements.forEach(el => hookElement(el as HTMLMediaElement));

    // 2. Рекурсивно ліземо в Shadow Roots усіх елементів
    const allNodes = root.querySelectorAll('*');
    allNodes.forEach((node) => {
        if (node.shadowRoot) {
            scanDOM(node.shadowRoot);
        }
    });
}

// === ПЕРЕХОПЛЕННЯ API (Monkey Patching) ===
// Це гарантує, що ми знайдемо елемент, навіть якщо його немає в DOM

function hijackAPI() {
    // 1. Перехоплюємо document.createElement('audio'/'video')
    const originalCreateElement = document.createElement;
    document.createElement = function(tagName: string, options?: ElementCreationOptions) {
        const element = originalCreateElement.call(document, tagName, options);
        if (tagName.toLowerCase() === 'audio' || tagName.toLowerCase() === 'video') {
            hookElement(element as HTMLMediaElement);
        }
        return element;
    } as any;

    // 2. Перехоплюємо new Audio()
    const originalAudio = window.Audio;
    window.Audio = function(src?: string) {
        const element = new originalAudio(src);
        hookElement(element);
        return element;
    } as any;

    // Відновлюємо прототип (щоб instanceof працював)
    window.Audio.prototype = originalAudio.prototype;
}

// --- ІНІЦІАЛІЗАЦІЯ ---

// Запускаємо перехоплення API одразу
hijackAPI();

// Спостерігач за DOM (включно з Shadow DOM, наскільки це можливо через сканування)
const observer = new MutationObserver(() => {
    scanDOM(document);
});

observer.observe(document.documentElement, {
    childList: true,
    subtree: true
});

// Інтервал для підстраховки (сканує все кожну секунду)
setInterval(() => {
    scanDOM(document);
}, 1000);

// Початкове сканування
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => scanDOM(document));
} else {
    scanDOM(document);
}

// Обробка повідомлень
runtime.onMessage.addListener((message: Message) => {
    if (message.msg === messageType.setVolume) {
        log('Global volume set to:', message.volume);
        targetVolume = message.volume;

        // Оновлюємо все, що знайшли раніше
        scanDOM(document);

        // Додатково проходимось по нашому кешу (бо елементи можуть бути від'єднані від DOM)
        // На жаль, WeakSet не можна перебрати, тому ми покладаємось на scanDOM і події
    }
});