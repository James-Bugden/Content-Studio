# CS-061b / #164 image transfer: owner T4 checklist

Issue: https://github.com/James-Bugden/Content-Studio/issues/164

## Expected behaviour and known Chromium limitation

**Copy image and Download are the reliable paths offered by Content Studio.**
Copy image writes PNG bytes to the clipboard; whether pasting attaches an image
depends on the destination composer. If paste is rejected, Download the PNG and
select it in the destination's upload picker. Share appears only when the browser
supports sharing that PNG File; acceptance depends on the selected phone app.

**Chromium strips the JS-created File in native cross-frame drops.** In the build
round's Chromium test at 375 and 1280 px, native dragstart contained exactly
`Files`, with one `image/png` File named `researched-range-1.png` and no string
data. The receiving frame's native drop event nevertheless had `files: []`.
Drag-out of a generated File may not work in all targets. Successful native
cross-site, cross-tab or external-app delivery is not established by CI.

The repository Playwright spec runs in the normal `w375` and `w1280` projects. It
checks native dragstart privacy and cancels the drag; separately, it dispatches
controlled dragstart/drop events using the prepared File and asserts **object
identity**, PNG type/name/signature and size in a test-only receiver. Controlled
events do not prove native transfer across frames or sites. There are no
expected-failing native-drop tests counted as successful CI outcomes.

Native `<img draggable>` URL-based behaviour must not be substituted for the
File-only handler: the issue's acceptance criterion requires no image URL or
token in dragged data, even if an asset URL requires the owner's session.

## Fix-round behaviour to check

- Published list cards show no image and make no image-byte requests. Open the
  existing Published detail page for the recorded Schedule image and its actions.
- Calendar, backlog, home, queue and review thumbnails do not encode a PNG on
  load. Pointer entry, keyboard focus, touch or click starts preparation. Drag
  becomes available after preparation; open the post for Copy image/Download.
- Visuals has one action group and one polite transfer status per distinct saved
  image, on the full-size preview. Phone-width copies only display the image.
  The live brief preview cannot copy, download or drag: only saved Library or
  Schedule images are transferable. Saving/rendering remains the existing flow.
- Downloads use the Library slug. A non-ASCII or empty slug uses the unique
  Library content ID; Schedule has no slug field, so its detail uses Content ID.
- When Copy is unsupported, a visible status explanation also describes the
  disabled button. Download stays available. Cancelling Share shows no error.

## Candidate and procedure

Use synthetic images only. Fill in the exact deployed candidate commit/build
and browser/OS versions before starting. No deployment or physical-device pass
is claimed by the local build/fix rounds.

- Candidate commit / deployment URL: **pending**
- Desktop browser / version / OS: **pending**
- Phone browser / version / OS / destination app: **pending**
- Date / tester: **pending**

1. Sign in as owner. Open a Visuals SVG-only preview, then a post with a finished
   raster image in Ready/Schedule and Published detail. Check the intended image is
   shown, actions enable after preparation, and downloaded output is PNG with a
   sensible `-1.png` name. Repeat transfer checks for both SVG-derived and
   finished raster PNGs. Check a zh-TW slug falls back to its unique content ID,
   the Published list requests no images, thumbnails prepare only on interaction,
   and the unsaved live preview offers no transfers.
2. Open an empty composer in the target app. Try a real mouse drag from the image
   into its upload area. Record whether a visible image attachment arrives;
   `dragstart` alone is not success. Where possible, repeat in a separate tab and
   window. Cancel the composer afterwards; publishing is outside this check.
3. Choose Copy image, then Ctrl/Cmd+V in the composer. Record whether the intended
   image attaches. Choose Download and upload the saved PNG through the file
   picker regardless of the drag/paste result. Verify the rendered image.
4. On phone, open the image and tap Share if offered. Select an available
   image-capable destination and check arrival; cancel posting. Record when
   Share is absent or the app rejects it, and check Download as fallback.
5. Check keyboard focus and activation for Copy image/Download. Check the
   375 px layout has no document overflow. In a browser without clipboard-image
   support, check the visible explanation and its accessible description. Cancel
   Share and check that no failure is announced. Do not store private post content,
   owner identifiers, session cookies or production screenshots as evidence.

## Results table for the PR

All rows are **pending owner T4**, not passes. Record browser/OS, image source,
drag result, paste result, Download/upload result and phone Share result. Copy
this table or link this document in the PR and attach synthetic-only evidence.

| Target | Required check / expectation | Actual result / evidence |
| --- | --- | --- |
| LinkedIn web, desktop Chrome | Real drag into composer; Copy/paste; downloaded-PNG upload. Drag may lose the generated File. | Pending owner T4. |
| Threads web, desktop Chrome | Real drag into a new post; Copy/paste; downloaded-PNG upload. Record visible attachment separately for each path. | Pending owner T4. |
| Instagram web, desktop Chrome | Real drag into Create/upload; try paste if accepted; upload saved PNG. Do not assume image-paste support. | Pending owner T4. |
| Desktop Safari | Repeat composer checks and note version/OS; verify Download even when drag or clipboard-image APIs are unavailable. | Not tested; pending owner T4. |
| Desktop Firefox | Repeat composer checks and note version/OS; record disabled Copy if required APIs are absent; verify Download. | Not tested; pending owner T4. |
| iPhone / Safari | Verify file Share when offered, visible image in destination, cancellation and Download. Mouse drag is not the phone workflow. | Physical device pending. |
| Android / Chrome | Verify file Share when offered, destination acceptance, cancellation and Download. CI mocks capability only. | Physical device pending. |

Native transfer acceptance remains partial until actual target checks are
recorded. CI checks the File-only payload and reliable in-app export actions;
it cannot establish OS share-sheet or external-composer support.
