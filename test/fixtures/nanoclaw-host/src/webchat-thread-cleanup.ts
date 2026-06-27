/**
 * Remove agent sessions tied to a deleted web chat thread.
 */
import fs from 'fs';

import { isContainerRunning } from './container-runner.js';
import { deleteSession, getSessionsForMessagingGroupThread } from './db/sessions.js';
import { log } from './log.js';
import { sessionDir } from './session-manager.js';

import { MAIN_THREAD } from './webchat-store.js';

export function cleanupAgentSessionsForThread(messagingGroupId: string, threadId: string): void {
  const lookupThreadId = threadId === MAIN_THREAD ? null : threadId;
  const sessions = getSessionsForMessagingGroupThread(messagingGroupId, lookupThreadId);

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
    deleteSession(session.id);
    log.info('Deleted agent session for web thread', {
      sessionId: session.id,
      agentGroupId: session.agent_group_id,
      threadId,
    });
  }
}
