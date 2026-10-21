import browser from 'webextension-polyfill'

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

function getOutlookMetadata() {
  const sendBtn = document.querySelector('div[data-testid="ComposeSendButton"] button[aria-label="Send"]') as HTMLElement;
  if (sendBtn) {
    return getComposeMetadata();
  }
  const emailContainer = document.querySelector("div[id='ConversationReadingPaneContainer']") as HTMLElement;
  if (emailContainer) {
    return getReadingMetadata(emailContainer);
  }
  return { outlook_activity: 'reading_inbox' };
}

// This script only reads the page: the background asks for the data when it needs it
browser.runtime.onMessage.addListener((message: any) => {
  if (message?.type !== 'AW_OUTLOOK_GET_DATA') return undefined;
  return Promise.resolve(getOutlookMetadata());
})
