/**
 * Remove agent sessions tied to a deleted web chat thread.
 */
import fs from 'fs';

import { isContainerRunning } from './container-runner.js';
import { getDb } from './db/connection.js';
import { deleteSession } from './db/sessions.js';
import { log } from './log.js';
import { sessionDir } from './session-manager.js';
import type { Session } from './types.js';

import { MAIN_THREAD } from './webchat-store.js';

/**
 * All sessions (any status) bound to a messaging group + thread.
 *
 * The host no longer exports a bulk `getSessionsForMessagingGroupThread`
 * helper (its db layer moved to the async DbDriver). Query the shared driver
 * directly here so a deleted thread sweeps every agent's session, not just the
 * single active one `findSession` would return.
 */
async function sessionsForMessagingGroupThread(
  messagingGroupId: string,
  threadId: string | null,
): Promise<Session[]> {
  if (threadId) {
    return await getDb().all<Session>(
      'SELECT * FROM sessions WHERE messaging_group_id = ? AND thread_id = ?',
      messagingGroupId,
      threadId,
    );
  }
  return await getDb().all<Session>(
    'SELECT * FROM sessions WHERE messaging_group_id = ? AND thread_id IS NULL',
    messagingGroupId,
  );
}

export async function cleanupAgentSessionsForThread(
  messagingGroupId: string,
  threadId: string,
): Promise<void> {
  const lookupThreadId = threadId === MAIN_THREAD ? null : threadId;
  const sessions = await sessionsForMessagingGroupThread(messagingGroupId, lookupThreadId);

  for (const session of sessions) {
    if (isContainerRunning(session.id)) {
      log.warn('Skipping web thread session delete — container running', {
        sessionId: session.id,
        threadId,
      });
      continue;
    }
    const dir = sessionDir(session.agent_group_id, session.id);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    await deleteSession(session.id);
    log.info('Deleted agent session for web thread', {
      sessionId: session.id,
      agentGroupId: session.agent_group_id,
      threadId,
    });
  }
}
