export function encodeUtf8Base64(value: string): string {
  return globalThis.btoa(unescape(encodeURIComponent(value)));
}

export function decodeUtf8Base64(value: string): string {
  const binary = globalThis.atob(value.replace(/\s/g, ''));
  return decodeURIComponent([...binary].map((character) => `%${character.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''));
}

export function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
