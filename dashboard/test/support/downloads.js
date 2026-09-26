import { vi } from 'vitest';

// Captures the files the page downloads from now on: the CSV exports and the
// Markdown report go through a blob URL and a click on a link. Returns a
// function that reads them, as the user gets them: name, type and content.
// The content keeps its byte order mark, which Blob.text() would drop.
export function captureFileDownloads() {
  const downloads = [];
  const blobs = new Map();
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    const url = `blob:test/${blobs.size + 1}`;
    blobs.set(url, blob);
    return url;
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
    downloads.push({ name: this.download, blob: blobs.get(this.href) });
  });
  const utf8 = new TextDecoder('utf-8', { ignoreBOM: true });
  return () => Promise.all(downloads.map(async ({ name, blob }) => ({
    name,
    type: blob.type,
    content: utf8.decode(await blob.arrayBuffer()),
  })));
}
