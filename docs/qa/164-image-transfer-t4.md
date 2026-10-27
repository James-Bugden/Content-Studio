# #164 image transfer: owner T4 checklist

Full procedure, known Chromium drag limitation and fix-round notes:
`docs/testing/image-transfer.md`. This page is the short owner run sheet.
Use synthetic images only; cancel every composer, never publish.

Candidate commit / URL: ______  Browser/OS: ______  Phone/OS: ______  Date/tester: ______

## Steps (Chrome desktop, repeat per target)

1. Sign in as owner. Open a post with an image (Visuals, Ready/Schedule panel, Published detail).
2. Drag the image into the target's upload area. Record whether an attachment appears.
3. Choose Copy image, click in the composer, press Ctrl/Cmd+V. Record whether it attaches.
4. Choose Download, then upload the PNG with the file picker. Check it is a PNG named `<slug>-1.png`.
5. Keyboard: Tab to Copy image and Download, press Enter. At 375 px check the buttons are 44 px tall and nothing overflows.
6. Phone: tap Share (shown only when the browser can share files), pick an app, check arrival, cancel. If Share is absent, use Download.

## Results

| Target | Drag | Copy then paste | Download then upload | Share (phone) | Notes |
| --- | --- | --- | --- | --- | --- |
| LinkedIn web, Chrome | | | | n/a | |
| Threads web, Chrome | | | | n/a | |
| Instagram web, Chrome | | | | n/a | |
| Safari desktop | | | | n/a | |
| Firefox desktop | | | | n/a | |
| iPhone Safari | n/a | | | | |
| Android Chrome | n/a | | | | |
