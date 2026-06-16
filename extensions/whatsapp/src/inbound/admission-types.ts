import type { ResolvedChannelMessageIngress } from "openclaw/plugin-sdk/channel-ingress-runtime";
import type { ReplyToMode } from "openclaw/plugin-sdk/config-contracts";

type WhatsAppInboundIngressDecision = Pick<
  ResolvedChannelMessageIngress["ingress"],
  "admission" | "decision" | "decisiveGateId" | "reasonCode"
>;

type WhatsAppInboundSenderAccess = Pick<
  ResolvedChannelMessageIngress["senderAccess"],
  "allowed" | "decision" | "reasonCode" | "providerMissingFallbackApplied"
>;

type WhatsAppInboundCommandAccess = Pick<
  ResolvedChannelMessageIngress["commandAccess"],
  "requested" | "authorized" | "shouldBlockControlCommand" | "reasonCode"
>;

type WhatsAppInboundActivationAccess = Pick<
  ResolvedChannelMessageIngress["activationAccess"],
  "ran" | "allowed" | "shouldSkip" | "reasonCode"
>;

export type WhatsAppInboundAdmissionAccess = {
  ingress: WhatsAppInboundIngressDecision;
  senderAccess: WhatsAppInboundSenderAccess;
  commandAccess: WhatsAppInboundCommandAccess;
  activationAccess: WhatsAppInboundActivationAccess;
};

export type WhatsAppInboundAdmissionPolicy = {
  account: {
    accountId: string;
    name?: string;
    enabled: boolean;
    sendReadReceipts: boolean;
    selfChatMode?: boolean;
    replyToMode?: ReplyToMode;
  };
  isSelfChat: boolean;
  isSamePhone: (value?: string | null) => boolean;
};

/**
 * Public-safe accepted inbound facts resolved by access control.
 *
 * Keep this as an admission envelope around canonical channel ingress
 * projections. Later PRs can migrate consumers to these projections without
 * publishing raw allowlist material or session-dependent post-admission state.
 */
export type WhatsAppInboundAdmission = {
  accountId: string;
  isSelfChat: boolean;
  account: {
    accountId: string;
    name?: string;
    enabled: boolean;
    sendReadReceipts: boolean;
    selfChatMode?: boolean;
    replyToMode?: ReplyToMode;
  };
  conversation: {
    kind: "direct" | "group";
    id: string;
    groupSessionId: string;
  };
  sender: {
    id: string;
    isSamePhone: boolean;
  };
  ingress: WhatsAppInboundIngressDecision;
  senderAccess: WhatsAppInboundSenderAccess;
  commandAccess: WhatsAppInboundCommandAccess;
  activationAccess: WhatsAppInboundActivationAccess;
};
