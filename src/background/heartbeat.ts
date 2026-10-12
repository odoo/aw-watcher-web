import browser from 'webextension-polyfill'
import {
  getActiveWindowTab,
  getTab,
  getTabs,
  isBrowserFocused,
  isTabFocused,
} from './helpers'
import config from '../config'
import { AWClient, IEvent } from 'aw-client'
import { getBucketId, sendHeartbeat } from './client'
import { getEnabled, getHeartbeatData, setHeartbeatData, getGmailEnabled } from '../storage'
import deepEqual from 'deep-equal'
import * as punycode from 'punycode.js'

function decodeURL(url: string): string {
  try {
    const parsed = new URL(url)
    if (!parsed.hostname.includes('xn--')) {
      return url
    }

    // Do not assign parsed.hostname — the setter converts Unicode back to
    // punycode. Rebuild from parsed parts so userinfo is never mistaken
    // for the hostname.
    const decodedHost = punycode.toUnicode(parsed.hostname)
    const userinfo =
      parsed.username === ''
        ? ''
        : `${parsed.username}${
            parsed.password === '' ? '' : `:${parsed.password}`
          }@`
    const port = parsed.port === '' ? '' : `:${parsed.port}`
    return `${parsed.protocol}//${userinfo}${decodedHost}${port}${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch (e) {
    console.error('Error decoding URL:', e)
    return url
  }
}

function formatHeartbeatLogData(data: IEvent['data']) {
  return Object.entries(data)
    .map(([key, value]) => {
      const formattedValue =
        typeof value === 'string'
          ? JSON.stringify(value)
          : value === undefined
            ? 'undefined'
            : JSON.stringify(value)
      return `${key}=${formattedValue}`
    })
    .join(', ')
}

async function performHeartbeat(
  client: AWClient,
  data: IEvent['data'],
) {
  const bucketId = await getBucketId()
  const now = new Date()
  const previousData = await getHeartbeatData()
  if (previousData && !deepEqual(previousData, data)) {
    await sendHeartbeat(
      client,
      await getBucketId(),
      new Date(now.getTime() - 1),
      previousData,
      config.heartbeat.intervalInSeconds + 20,
    )
  }

  console.debug(`Sending heartbeat: ${formatHeartbeatLogData(data)}`)
  await sendHeartbeat(
    client,
    await getBucketId(),
    now,
    data,
    config.heartbeat.intervalInSeconds + 20,
  ).catch((err: unknown) => {
    console.error('[Background] Failed to send heartbeat:', err);
  })

  await setHeartbeatData(data)
}

async function finalizeStoredHeartbeat(client: AWClient) {
  const previousData = await getHeartbeatData()
  if (!previousData) return

  const bucketId = await getBucketId()
  const now = new Date()

  // Send a heartbeat with the previous data, to finalize the event with the exact duration
  await sendHeartbeat(
    client,
    bucketId,
    new Date(now.getTime() - 1),
    previousData,
    config.heartbeat.intervalInSeconds + 20,
  ).catch(() => {})

  // Send a closing heartbeat with a different data,
  // same last event data but with browserFocused set to false to stop the previous event
  // this event will be skipped as the duration will be 0, but it will finalize the previous event
  const closingData = { ...previousData, browserFocused: false }

  await sendHeartbeat(
    client,
    bucketId,
    now,
    closingData,
    config.heartbeat.intervalInSeconds + 20,
  ).catch(() => {})

  await browser.storage.local.remove('heartbeatData')
}

async function heartbeatForActiveTab(client: AWClient) {
  const activeWindowTab = await getActiveWindowTab()
  if (!activeWindowTab) return
  const tabs = await getTabs()
  console.debug('Sending heartbeat for alarm', activeWindowTab.url)
  await heartbeat(client, activeWindowTab, tabs.length)
}

export function setupFocusMessageListener(client: AWClient) {
  browser.runtime.onMessage.addListener(
    async (message: any, sender: browser.Runtime.MessageSender) => {
      if (message?.type !== 'AW_FOCUS_CHANGED') return
      if (!sender.tab?.active) {
        return
      }
      // No state kept: the focus comes from the tab the user is now on, also when coming
      // from another browser window. Sending the same data again is merged by AW
      if (message.focused) {
        const tabs = await getTabs()
        await heartbeat(client, sender.tab, tabs.length)
      } else if (!(await isBrowserFocused())) {
        await finalizeStoredHeartbeat(client)
      }
    },
  )
}

async function requestGmailData(
  tab: browser.Tabs.Tab,
): Promise<IEvent['data'] | undefined> {
  if (tab.id === undefined) return undefined
  try {
    return await browser.tabs.sendMessage(tab.id, { type: 'AW_GMAIL_GET_DATA' })
  } catch (e) {
    console.debug('Failed to get the data from the Gmail tab', e)
    return undefined
  }
}

async function heartbeat(
  client: AWClient,
  tab: browser.Tabs.Tab | undefined,
  tabCount: number,
  options: { onlyIfChanged?: boolean } = {},
) {
  if (!(await isBrowserFocused())) {
    await finalizeStoredHeartbeat(client)
    return
  }

  const enabled = await getEnabled()
  if (!enabled) {
    console.warn('Ignoring heartbeat because client has not been enabled')
    return
  }

  if (!tab) {
    console.warn('Ignoring heartbeat because no active tab was found')
    return
  }

  if (!tab.url || !tab.title) {
    console.warn('Ignoring heartbeat because tab is missing URL or title')
    return
  }

  // Extract only the fields we need so we don't retain references to the
  // full Tab object (which includes favIconUrl — a potentially large base64
  // data URI).  Over thousands of heartbeats the retained Tab references
  // cause unbounded memory growth (see #222).
  const { url, title, audible, incognito } = tab
  const data: IEvent['data'] = {
    url: decodeURL(url),
    title,
    audible: audible ?? false,
    incognito,
    tabCount: tabCount,
  }

  const gmailEnabled = await getGmailEnabled();
  if (gmailEnabled && url.includes('mail.google.com')) {
    // gmail.ts only reads the page, it's up to us to ask for its data. Without an answer
    // (page loading, content script from a previous version), we keep the tab data
    Object.assign(data, await requestGmailData(tab))
  }

  if (options.onlyIfChanged && deepEqual(await getHeartbeatData(), data)) return

  await performHeartbeat(client, data);
}

export const sendInitialHeartbeat = async (client: AWClient) => {
  const activeWindowTab = await getActiveWindowTab()
  const tabs = await getTabs()
  console.debug('Sending initial heartbeat', activeWindowTab?.url)
  await heartbeat(client, activeWindowTab, tabs.length)
}

export const heartbeatAlarmListener =
  (client: AWClient) => async (alarm: browser.Alarms.Alarm) => {
    if (alarm.name !== config.heartbeat.alarmName) return
    await heartbeatForActiveTab(client)
  }

// Changes inside Gmail that keep the same URL (subject, recipients, inline reply) don't
// trigger any browser event, so we ask the Gmail tab for its data regularly while it's
// the one the user is on, and only send a heartbeat when the data changed
export function setupGmailCheck(client: AWClient) {
  setInterval(async () => {
    if (!(await getGmailEnabled())) return
    const tab = await getActiveWindowTab()
    if (!tab?.url?.includes('mail.google.com')) return
    if (!(await isTabFocused(tab))) return
    const tabs = await getTabs()
    await heartbeat(client, tab, tabs.length, { onlyIfChanged: true })
  }, config.heartbeat.gmailCheckIntervalInSeconds * 1000)
}

export const tabUpdatedListener =
  (client: AWClient) =>
  async (
    _tabId: number,
    changeInfo: browser.Tabs.OnUpdatedChangeInfoType,
    tab: browser.Tabs.Tab,
  ) => {
    // Only the URL: the title also changes on its own, e.g. Gmail's unread count
    if (!changeInfo.url || !tab.active) return
    if (!(await isTabFocused(tab))) return
    const tabs = await getTabs()
    console.debug('Sending heartbeat for URL change', changeInfo.url)
    await heartbeat(client, tab, tabs.length)
  }

export const tabActivatedListener =
  (client: AWClient) =>
  async (activeInfo: browser.Tabs.OnActivatedActiveInfoType) => {
    const tab = await getTab(activeInfo.tabId)
    const tabs = await getTabs()
    console.debug('Sending heartbeat for tab activation', tab.url)
    await heartbeat(client, tab, tabs.length)
  }
