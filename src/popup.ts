import { Message, messageType } from './types';

const slider = document.getElementById("volume-slider") as HTMLInputElement;
if (!slider) throw new Error("Not able to get slider.");

slider.style.opacity = '0';

async function getActiveTab() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return activeTab;
}

function getStorageKey(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return `volume_${hostname}`;
  } catch (e) {
    return 'volume_default';
  }
}

(async () => {
  const tab = await getActiveTab();
  if (!tab || !tab.id || !tab.url) return;

  const storageKey = getStorageKey(tab.url);
  const storedData = await chrome.storage.local.get([storageKey]);
  const storedVolume = storedData[storageKey] || 1;

  // Send message to content script to ensure it has the correct volume
  // Content script is injected via manifest, so we just talk to it
  const msgSet: Message = { msg: messageType.setVolume, volume: storedVolume };
  await chrome.tabs.sendMessage(tab.id, msgSet).catch(e => {
    // Content script might not be ready or page doesn't support it (e.g. about:blank)
    console.log("Could not send initial volume message", e);
  });

  slider.value = String(storedVolume * 100);
  slider.style.opacity = '1';
})();

slider.addEventListener('input', async () => {
  const value = Number(slider.value) / 100;
  const tab = await getActiveTab();

  if (tab && tab.id && tab.url) {
    const storageKey = getStorageKey(tab.url);

    // Save volume setting for this specific domain
    chrome.storage.local.set({ [storageKey]: value });

    const msg: Message = { msg: messageType.setVolume, volume: value };

    await chrome.tabs.sendMessage(tab.id, msg).catch(e => console.error(e));

    const text = String(Math.round(value * 100));
    chrome.action.setBadgeText({ text, tabId: tab.id });
  }
});