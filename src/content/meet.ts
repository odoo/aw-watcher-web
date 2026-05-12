import browser from 'webextension-polyfill'
import deepEqual from 'deep-equal'
import config from '../config'

let lastData: any | null = null;

function isExtensionValid() {
  return typeof browser !== 'undefined' && !!browser.storage && !!browser.runtime?.id;
}

async function extractMeetParticipants() {
  // i noticed that the button ui is different when testing with brave, mozilla, chrome
  // to avoid versions issue, i covered both cases

  /**
   * NOTE on Fragility: The selectors below (A5il2e, ocqpFe, F9GLnb, zWGUib, KF4T6b, GvcuGe) are internal 
   * Meet class names. These are not part of a stable API and may change 
   * during Meet frontend updates. High-fidelity tracking may require 
   * maintenance if these selectors break.
   */
  const btnV1 = document.querySelector('button[jsname="A5il2e"][data-panel-id="1"]') as HTMLButtonElement | null;
  const btnV2 = (Array.from(document.querySelectorAll('[jsname="ocqpFe"]'))
    .find(el => {
      const label = el.querySelector('span[style*="display: none"]');
      return label && label.textContent?.trim() === 'Participants';
    })
    ?? document.querySelector('.fdZ55')) as HTMLButtonElement | null;

  const btn = btnV1 ?? btnV2;

  if (!btn) {
    // Maybe not in a meeting or UI changed
    return [];
  }

  // Only click if the panel is not already open
  const isExpanded = btn.getAttribute('aria-expanded') === 'true';
  if (!isExpanded) {
    btn.click();
    await new Promise(r => setTimeout(r, 800)); // wait for panel to render
  }

  let participants: string[] = [];

  const panelV1 = document.getElementById('ME4pNd');

  if (panelV1) {
    const v1Selectors = ['[jsname="F9GLnb"]', '.zWGUib', '.KF4T6b'];
    for (const sel of v1Selectors) {
      panelV1.querySelectorAll(sel).forEach(el => {
        const name = el.textContent?.trim();
        if (name && !participants.includes(name)) participants.push(name);
      });
      if (participants.length > 0) break;
    }
  }

  if (participants.length === 0) {
    const v2Selectors = ['.zWGUib', '.KF4T6b', '.GvcuGe', '[jsname="F9GLnb"]'];
    for (const sel of v2Selectors) {
      document.querySelectorAll(sel).forEach(el => {
        const name = el.textContent?.trim();
        if (name && !participants.includes(name)) participants.push(name);
      });
      if (participants.length > 0) break;
    }
  }

  participants = [...new Set(participants)];
  return participants;
}

async function sendMeetHeartbeat() {
  if (!isExtensionValid()) {
    return;
  }
  if (document.visibilityState === 'hidden') {
    return;
  }

  const participants = await extractMeetParticipants();
  
  const meta = {
    meet_activity: 'in_meeting',
    participants: participants,
  };

  if (!deepEqual(lastData, meta)) {
    lastData = meta;
    browser.runtime.sendMessage({ 
      type: 'AW_MEET_HEARTBEAT', 
      data: meta
    }).catch(() => {})
  }
}

let detectIntervalId: ReturnType<typeof setInterval> | null = null;
let pulseIntervalId: ReturnType<typeof setInterval> | null = null;

function startTracking() {
  if (detectIntervalId !== null) {
    return; 
  }
  
  detectIntervalId = setInterval(sendMeetHeartbeat, 5000);
  pulseIntervalId = setInterval(() => {
    if (!isExtensionValid()) {
      return;
    }
    if (lastData && document.visibilityState === 'visible') {
      try {
        browser.runtime.sendMessage({ 
          type: 'AW_MEET_HEARTBEAT', 
          data: lastData
        }).catch(() => {})
      } catch (err) {
        // Extension context invalidated
      }
    }
  }, config.heartbeat.intervalInSeconds * 1000);
  
  sendMeetHeartbeat();
}

async function refreshTracking() {
  if (!isExtensionValid()) {
    return;
  }
  try {
    const settings = await browser.storage.local.get(['meetEnabled', 'enabled']);
    const shouldTrack = Boolean(settings.meetEnabled && settings.enabled);
    
    if (shouldTrack) {
      startTracking();
    } else {
      stopTracking();
    }
  } catch (err) {
    console.error('[Meet Content] Failed to refresh tracking state', err);
  }
}

function stopTracking() {
  if (detectIntervalId !== null) {
    clearInterval(detectIntervalId)
    detectIntervalId = null;
  }
  if (pulseIntervalId !== null) {
    clearInterval(pulseIntervalId)
    pulseIntervalId = null;
  }
  lastData = null;
}

browser.storage.local.get(['meetEnabled', 'enabled']).then(() => {
  refreshTracking();
})

browser.storage.onChanged.addListener((changes) => {
  if ('meetEnabled' in changes || 'enabled' in changes) {
    refreshTracking();
  }
})
