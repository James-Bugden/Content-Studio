import { expect, it } from 'vitest';
import { EXPORT_TYPE, exportSize, imageFilename, isSvgSource } from '@/components/image-transfer';

it('scales SVG previews to 1080 px wide and keeps raster sizes', () => {
  expect(exportSize({ width: 540, height: 675 }, true)).toEqual({ width: 1080, height: 1350 });
  expect(exportSize({ width: 1080, height: 1920 }, true)).toEqual({ width: 1080, height: 1920 });
  expect(exportSize({ width: 2000, height: 1000 }, false)).toEqual({ width: 2000, height: 1000 });
});

it('refuses empty or unknown sizes instead of exporting a blank image', () => {
  expect(exportSize({ width: 0, height: 0 }, true)).toBeNull();
  expect(exportSize({ width: 100, height: 0 }, false)).toBeNull();
});

it('detects SVG sources and always exports PNG', () => {
  expect(isSvgSource('/api/library/SYN-L012/render?rev=current&m=1')).toBe(true);
  expect(isSvgSource('data:image/svg+xml;utf8,<svg/>')).toBe(true);
  expect(isSvgSource('/api/library/SYN-L012/asset?m=1')).toBe(false);
  expect(EXPORT_TYPE).toBe('image/png');
});

it('builds a PNG filename from the slug, falling back to the content id', () => {
  expect(imageFilename('Offer Email Teardown')).toBe('offer-email-teardown-1.png');
  expect(imageFilename('求職', 'SYN-L1')).toBe('syn-l1-1.png');
});
