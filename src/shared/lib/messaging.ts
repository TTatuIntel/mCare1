/**
 * Conversations, worked out from the one list of messages.
 *
 * A message is a row between two people. A conversation is not stored: it is
 * every message between the signed-in person and one other person, so both
 * of them always see the same thread, in every portal.
 */
import type { PatientMessage } from './types'

export interface Conversation {
  /** The other person. */
  otherId: string
  /** The newest message, either way. Absent when nothing has been said yet. */
  last?: PatientMessage
  /** Messages from the other person that have not been read. */
  unread: number
}

const between = (m: PatientMessage, a: string, b: string) => (m.fromId === a && m.toId === b) || (m.fromId === b && m.toId === a)

/** The messages between two people, oldest first (the order they are loaded in). */
export const threadOf = (messages: PatientMessage[], meId: string, otherId: string) => messages.filter(m => between(m, meId, otherId))

/** Everyone this person has exchanged a message with. */
export const partnersOf = (messages: PatientMessage[], meId: string): string[] =>
  [...new Set(messages.filter(m => m.fromId === meId || m.toId === meId).map(m => (m.fromId === meId ? m.toId : m.fromId)))]

/**
 * One conversation per person in `otherIds`: those with unread messages first, then the most recent,
 * then the people not written to yet, in the order given.
 */
export function conversationsOf(messages: PatientMessage[], meId: string, otherIds: string[]): Conversation[] {
  const rows = otherIds.map((otherId, given) => {
    let last: PatientMessage | undefined, order = -1, unread = 0
    messages.forEach((m, i) => {
      if (!between(m, meId, otherId)) return
      last = m; order = i
      if (m.fromId === otherId && !m.read) unread++
    })
    return { otherId, last, unread, order, given }
  })
  return rows
    .sort((a, b) => Number(b.unread > 0) - Number(a.unread > 0) || b.order - a.order || a.given - b.given)
    .map(({ otherId, last, unread }) => ({ otherId, last, unread }))
}
