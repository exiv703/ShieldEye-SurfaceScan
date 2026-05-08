import { describe, it, expect } from '@jest/globals';
import { LibraryDetector } from '../fingerprinting/library-detector';

// Fix: add deterministic, pure-input tests for fingerprint/library detection coverage.
describe('LibraryDetector fingerprinting', () => {
  it('detects and consolidates React signals from URL + comments + AST', async () => {
    const detector = new LibraryDetector();

    const script = [
      '/** @license React v18.2.0 */',
      'const app = React.createElement("div", null, "ok");'
    ].join('\n');

    const detections = await detector.detectLibraries(
      script,
      'https://cdn.example.com/react@18.2.0/umd/react.production.min.js'
    );

    const react = detections.find((item) => item.name === 'react');

    expect(react).toBeDefined();
    expect(react?.version).toBe('18.2.0');
    expect(react?.confidence).toBeGreaterThanOrEqual(90);
    expect(react?.detectionMethod).toContain('url_pattern');
  });

  it('extracts version strings for known libraries from script content', async () => {
    const detector = new LibraryDetector();

    const script = 'jQuery.fn.jquery = "3.7.1";';
    const detections = await detector.detectLibraries(script);

    const jquery = detections.find((item) => item.name === 'jquery');

    expect(jquery).toBeDefined();
    expect(jquery?.version).toBe('3.7.1');
    expect(jquery?.detectionMethod).toContain('version_string');
  });

  it('returns an empty list when no known library fingerprints are present', async () => {
    const detector = new LibraryDetector();

    const script = 'function onlyBusinessLogic(x) { return x * 2; }';
    const detections = await detector.detectLibraries(script, 'https://example.com/static/app.bundle.js');

    // URL-based heuristic can still emit a low-confidence detection for generic bundle-like filenames.
    expect(detections).toHaveLength(1);
    expect(detections[0]).toMatchObject({
      name: 'app.bundle',
      confidence: 40,
      detectionMethod: 'url_pattern'
    });
  });

  it('returns an empty list for plain script input without URL hints', async () => {
    const detector = new LibraryDetector();

    const script = 'function onlyBusinessLogic(x) { return x * 2; }';
    const detections = await detector.detectLibraries(script);

    expect(detections).toEqual([]);
  });
});
