const codeBlockCopyPayloadMarker = "|";

export function encodeCodeBlockCopyPayload(value: string): string {
  return `${codeBlockCopyPayloadMarker}${JSON.stringify(value)}${codeBlockCopyPayloadMarker}`;
}

export function decodeCodeBlockCopyPayload(value: string): string {
  if (
    value.length < 2 ||
    !value.startsWith(codeBlockCopyPayloadMarker) ||
    !value.endsWith(codeBlockCopyPayloadMarker)
  ) {
    return value;
  }
  try {
    const decoded = JSON.parse(value.slice(1, -1));
    return typeof decoded === "string" ? decoded : value;
  } catch {
    return value;
  }
}
