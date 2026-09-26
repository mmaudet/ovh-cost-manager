import { vi } from 'vitest';
import { screen, within } from '@testing-library/react';

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

// The byte order mark that starts the CSV files, so that Excel reads their
// accents as UTF-8
export const BOM = '\uFEFF';

// A CSV file as the page exports it: its name, its type, and its lines after
// the byte order mark
export const csvFile = (name, lines) => ({
  name,
  type: 'text/csv;charset=utf-8',
  content: BOM + lines.join('\n'),
});

// Downloads the CSV file of the table of a panel, from the panel, then from
// its "show all" modal. Returns both files.
export async function downloadFromPanelAndModal(user, panel) {
  const downloadedFiles = captureFileDownloads();
  await user.click(within(panel).getByRole('button', { name: 'CSV' }));
  await user.click(within(panel).getByRole('button', { name: /^(Tout afficher|Show all)$/ }));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'CSV' }));
  return downloadedFiles();
}
