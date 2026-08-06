import browser from 'webextension-polyfill'
import { getActiveWindowTab, getTab, getTabs, isBrowserFocused } from './helpers'
import config from '../config'
import { AWClient, IEvent } from 'aw-client'
import { getBucketId, sendHeartbeat } from './client'
import { getEnabled, getHeartbeatData, setHeartbeatData, getGmailEnabled } from '../storage'
import deepEqual from 'deep-equal'

export function setupMessageListener(client: AWClient) {
  browser.runtime.onMessage.addListener(
    async (message: any, sender: browser.Runtime.MessageSender) => {
      if (!(await isBrowserFocused())) return;
      const enabled = await getEnabled();
      const gmailEnabled = await getGmailEnabled();
      if (!enabled || !gmailEnabled) return;

      if (message.type === 'AW_GMAIL_HEARTBEAT') {
        const tab = sender.tab;
        if (!tab || !tab.url || !tab.title) return;
        if (!tab.url.includes('mail.google.com')) return;
        const tabs = await getTabs();

        const data: IEvent['data'] = {
          url: tab.url,
          title: tab.title,
          audible: tab.audible ?? false,
          incognito: tab.incognito,
          tabCount: tabs.length,
          ...message.data,
        };
        await performHeartbeat(client, data);
      }
    },
  )
}

async function performHeartbeat(
  client: AWClient,
  data: IEvent['data'],
  options: { finalizeOnly?: boolean } = {}
) {
  const bucketId = await getBucketId()
  const now = new Date()
  const previousData = await getHeartbeatData()
  if (previousData && !deepEqual(previousData, data)) {
    await sendHeartbeat(
      client,
      bucketId,
      new Date(now.getTime() - 1),
      previousData,
      config.heartbeat.intervalInSeconds + 20,
    ).catch(() => {})
  }

  if (options.finalizeOnly) {
    if (previousData) {
      await browser.storage.local.remove('heartbeatData');
    }
    return;
  }

  await sendHeartbeat(
    client,
    bucketId,
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
  await heartbeat(client, activeWindowTab, tabs.length)
}

let lastHandledFocusState: boolean | null = null

async function handleFocusChange(client: AWClient) {
  const focused = await isBrowserFocused()
  if (focused === lastHandledFocusState) {
    return
  }
  lastHandledFocusState = focused

  if (!focused) {
    await finalizeStoredHeartbeat(client)
    return
  }
  await heartbeatForActiveTab(client)
}

export function setupFocusMessageListener(client: AWClient) {
  browser.runtime.onMessage.addListener(
    async (message: any, sender: browser.Runtime.MessageSender) => {
      if (message?.type !== 'AW_FOCUS_CHANGED') return
      if (!sender.tab?.active) {
        return
      }
      await handleFocusChange(client)
    },
  )
}

async function heartbeat(
  client: AWClient,
  tab: browser.Tabs.Tab | undefined,
  tabCount: number,
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

  const data: IEvent['data'] = {
    url: tab.url,
    title: tab.title,
    audible: tab.audible ?? false,
    incognito: tab.incognito,
    tabCount: tabCount,
  }

  const options: { finalizeOnly?: boolean } = {};
  const gmailEnabled = await getGmailEnabled();
  if (gmailEnabled && tab.url.includes('mail.google.com')) {
    // Sharp cut: finalize the previous activity (e.g. if we came from Google Search)
    // but don't start the 'Generic' Gmail event. Gmail.ts will do that with metadata.
    options.finalizeOnly = true;
  }

  await performHeartbeat(client, data, options);
}

export const sendInitialHeartbeat = async (client: AWClient) => {
  const activeWindowTab = await getActiveWindowTab()
  const tabs = await getTabs()
  await heartbeat(client, activeWindowTab, tabs.length)
}

export const heartbeatAlarmListener =
  (client: AWClient) => async (alarm: browser.Alarms.Alarm) => {
    if (alarm.name !== config.heartbeat.alarmName) return
    await heartbeatForActiveTab(client)
  }

export const tabActivatedListener =
  (client: AWClient) =>
    async (activeInfo: browser.Tabs.OnActivatedActiveInfoType) => {
      const tab = await getTab(activeInfo.tabId)
      const tabs = await getTabs()
      await heartbeat(client, tab, tabs.length)
    }
