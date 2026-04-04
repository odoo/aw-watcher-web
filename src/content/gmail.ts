import browser from 'webextension-polyfill'
import deepEqual from 'deep-equal'
import config from '../config'

let lastData: any | null = null;

function isExtensionValid() {
  return typeof browser !== 'undefined' && !!browser.storage && !!browser.runtime?.id;
}

function getTextWithEmojis(el: HTMLElement | null): string {
  if (!el) return '';
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('img').forEach(img => {
    img.replaceWith(img.getAttribute('data-emoji') || '');
  });
  return clone.textContent?.trim() || '';
}

function getEmailSubject(): string {
  return getTextWithEmojis(document.querySelector('h2.hP') as HTMLElement);
}


function getComposeMetadata(form: HTMLElement) {
  const getRecipients = (name: string) =>
    Array.from(
      new Set(
        Array.from(form.querySelectorAll(`div[name="${name}"] [data-hovercard-id]`))
          .map((el) => {
            const name = getTextWithEmojis(el as HTMLElement).trim();
            const email = el.getAttribute('data-hovercard-id');
            return name && email ? `${name} (${email})` : (email || name);
          })
          .filter(Boolean) as string[],
      ),
    );

  return {
    gmail_activity: 'composing_email',
    subject: (form.querySelector('input[name="subjectbox"]') as HTMLInputElement)?.value || '',
    to: getRecipients('to'),
    cc: getRecipients('cc'),
    bcc: getRecipients('bcc'),
  };
}

function getReplyMetadata(form: HTMLElement) {
  const parseRecipientElement = (el: Element) => {
    const email = el.getAttribute('data-hovercard-id');
    const name = el.getAttribute('data-name') || getTextWithEmojis(el as HTMLElement).trim();
    return name && email ? `${name} (${email})` : (email || name);
  };

  const getRecipientsFromReplyForm = (block: Element | undefined) => {
    if (!block) return [];
    return Array.from(new Set(
      Array.from(block.querySelectorAll('[data-hovercard-id]'))
        .map(parseRecipientElement)
        .filter(Boolean) as string[]
    ));
  };

  const replyFormBlocks = Array.from(form.querySelectorAll('.afp'));
  return {
    gmail_activity: 'composing_email',
    subject: getEmailSubject(),
    to: getRecipientsFromReplyForm(replyFormBlocks[0]),
    cc: getRecipientsFromReplyForm(replyFormBlocks[1]),
    bcc: getRecipientsFromReplyForm(replyFormBlocks[2]),
  };
}

async function sendGmailHeartbeat() {
  if (!isExtensionValid()) {
    // Don't kill tracking — just skip this tick.
    // The onChanged listener will handle re-evaluation.
    return;
  }
  if (document.visibilityState === 'hidden') {
    return;
  }


  // for simplity in MVP:
  // - if many emails forms are open, we only track the first one
  const dialogForm = document.querySelector('div[role="dialog"] form') as HTMLElement | null;
  const form = (dialogForm || document.querySelector('form[method="POST"].bAs')) as HTMLElement | null;
  
  let activity: string;
  let meta: any;

  if (form) {
    meta = dialogForm ? getComposeMetadata(form) : getReplyMetadata(form);
  } else {
    const fromEl = document.querySelector('span.gD');

    if (fromEl) {
      const fromEmail = fromEl?.getAttribute('data-hovercard-id');
      const fromName = getTextWithEmojis(fromEl as HTMLElement);
      const from = `${fromName} (${fromEmail})`;
    
      const to = Array.from(
        document.querySelectorAll('.gE [data-hovercard-id]'),
      )
        .map(
          (el) => {
            const email = el.getAttribute('data-hovercard-id');
            const name = getTextWithEmojis(el as HTMLElement);
            return `${name} (${email})`;
          }
        )
        .filter((e) => e && e !== from) as string[];

    activity = 'reading_email';
    meta = {
      gmail_activity: activity,
      subject: getEmailSubject(),
      from,
      to,
    };
  } else {
      activity = 'reading_inbox';
      meta = { gmail_activity: activity };
    }
  }

    if (!deepEqual(lastData, meta)) {
      lastData = meta;
      browser.runtime.sendMessage({ 
        type: 'AW_GMAIL_HEARTBEAT', 
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
  
  detectIntervalId = setInterval(sendGmailHeartbeat, 5000);
  pulseIntervalId = setInterval(() => {
    if (!isExtensionValid()) {
      return;
    }
    if (lastData && document.visibilityState === 'visible') {
      try {
        browser.runtime.sendMessage({ 
          type: 'AW_GMAIL_HEARTBEAT', 
          data: lastData
        }).catch(() => {})
      } catch (err) {
        // Extension context invalidated
      }
    }
  }, config.heartbeat.intervalInSeconds * 1000);
  
  sendGmailHeartbeat();
}

async function refreshTracking() {
  if (!isExtensionValid()) {
    return;
  }
  try {
    const settings = await browser.storage.local.get(['gmailEnabled', 'enabled']);
    const shouldTrack = Boolean(settings.gmailEnabled && settings.enabled);
    
    if (shouldTrack) {
      startTracking();
    } else {
      stopTracking();
    }
  } catch (err) {
    console.error('[Gmail Content] Failed to refresh tracking state', err);
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

browser.storage.local.get(['gmailEnabled', 'enabled']).then(() => {
  refreshTracking();
})

browser.storage.onChanged.addListener((changes) => {
  if ('gmailEnabled' in changes || 'enabled' in changes) {
    refreshTracking();
  }
})
