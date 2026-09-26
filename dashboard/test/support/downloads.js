import { vi } from 'vitest';
import { downloadCSV, toCSV } from '../../src/utils/csv.js';

// The CSV files the page exported, as the user gets them: the name of the
// download and the content of the real toCSV. The test file replaces
// downloadCSV only:
//
//   vi.mock('../src/utils/csv.js', async (importOriginal) => ({
//     ...(await importOriginal()),
//     downloadCSV: vi.fn(),
//   }));
export function csvDownloads() {
  return vi.mocked(downloadCSV).mock.calls.map(([rows, columns, filename]) => ({
    name: `${filename}.csv`,
    content: toCSV(rows, columns),
  }));
}

// The files the page downloads through a blob URL and a link click, like the
// Markdown report, from now on. Each one has a name, a type and a content
// to await.
export function captureFileDownloads() {
  const files = [];
  const blobs = new Map();
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    const url = `blob:test/${blobs.size + 1}`;
    blobs.set(url, blob);
    return url;
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
    const blob = blobs.get(this.href);
    files.push({ name: this.download, type: blob.type, content: blob.text() });
  });
  return files;
}
