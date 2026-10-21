/**
 * notification-channel.ts — Which channel is this session running on?
 *
 * A session spawned on behalf of a non-interactive caller (a `claude --print`
 * inference child, a scheduled job) declares it by setting
 *   WORKOS_NOTIFICATION_CHANNEL=<name>   (e.g. "headless")
 * in the child's env. LoadContext skips dynamic context injection for those,
 * so a one-shot child does not carry the interactive session's context.
 *
 * Unset means the normal interactive session. This is deliberately NOT inferred
 * from TERM / TERM_PROGRAM / SSH_TTY: a sandboxed or containerized TUI can run
 * with none of those set and must still get its session context.
 */

export type NotificationChannel = 'interactive' | 'headless' | string;

/**
 * Read the current channel from the env. An explicit
 * WORKOS_NOTIFICATION_CHANNEL always wins; otherwise 'interactive'.
 * ('desktop' is accepted as a legacy synonym for 'interactive'.)
 */
export function getNotificationChannel(): NotificationChannel {
  const raw = process.env.WORKOS_NOTIFICATION_CHANNEL;
  if (raw && raw.length > 0 && raw !== 'desktop') return raw as NotificationChannel;
  return 'interactive';
}

/** True for the normal interactive session (channel unset). */
export function isInteractiveChannel(): boolean {
  return getNotificationChannel() === 'interactive';
}
