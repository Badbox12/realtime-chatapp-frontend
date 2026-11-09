// Type-only imports from the Elysia server (web/api-contract, copied from the API repo by `bun run sync:api`). Nothing here ships to
// the browser bundle — it only keeps client and server contracts in sync.
export type { App } from "../../api-contract/index";
export type {
  ClientEvent,
  ServerEvent,
  Message,
  RoomSummary,
} from "../../api-contract/protocol";

import type { Message } from "../../api-contract/protocol";

/** A message we've sent but the server hasn't acked yet. */
export type PendingMessage = Omit<Message, "id" | "seq" | "createdAt"> & {
  pending: true;
};

export type ChatMessage = (Message & { pending?: false }) | PendingMessage;

export type User = { id: string; username: string };

export type ConnectionStatus = "connecting" | "online" | "reconnecting";
