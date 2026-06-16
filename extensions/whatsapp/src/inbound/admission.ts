import type {
  WhatsAppInboundAdmission,
  WhatsAppInboundAdmissionAccess,
  WhatsAppInboundAdmissionPolicy,
} from "./admission-types.js";
import { resolveWhatsAppGroupConversationId } from "./group-conversation.js";
import type {
  AdmittedWebInboundMessage,
  DeprecatedWebInboundAdmissionTopLevelFields,
  WebInboundCallbackMessage,
  WebInboundMessage,
} from "./types.js";

export type { WhatsAppInboundAdmission } from "./admission-types.js";

function copyAccount(
  account: WhatsAppInboundAdmissionPolicy["account"],
): WhatsAppInboundAdmission["account"] {
  const copied: WhatsAppInboundAdmission["account"] = {
    accountId: account.accountId,
    enabled: account.enabled,
    sendReadReceipts: account.sendReadReceipts,
  };
  if (account.name) {
    copied.name = account.name;
  }
  if (typeof account.selfChatMode === "boolean") {
    copied.selfChatMode = account.selfChatMode;
  }
  if (account.replyToMode) {
    copied.replyToMode = account.replyToMode;
  }
  return copied;
}

export function buildWhatsAppInboundAdmission(params: {
  policy: WhatsAppInboundAdmissionPolicy;
  access: WhatsAppInboundAdmissionAccess;
  isGroup: boolean;
  conversationId: string;
  senderId: string;
}): WhatsAppInboundAdmission {
  return {
    accountId: params.policy.account.accountId,
    isSelfChat: params.policy.isSelfChat,
    account: copyAccount(params.policy.account),
    conversation: {
      kind: params.isGroup ? "group" : "direct",
      id: params.conversationId,
      groupSessionId: resolveWhatsAppGroupConversationId(params.conversationId),
    },
    sender: {
      id: params.senderId,
      isSamePhone: params.policy.isSamePhone(params.senderId),
    },
    ingress: {
      admission: params.access.ingress.admission,
      decision: params.access.ingress.decision,
      decisiveGateId: params.access.ingress.decisiveGateId,
      reasonCode: params.access.ingress.reasonCode,
    },
    senderAccess: {
      allowed: params.access.senderAccess.allowed,
      decision: params.access.senderAccess.decision,
      reasonCode: params.access.senderAccess.reasonCode,
      providerMissingFallbackApplied: params.access.senderAccess.providerMissingFallbackApplied,
    },
    commandAccess: {
      requested: params.access.commandAccess.requested,
      authorized: params.access.commandAccess.authorized,
      shouldBlockControlCommand: params.access.commandAccess.shouldBlockControlCommand,
      reasonCode: params.access.commandAccess.reasonCode,
    },
    activationAccess: {
      ran: params.access.activationAccess.ran,
      allowed: params.access.activationAccess.allowed,
      shouldSkip: params.access.activationAccess.shouldSkip,
      reasonCode: params.access.activationAccess.reasonCode,
    },
  };
}

export function buildDeprecatedFlatWhatsAppInboundAdmission(
  msg: Partial<DeprecatedWebInboundAdmissionTopLevelFields> & {
    platform?: WebInboundCallbackMessage["platform"];
    senderE164?: string | null;
    senderJid?: string | null;
    senderName?: string | null;
  },
): WhatsAppInboundAdmission {
  const conversationId = msg.conversationId || msg.from;
  if (!conversationId || !msg.accountId || !msg.chatType) {
    throw new Error(
      "WhatsApp legacy flat inbound messages must include deprecated top-level admission fields.",
    );
  }
  const accountId = msg.accountId;
  const admitted = msg.accessControlPassed !== false;
  const platformSender = msg.platform?.sender;
  const senderE164 = platformSender?.e164 ?? msg.platform?.senderE164 ?? msg.senderE164;
  const senderJid = platformSender?.jid ?? msg.platform?.senderJid ?? msg.senderJid;
  const senderName = platformSender?.name ?? msg.platform?.senderName ?? msg.senderName;
  const senderId =
    msg.chatType === "group"
      ? (senderE164 ?? senderJid ?? senderName ?? conversationId)
      : (senderE164 ?? conversationId);
  const reasonCode = admitted
    ? msg.chatType === "group"
      ? "group_policy_allowed"
      : "dm_policy_allowlisted"
    : "no_policy_match";

  // Compatibility only: deprecated listenerFactory flat inputs predate the
  // admission envelope, so convert them through the canonical admission builder.
  // Canonical nested inputs without admission remain malformed for runtime use.
  return buildWhatsAppInboundAdmission({
    policy: {
      account: {
        accountId,
        enabled: true,
        sendReadReceipts: true,
      },
      isSelfChat: false,
      isSamePhone: () => false,
    },
    access: {
      ingress: {
        admission: admitted ? "dispatch" : "drop",
        decision: admitted ? "allow" : "block",
        decisiveGateId: "legacy-flat-compat",
        reasonCode,
      },
      senderAccess: {
        allowed: admitted,
        decision: admitted ? "allow" : "block",
        reasonCode,
        providerMissingFallbackApplied: false,
      },
      commandAccess: {
        requested: false,
        authorized: false,
        shouldBlockControlCommand: false,
        reasonCode: "command_authorized",
      },
      activationAccess: {
        ran: false,
        allowed: admitted,
        shouldSkip: !admitted,
        reasonCode: admitted ? "activation_allowed" : "activation_skipped",
      },
    },
    isGroup: msg.chatType === "group",
    conversationId,
    senderId,
  });
}

export function requireWhatsAppInboundAdmission(params: {
  admission?: WhatsAppInboundAdmission;
}): WhatsAppInboundAdmission {
  if (!params.admission) {
    throw new Error("WhatsApp inbound message is missing admission facts");
  }
  return params.admission;
}

export function requireAdmittedWhatsAppInboundMessage(
  msg: WebInboundMessage,
): AdmittedWebInboundMessage {
  requireWhatsAppInboundAdmission(msg);
  return msg as AdmittedWebInboundMessage;
}
