import browser from 'webextension-polyfill'
import deepEqual from 'deep-equal'
import config from '../config'

let lastData: any | null = null;

function isExtensionValid() {
  return typeof browser !== 'undefined' && !!browser.storage && !!browser.runtime?.id;
}

function getComposeMetadata() {
  const getFieldEmails = (fieldName: string): string[] => {
    const field = document.querySelector(`div[aria-label='${fieldName}']`) as HTMLElement;
    if (!field) {
      if (fieldName === 'To') {
        // when replying to an email without changing the recipients, the To, Cc, Bcc fields are not present
        // in the DOM as <div>. They're all inside a span with class _EType_RECIPIENT_ENTITY.
        const tos = document.querySelectorAll(".azpOk.luPaj span._EType_RECIPIENT_ENTITY span[aria-label]") as NodeListOf<HTMLElement>;
        return Array.from(tos).map(el => el.getAttribute('aria-label') || '').filter(Boolean);
      } else {
        return [];
      }
    }
    return Array.from(
      field.querySelectorAll("span._EType_RECIPIENT_ENTITY")
    ).map(el => el.getAttribute('aria-label') || '')
    .filter(Boolean);
  };

  // When composing a new email, the subject is in an input field with aria-label "Subject"
  // When replying to an email, the subject is hidden and the orignal subject is shown in a span with class JdFsz.
  const subjectInputField = document.querySelector('input[aria-label="Subject"]') as HTMLElement;
  let subject = '';
  if (subjectInputField) {
    subject = subjectInputField.getAttribute('value') || '';
  } else {
    const subjectSpan = document.querySelector('span.JdFsz') as HTMLElement;
    if (subjectSpan) {
      subject = subjectSpan.textContent?.trim() || '';
    }
  }
  return {
    outlook_activity: 'composing_email',
    subject,
    to: getFieldEmails('To'),
    cc: getFieldEmails('Cc'),
    bcc: getFieldEmails('Bcc'),
  };
}

function getReadingMetadata(emailContainer: HTMLElement) {
  const subjectEl = emailContainer.querySelector('span.JdFsz') as HTMLElement;
  const conversationContainer = emailContainer.querySelector("div[data-app-section='ConversationContainer']") as HTMLElement;
  const fromEl = conversationContainer.querySelector('span.OZZZK') as HTMLElement;
  const toEls = conversationContainer.querySelectorAll("div[data-testid='RecipientWell'] span._EType_RECIPIENT_ENTITY span[aria-label]");
  const from = fromEl?.textContent?.trim() || '';

  const to = Array.from(toEls)
    .map((el) => {
      return el.getAttribute('aria-label') || '';
    })
    .filter(Boolean);

  return {
    outlook_activity: 'reading_email',
    subject: subjectEl?.textContent?.trim() || '',
    from,
    to,
  };
}

async function sendOutlookHeartbeat() {
  if (!isExtensionValid()) {
    return;
  }
  if (document.visibilityState === 'hidden') {
    return;
  }

  let meta: any;
  const sendBtn = document.querySelector('div[data-testid="ComposeSendButton"] button[aria-label="Send"]') as HTMLElement;
  if (sendBtn) {
    meta = getComposeMetadata();
  } else {
    const emailContainer = document.querySelector("div[id='ConversationReadingPaneContainer']") as HTMLElement;
    if (emailContainer) {
      meta = getReadingMetadata(emailContainer);
    } else {
      meta = { outlook_activity: 'reading_inbox' };
    }
  }

  if (!deepEqual(lastData, meta)) {
    lastData = meta;
    browser.runtime.sendMessage({
      type: 'AW_OUTLOOK_HEARTBEAT',
      data: meta,
    }).catch(() => {})
  }
}

let detectIntervalId: ReturnType<typeof setInterval> | null = null;
let pulseIntervalId: ReturnType<typeof setInterval> | null = null;

function startTracking() {
  if (detectIntervalId !== null) {
    return;
  }

  detectIntervalId = setInterval(sendOutlookHeartbeat, 5000);
  pulseIntervalId = setInterval(() => {
    if (!isExtensionValid()) {
      return;
    }
    if (lastData && document.visibilityState === 'visible') {
      try {
        browser.runtime.sendMessage({
          type: 'AW_OUTLOOK_HEARTBEAT',
          data: lastData,
        }).catch(() => {})
      } catch (err) {
        // Extension context invalidated
      }
    }
  }, config.heartbeat.intervalInSeconds * 1000);

  sendOutlookHeartbeat();
}

async function refreshTracking() {
  if (!isExtensionValid()) {
    return;
  }
  try {
    const settings = await browser.storage.local.get(['outlookEnabled', 'enabled']);
    const shouldTrack = Boolean(settings.outlookEnabled && settings.enabled);

    if (shouldTrack) {
      startTracking();
    } else {
      stopTracking();
    }
  } catch (err) {
    console.error('[Outlook Content] Failed to refresh tracking state', err);
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

browser.storage.local.get(['outlookEnabled', 'enabled']).then(() => {
  refreshTracking();
})

browser.storage.onChanged.addListener((changes) => {
  if ('outlookEnabled' in changes || 'enabled' in changes) {
    refreshTracking();
  }
})
