import type { TelegramRouteOutputRecord } from "@curator/db";

export type ChannelSignaturePreview = {
  enabled: boolean;
  text?: string;
  channelHandle?: string;
  rendered: string;
};

export function applyRouteOutputSignature(caption: string, routeOutput: Pick<TelegramRouteOutputRecord, "signatureEnabled" | "signatureText" | "signatureChannelHandle">): string {
  const preview = buildChannelSignaturePreview(routeOutput);
  const cleanCaption = caption.trim();
  if (!preview.enabled || preview.rendered.length === 0) return cleanCaption;
  if (cleanCaption.length === 0) return preview.rendered;
  return `${cleanCaption}\n\n${preview.rendered}`;
}

export function buildChannelSignaturePreview(routeOutput: Pick<TelegramRouteOutputRecord, "signatureEnabled" | "signatureText" | "signatureChannelHandle">): ChannelSignaturePreview {
  const text = normalize(routeOutput.signatureText);
  const channelHandle = normalize(routeOutput.signatureChannelHandle);
  const enabled = routeOutput.signatureEnabled === true && (text !== undefined || channelHandle !== undefined);
  const rendered = enabled ? [text, channelHandle].filter((value): value is string => value !== undefined).join("\n") : "";
  return {
    enabled,
    ...(text === undefined ? {} : { text }),
    ...(channelHandle === undefined ? {} : { channelHandle }),
    rendered
  };
}

export function isValidSignatureChannelHandle(value: string | undefined): boolean {
  if (value === undefined || value.trim().length === 0) return true;
  return /^@[A-Za-z0-9_]{5,32}$/.test(value.trim());
}

function normalize(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}
