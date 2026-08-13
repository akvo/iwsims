# Mobile — "From Gallery" for Missing Photos

**Status**: Workstreams A–H implemented; lint + prettier clean, **unit tests written but
not run** — see [Blocked: the test suite cannot run](#blocked-the-test-suite-cannot-run).
**Target**: `app/src/components/FormDataDetails/ImageView.js` (extracted from
`app/src/pages/FormData/FormDataDetails.js` in Task 0)

> Not to be confused with `doc/claude/photo-gallery/`, which is the **web landing-page
> carousel**. Unrelated feature, unrelated codebase.

---

## Goal

When an enumerator opens an unsynced datapoint whose photo file has gone missing from the
device, the only repair offered today is **Retake photo** → camera. Enumerators review
their submissions back in the office, days after the site visit, where a camera is
useless. Add a **From Gallery** button beside it so the correct photo can be picked from
device storage instead.

## Problem

`persistImage` moves photos into `documentDirectory/images/` so pending submissions
survive cache purges. Submissions taken on builds **before** that change still point into
`cacheDirectory`, which Android reclaims under storage pressure. Those datapoints open in
the office with the file gone and a camera-only repair path.

---

## ⚠️ Residual risk — a photo can still go missing

`persistImage` narrowed the problem; it did not close it. Five paths in the **current**
`app/` code still produce a datapoint whose photo file is absent. **All five are in scope
for this work** — the gallery button alone would have left three of them open.

### Why it matters more than a broken thumbnail

A missing file is not cosmetic — it makes the datapoint **permanently unsyncable**:

```
file missing → api.post('/images', formData) rejects
             → failedDataIDs.add(d.id)
             → crudDataPoints.saveAsPending(db, d.id)   // sets syncedAt = null
             → next sync: same failure, forever
```

`saveAsPending` only writes `syncedAt: null` — **there is no retry counter and no cap**.
The datapoint re-enters the queue on every timer, manual, and background sync and fails
identically each time, burning battery and request quota on a submission that can never
succeed until a human intervenes.

> **Implemented differently than first designed.** The original plan added a persisted
> `syncAttempts` column and parked a row after 5 failures. That was rejected during
> implementation for two reasons: counting attempts is a *proxy* for "permanently broken"
> when `getInfoAsync` answers the question directly, and a blanket cap would permanently
> park submissions whose only problem was a transient server error. The shipped fix checks
> file existence and skips exactly those rows — no migration, no schema change, and
> transient failures keep retrying. See [Task 9](#task-9--d-skip-datapoints-whose-file-is-gone).

The *user-facing* half of this is already handled: `Submission.js` computes `needsRetake`
per unsynced row (a `getInfoAsync` existence check over every `file://` answer) and
renders a `retakeBadge` reading `trans.photoMissingText`. So the list already flags which
submission is broken. What is missing is the **cap** — the sync loop itself never gives up.

### The five paths

| # | Path | Fix in this work |
|---|---|---|
| **R1** | Submissions taken on builds **before** `persistImage` still point into `cacheDirectory`; Android reclaims it under storage pressure | Gallery repair button (F1–F7) |
| — | *All of R1/R2/R4 leave the pixels destroyed, so the repair button can only attach a **substitute** image. Workstream **H** mirrors captures to the device gallery so the original is genuinely recoverable.* | [Task 13](#task-13--h-copy-captures-to-the-device-gallery) |
| **R2** | `persistImage` **silently falls back to the cache uri** on any failure (`moveAsync` error, no free space) — the answer is then stored in purgeable storage exactly as before | Gallery repair + Sentry on the fallback (F8) |
| **R3** | A **synced** datapoint holds server paths; offline or a 404 makes the remote `Image` fire `onError`, showing "Photo file is missing on this device. Retake it to allow syncing." with **no buttons** — `showRetake`/`showGallery` both require `file://` | Separate remote-failure copy (F9–F10) |
| **R4** | Android auto-backup restore to a new device: `allowBackup` is **not disabled** in `app.json`, so SQLite rows can be restored without all of `files/images/` | Gallery repair button, if still unsynced |
| **R5** | `TypeImage` and `TypeAttachment` have **no `onError` handler** — a draft whose photo vanished shows a blank preview with no warning | `onError` + missing notice (F12) |

### R2 in detail — the silent fallback

```js
// src/lib/image-compressor.js
export const persistImage = async (uri, subDir = 'images') => {
  try {
    ...
    await FileSystem.moveAsync({ from: uri, to });
    return to;
  } catch (error) {
    console.error('[ImageCompressor] Persist failed, keeping cache uri:', error);
    return uri;          // ← back in purgeable storage, and nobody is told
  }
};
```

`console.error` only — **no `Sentry.captureException`**, unlike the compression failure
path a few lines away. A device low on space fails the move, keeps a cache uri, purges it
hours later, and the submission becomes unsyncable with no trace anywhere.

#### Field evidence — why R2 is the prime suspect

A partner reported a `File missing` badge on a submission **created 29 Jul 2026**, well
after the persist fixes landed on 13 Jul. Tracing it ruled the other causes out and left
R2 standing.

| Commit | 13 Jul 2026 | What |
|---|---|---|
| `ffc07486` | 14:49:**10** | `persistImage` for **photos** |
| `8c951c4f` | 14:49:**11** | bump to `4.1.29` / versionCode **4129** |
| `01d3f6b2` | 15:29:40 | `persistImage` for **attachments** + badge reworded |
| `713ea04d` | later | cascade answer serialization fix |

At 4129, `TypeAttachment` still did `onChange(id, result?.uri)` with
`copyToCacheDirectory: true` — attachments went straight into the cache. That was fixed by
`01d3f6b2`, which landed **40 minutes after the version bump**, and `origin/main` is
**still on versionCode 4129** today.

**The reporting device nevertheless has that fix.** The badge in the report reads
`File missing`; at 4129 the string was `photoMissingText: 'Photo missing'`, and
`01d3f6b2` is the commit that reworded it to `File missing` / `Fichier manquant`. So the
partner runs a *rebuilt* 4129 containing both persist paths — the build is newer than its
version number claims.

With both persist paths active on that device, R2's silent catch is the only remaining
in-code route to a lost file. It cannot be confirmed from telemetry because it does not
emit any — which is the whole argument for F8.

Ruled out while tracing: signatures store base64 data URLs, not files (`TypeSignature`
passes the canvas `dataURL` straight to `onChange`); `cascades.dropFiles` only deletes
`SQLite/*sqlite*`; the post-sync `deleteAsync` runs only after a 200 response plus
`markSynced`.

#### Release hygiene — two builds share one version number

`use-version-check.js` asks the backend `api.get('/apk/version/${appVersion}')` using the
**version string**. A rebuild that is not renumbered is therefore invisible to the update
check: it cannot be offered as an update, and a device in the field cannot be mapped back
to the code it runs. Two materially different builds are both called 4129 right now.

**Bump to `4.1.30` / versionCode `4130` as part of shipping this work**, so that
`01d3f6b2`, `713ea04d` and everything here reach devices through the normal update path.

### Scope summary

| Workstream | Files | Addresses |
|---|---|---|
| **A** — "From Gallery" repair button | `FormDataDetails.js` | R1, R2, R4 |
| **B** — Sentry on the `persistImage` fallback | `image-compressor.js` | R2 visibility |
| **C** — Remote-failure vs local-missing copy | `FormDataDetails.js`, `ui-text.js` | R3 |
| **D** — Skip datapoints whose file is verifiably gone | `background-task.js` | the forever-loop |
| **E** — `onError` on the form field | `TypeImage.js` | R5 |
| **F** — Version bump `4.1.30` / `4130` | `app.json`, `package.json`, `build.json` | unreleased fixes stranded on 4129 |
| **G** — Extract components to `src/components/FormDataDetails/` | new folder + `FormDataDetails.js` | testability; prerequisite for A and C |
| **H** — Copy captures to the device gallery | `TypeImage.js`, migration `09`, Settings, `+expo-media-library` | gives R1/R2/R4 a real **recovery source** |

---

## Requirements

| # | Requirement |
|---|---|
| F1 | A `From Gallery` button appears alongside `Retake photo` in the missing-file block of `ImageView`. |
| F2 | Same visibility gate as `Retake photo`: file missing, uri is `file://`, `canRetake` true, question type is `photo`. |
| F3 | Opens the device image library. No permission prompt — `launchImageLibraryAsync` needs none. |
| F4 | Picked image runs the same pipeline as a retake: compress at `imageQuality` → `persistImage` → update `FormState.currentValues` → `crudDataPoints.updateJson` → success toast. |
| F5 | Cancelling leaves the answer untouched and shows no toast. |
| F6 | While processing, the existing `isRetaking` spinner + `processingLabel` shows. |
| F7 | Label uses the existing `trans.buttonFromGallery` key — already in `en` and `fr`. |
| F8 | `persistImage`'s catch calls `Sentry.captureException` (and a `captureMessage` naming the uri) before returning the cache uri, so the silent fallback becomes observable. |
| F9 | `ImageView` distinguishes **local file missing** (`file://`) from **remote load failure** (server path). A remote failure shows connection copy, not the retake copy. |
| F10 | A remote failure offers a **Try again** button that re-attempts the image load. It never offers Retake or From Gallery — there is nothing local to repair. |
| F11 | A datapoint whose local file is **verifiably absent** is never uploaded: the sync run checks existence, skips it without counting a failure, and moves on. Transient failures (server 5xx, dropped connection) keep their existing retry behaviour untouched. |
| F12 | `TypeImage` renders an explicit "File missing" notice when a stored photo fails to load, instead of a blank preview. The existing camera/gallery buttons remain the repair path. |

### Workstream H

| # | Requirement |
|---|---|
| F13 | When a photo is captured **with the camera** in `TypeImage`, a copy is also written to the device gallery, into an album named from `BuildParamsState.apkName` — never a hardcoded literal, so a rebranded APK groups photos under its own name. |
| F14 | The behaviour is **off by default** and controlled by a `saveToGallery` setting under Settings → Advanced, following the exact pattern `imageQuality` already uses (`config` table → `BuildParamsState` → Settings dropdown). |
| F15 | Gallery write is **best-effort and never blocks the answer**: a denied permission or a failed write is captured to Sentry, the form value is still set from `persistImage`, and no error is shown to the enumerator. |
| F16 | Permission is requested on first capture after the setting is enabled — never at app start, and never when the setting is off. **Full access, not write-only**: grouping into an album has to *read* MediaStore to find whether the album already exists. |
| F17 | Photos picked *from* the gallery are **not** copied back (they are already there), and neither are attachments or signatures. |

### Non-functional

- Compression failure must not block the swap — fall back to the uncompressed uri, as
  `handleRetake` already does.
- `persistImage` is mandatory: a gallery pick lands in the purgeable cache dir and would
  vanish before sync otherwise.

### Out of scope

| Excluded | Why |
|---|---|
| Signature answers | Replacing a signature with an arbitrary picked image weakens its meaning. Currently has `onRetake = null`. |
| Image attachments | Already reach the gallery through the `DocumentPicker` re-attach flow. |
| Swapping a photo that loads fine | Would let enumerators overwrite good photos on an unsynced datapoint. |

---

## Design

### Module layout after extraction

`FormDataDetails.js` is 585 lines holding one page **and** three presentational
components, none of them exported. Task 0 splits them out, following the existing
`BaseLayout/` and `CenterLayout/` convention (folder + `index.js` + siblings + `styles.js`
+ `__tests__/`):

```
src/components/FormDataDetails/
├── index.js            barrel — re-exports the three components
├── ImageView.js        photo / image-attachment renderer + repair buttons
├── AttachmentView.js   non-image attachment renderer + re-attach button
├── SubtitleContent.js  per-question-type answer renderer
├── styles.js           styles used by more than one of them
└── __tests__/
    ├── ImageView.test.js
    ├── AttachmentView.test.js
    └── SubtitleContent.test.js

src/pages/FormData/
├── FormDataDetails.js  page only: state, handlers, sections, renderItem
└── FormDataNavigation.js   (unchanged, stays a page concern)
```

**Why this is Task 0 and not a follow-up:** every prop in workstreams A and C lands on
`ImageView`. Extracting first keeps the feature diff small and reviewable; extracting
after would mean touching the same lines twice.

### Component tree

```
FormDataDetails (page)
├─ savePhoto(questionKey, imageUri)      ← NEW: shared compress → persist → store → toast
├─ handleRetake(questionKey)             ← camera permission → launchCameraAsync → savePhoto
├─ handlePickFromGallery(questionKey)    ← NEW: launchImageLibraryAsync → savePhoto
└─ renderItem
   ├─ ImageView          (components/FormDataDetails)  ← photo branch passes onPickGallery
   │  └─ missing-file block
   │     └─ [ Retake photo ] [ From Gallery ]
   ├─ AttachmentView     (components/FormDataDetails)
   └─ SubtitleContent    (components/FormDataDetails)
```

### `ImageView` interface

Two new props, mirroring the existing `onRetake` / `retakeLabel` pair. No new state.

| Prop | Type | Default | Purpose |
|---|---|---|---|
| `onRetake` | `fn \| null` | `null` | existing — camera repair |
| `retakeLabel` | `string` | `''` | existing |
| `onPickGallery` | `fn \| null` | `null` | **new** — gallery repair |
| `galleryLabel` | `string` | `''` | **new** |
| `loadFailedText` | `string` | `''` | **new** — remote-failure copy |
| `tryAgainLabel` | `string` | `''` | **new** |
| `isRetaking` | `bool` | `false` | existing — reused for both paths |

Visibility is gated by the same expression that already guards retake:

```
isLocalFile = !!uri?.startsWith('file://')
showRetake  = !!onRetake      && isLocalFile
showGallery = !!onPickGallery && isLocalFile
```

Both buttons live inside the local-file error branch, wrapped in a row `View`.

### Render states

`ImageView` resolves to exactly one of four states, in this precedence order:

| Order | Condition | Renders |
|---|---|---|
| 1 | `isRetaking` | spinner + `processingLabel` |
| 2 | `loadFailed` && local uri | `missingText` + `[Retake photo]` `[From Gallery]` |
| 3 | `loadFailed` && remote uri | `loadFailedText` + `[Try again]` |
| 4 | otherwise | `<Image>` |

The error state is set only by the `Image` `onError` callback — there is no upfront
`getInfoAsync` check on this path, by design (a dead `file://` costs no extra I/O).

### Error state is derived, not latched

`loadFailed` is **not** a boolean. The component stores *which* uri failed and compares:

```js
const [failedUri, setFailedUri] = useState(null);
const loadFailed = !!uri && failedUri === uri;
```

This matters for the repair flow. When a pick succeeds, `FormState.currentValues` changes
and `ImageView` re-renders with a new `uri` — the comparison goes false on its own, so the
new photo shows immediately. A latched boolean would keep the error on screen and would
only clear if the parent forced a remount.

That in turn lets `renderItem` key on `q.id` rather than <code>`${q.id}-${answer}`</code>:
the component now **updates in place** across a pick instead of unmounting and rebuilding.
The `<Image>` itself is still keyed <code>`${uri}-${reloadKey}`</code> so a replacement
file is fetched fresh rather than served from the previous decode, and **Try again**
(`setFailedUri(null)` + `reloadKey` bump) re-requests a remote image.

The same derived-state trick is used in `TypeImage` (workstream E) — `failedUri === value`
— which is why neither component needs a `useEffect` to reset the flag.

### Control flow

```
tap [From Gallery]
  └─ ImagePicker.launchImageLibraryAsync({ base64: true })
       ├─ canceled ────────────────────────────► return, no state change, no toast
       └─ asset picked
            └─ savePhoto(questionKey, uri)
                 ├─ setRetakingKey(questionKey)          → spinner shows
                 ├─ compressImage(uri, imageQuality)
                 │    └─ on throw: Sentry capture, keep original uri
                 ├─ persistImage(uri)                    → documentDirectory/images/
                 ├─ FormState.update(currentValues)      → re-render with new uri
                 ├─ crudDataPoints.updateJson(db, id, …) → survives app restart
                 ├─ ToastAndroid.show(retakeSuccess)
                 └─ finally: setRetakingKey(null)        → spinner clears
```

`handleRetake` and `handlePickFromGallery` differ **only** in the two lines before
`savePhoto`: camera asks for `PermissionsAndroid.PERMISSIONS.CAMERA` then calls
`launchCameraAsync`; gallery asks for nothing and calls `launchImageLibraryAsync`. The
entire tail below `savePhoto` is shared — that duplication is what the extraction removes.

### Wiring in `renderItem`

Only the `QUESTION_TYPES.photo` branch gains the prop. The attachment-image branch and
signature are left alone:

| Branch | `onRetake` | `onPickGallery` |
|---|---|---|
| `attachment` + image file | `handleReattach` (DocumentPicker) | — |
| `photo` | `handleRetake` | `handlePickFromGallery` |
| `signature` | `null` | — |

Both are additionally gated on `canRetake` (`!!datapointId && !isSynced`), unchanged.

### Test IDs

| Element | testID |
|---|---|
| missing text | `${imageTestID}-missing` (existing) |
| retake button | `${imageTestID}-retake` (existing) |
| gallery button | `${imageTestID}-gallery` (**new**) |
| remote-failure text | `${imageTestID}-load-failed` (**new**) |
| try-again button | `${imageTestID}-reload` (**new**) |
| processing block | `${imageTestID}-processing` (existing) |
| `TypeImage` missing notice | `image-missing` (**new**) |

---

## Design decisions

| Decision | Value | Rationale |
|---|---|---|
| Visibility | Only when the file is missing | Matches the existing repair-only flow; a photo is replaceable only when its file is gone |
| Scope | `QUESTION_TYPES.photo` only | The reported scenario; other types have their own paths |
| New props | `onPickGallery`, `galleryLabel` | Mirrors the existing `onRetake` / `retakeLabel` pair |
| Spinner state | Reuse `isRetaking` | Already keyed by question id; a second flag would add nothing |
| Shared save tail | Extract `savePhoto(questionKey, imageUri)` | Camera and gallery differ only in the picker call |
| Permissions | None requested for gallery | `launchImageLibraryAsync` requires none, same as `TypeImage.selectFile` |
| Toast copy | Reuse `trans.retakeSuccess` | "Photo updated. It will be uploaded on the next sync." reads correctly for a gallery pick; a separate string would need new `en`/`fr` entries |
| i18n key | Existing `trans.buttonFromGallery` | Already shipped in `en` and `fr` for `TypeImage` |
| Button layout | Column `View` inside the missing block | Full-width stacked buttons stay legible in French, where "Reprendre la photo" / "De la galerie" truncate badly side by side on narrow devices |

---

## Acceptance criteria

### User AC

Written from the enumerator's seat. Verifiable by hand on a device, no code knowledge needed.

| # | Given | When | Then |
|---|---|---|---|
| U1 | I open a submission I have not synced yet, and its photo no longer opens | the detail screen loads | I see "Photo file is missing on this device" with **two** buttons: **Retake photo** and **From Gallery** |
| U2 | I am in the office with the missing-photo message on screen | I tap **From Gallery** | my device's photo picker opens straight away, with no permission pop-up |
| U3 | The picker is open | I choose a photo | a short "processing" spinner shows, then the photo appears in place of the error, and a message tells me it will be uploaded on the next sync |
| U4 | The picker is open | I press back / cancel without choosing | nothing changes — the error message stays, no spinner, no confirmation message |
| U5 | I replaced a photo from the gallery | I close the submission and open it again | the photo I picked is still there |
| U6 | I replaced a photo from the gallery | the app syncs | the picked photo uploads like any other photo |
| U7 | I open a submission that has **already synced** | the detail screen loads | I see no repair buttons at all — synced submissions are not editable |
| U8 | I open a submission where a **signature** is missing | the detail screen loads | I see the missing-file message with no buttons — signatures cannot be replaced from the gallery |
| U9 | I open a submission where an **attached file** is missing | the detail screen loads | I see **Re-attach file** only — no **From Gallery** button |
| U10 | The app is set to French | I reach the missing-photo message | the button reads **De la galerie** |
| U11 | I open a submission that **has already synced**, while my phone has no connection | the photo cannot load | I am told the photo could not be loaded and to check my connection — **not** that the file is missing from my device — and I get a **Try again** button |
| U12 | I tapped **Try again** after my connection came back | the image reloads | the photo appears normally |
| U13 | One of my submissions can never sync because its photo is gone | I keep syncing | the app stops re-attempting that submission after a few tries instead of retrying it every single sync; the other submissions still sync normally |
| U14 | I open a **draft** whose photo has gone missing | the form loads | the photo field says the file is missing instead of showing an empty box, and I can pick a new one with the buttons already there |
| U15 *(H)* | **Save photos to gallery** is on, and I take a photo while filling a form | the capture finishes | the photo also appears in my device gallery, in a "DWS DataPro" album |
| U16 *(H)* | The setting is on and I am asked for gallery permission | I deny it | the photo is still attached to my form normally — I am not blocked, and I am not asked again on every photo |
| U17 *(H)* | A submission's photo was lost from the app, and the setting was on when I took it | I tap **From Gallery** | my original photo is there to pick, so the submission is repaired with the real photo rather than a substitute |

### Tech AC

| # | Criterion | How to verify |
|---|---|---|
| T1 | `ImageView` renders `${imageTestID}-gallery` only when `onPickGallery` is set **and** `uri.startsWith('file://')` | Unit test: render with a remote `uri`, assert the test ID is absent |
| T2 | `fileMissing` is still driven solely by the `Image` `onError` callback — no `getInfoAsync` added to this path | Code review; `AttachmentView` keeps its existing `getInfoAsync` check |
| T3 | `handlePickFromGallery` calls `ImagePicker.launchImageLibraryAsync` and **never** `PermissionsAndroid.request` | Unit test: assert the mock was not called |
| T4 | A cancelled pick (`result.canceled === true`) returns before `setRetakingKey`, so no spinner flashes and `crudDataPoints.updateJson` is not called | Unit test: mock a cancelled result, assert `updateJson` not called |
| T5 | A successful pick calls `compressImage(uri, imageQuality)` → `persistImage` → `FormState.update` → `crudDataPoints.updateJson` → `ToastAndroid.show`, in that order | Unit test with ordered mock assertions |
| T6 | `compressImage` throwing does not abort the swap — the original uri is persisted and `Sentry.captureException` is called | Unit test: make `compressImage` reject, assert `persistImage` still ran |
| T7 | `setRetakingKey(null)` runs in a `finally`, so a throw anywhere in the tail cannot strand the spinner | Code review + unit test on the reject path |
| T8 | `handleRetake` and `handlePickFromGallery` share one save path — the compress/persist/store/toast block appears exactly once in the file | `grep -c 'crudDataPoints.updateJson' FormDataDetails.js` inside the photo handlers |
| T9 | `onPickGallery` is passed only in the `QUESTION_TYPES.photo` branch — not for `signature`, not for image attachments | Code review of `renderItem` |
| T10 | Exactly two new i18n keys (`photoLoadFailedText`, `buttonTryAgain`), added to **both** `en` and `fr`. `buttonFromGallery`, `retakeSuccess`, `photoMissingText` are reused, not duplicated | `npm test -- ui-text` snapshot diff shows 2 keys per language and nothing else |
| T11 | A–G add no dependency — `expo-image-picker` is already imported. `expo-media-library` is added by **H** only | `git diff app/package.json` shows the version bump plus `expo-media-library` and nothing else |
| T12 | ESLint (airbnb) clean: no `for...of`, no `await` in loops, arrow-function components, no param reassign outside Pullstate | `npm run lint` in `app/` |
| T13 | Existing `FormDataDetails` snapshot is either unchanged or regenerated deliberately | `npm test` in `app/` |
| T14 | `persistImage`'s catch calls `Sentry.captureException` before `return uri` | Unit test: make `moveAsync` reject, assert the Sentry mock was called and the cache uri is still returned |
| T15 | `ImageView` picks its failure copy from the uri shape, not from a flag the caller passes | Unit test: `file://` uri → `fileMissingText`; server path → `photoLoadFailedText` |
| T16 | The **Try again** button remounts the `Image` (a `reloadKey` bump) and clears the error state | Unit test: fire `error`, press `${imageTestID}-reload`, assert the error block is gone |
| T17 | **No schema change.** No migration file, no new column in `tables.js`, no change to `saveAsPending` / `markSynced` | `git diff` touches nothing under `src/database/` |
| T18 | `handleOnUploadFiles` returns `missingFileDataIDs`, and never builds an upload request for a file whose `getInfoAsync` says it is absent | Unit test: one present + one absent file, assert a single `api.post` |
| T19 | A skipped datapoint increments `counts.skipped`, **not** `counts.failed`, so transient-failure retry behaviour is unchanged | Unit test on `processBatch` |
| T19b | `processBatch` recurses only when the batch cleared at least one row (`counts.success > successBefore`), so a full batch of skipped rows cannot re-fetch the same 20 forever | Unit test: 20 missing-file rows, assert one `selectSubmissionToSync` call |
| T20 | `TypeImage` shows the missing notice only after `onError`, never on first render, and never for a `null`/empty value | Unit test on `TypeImage` |
| T24 | `ImageView`'s error state clears when `uri` changes, **without** a remount, and survives an unrelated prop change | `ImageView.test.js` — "clears the error state when the uri is replaced" / "keeps the error state when an unrelated prop changes" |
| T25 | Neither `ImageView` nor `TypeImage` uses a `useEffect` to reset its error flag | Code review — both derive from the current uri/value |
| T26 *(H)* | With `saveToGallery` false, `expo-media-library` is never called and no permission is requested | Unit test: assert both mocks uncalled |
| T27 *(H)* | A rejected `saveToLibraryAsync` still calls `onChange` with the persisted uri, and fires `Sentry.captureException` | Unit test on the reject path |
| T28 *(H)* | `selectFile` (gallery pick) never writes back to the gallery | Unit test: assert `createAssetAsync` uncalled after a library pick |
| T29 *(H)* | The gallery write is awaited **after** `onChange`, so it never delays the preview appearing | Code review + ordered mock assertions |
| T21 | Task 0 is behaviour-neutral: `FormDataDetails.test.js.snap` passes **unchanged** after the extraction, before any feature code | `npm test -- FormDataDetails` with no `--updateSnapshot` |
| T22 | `ImageView`, `AttachmentView`, `SubtitleContent` each render in a test **without** navigation, `expo-sqlite` or `FormState` mocks | The three new suites mock only `../../../lib` |
| T23 | `FormDataDetails.js` no longer declares any component but the page, and its now-unused imports (`Image`/`Button`, `moment`, `expo-linking`, `cascades`) are gone | `npm run lint` — `no-unused-vars` |

---

## Testing consequence

Because the button only appears when the file is missing, this screen is unreachable in
manual QA without a rigged device — Expo Go's `documentDirectory` is unreachable from a
file manager, and "Clear storage" wipes the SQLite database along with the photo.

| Environment | Can reach the missing state? |
|---|---|
| Physical device + Expo Go | ❌ No path to the file |
| Emulator on a **Play Store** image (`release-keys`, `ro.debuggable=0`) | ❌ No `adb root`, no `run-as` |
| Emulator on a **Google APIs** image | ✅ `adb root`, then delete the file directly |

There is currently no test touching the missing-file path in `FormDataDetails.test.js`
(nothing greps for `missing`, `onError`, or `retake`). Cover the state with a unit test
rather than relying on manual QA.

### Per-component unit tests — enabled by Task 0

Today `ImageView`, `AttachmentView` and `SubtitleContent` are **module-private**: declared
with `const`, never exported, only `FormDataDetails` is `export default`. The sole way to
exercise them is to render the entire page, which drags in navigation, `expo-sqlite`,
`FormState` form JSON, `route.params`, and the `SectionList` — for a component whose whole
contract is *(uri, callbacks) → one of three views*.

After extraction each one is imported and rendered directly:

```js
// src/components/FormDataDetails/__tests__/ImageView.test.js
import ImageView from '../ImageView';

it('shows both repair buttons when a local file is missing', () => {
  const { getByTestId } = render(
    <ImageView
      label="Photo"
      uri="file:///files/images/gone.jpg"
      imageTestID="image-question-0"
      missingText="Photo file is missing on this device."
      retakeLabel="Retake photo"
      galleryLabel="From Gallery"
      onRetake={jest.fn()}
      onPickGallery={jest.fn()}
    />,
  );
  fireEvent(getByTestId('image-question-0'), 'error');
  expect(getByTestId('image-question-0-retake')).toBeDefined();
  expect(getByTestId('image-question-0-gallery')).toBeDefined();
});
```

No navigation mock, no SQLite mock, no form JSON. Each of T1, T2, T15 and T16 becomes a
three-line assertion against a prop combination instead of a scenario staged through the
page.

**Division of labour after Task 0:**

| Test file | Covers |
|---|---|
| `components/FormDataDetails/__tests__/ImageView.test.js` | 9 cases — render states, visibility gates, `onError`, local-vs-remote copy, **Try again**, uri-change clearing — T1, T2, T15, T16, T24 |
| `components/FormDataDetails/__tests__/AttachmentView.test.js` | 7 cases — `getInfoAsync` existence check, rejection-as-missing, open-file, re-attach visibility, no check on remote uris |
| `components/FormDataDetails/__tests__/SubtitleContent.test.js` | 9 cases — one per `QUESTION_TYPES` branch plus the zero-vs-dash edge |
| `pages/FormData/__tests__/FormDataDetails.test.js` | integration only: handler wiring, `savePhoto` pipeline order, cancel path, which branch gets which props — T3–T9 |

The page suite keeps its heavy mocks but stops carrying presentational assertions, and the
`../../../lib` mock gap noted in Task 6 only has to be fixed for the handler tests.

---

## Implementation plan

### Files affected

| Workstream | File | Change |
|---|---|---|
| G | `src/components/FormDataDetails/index.js` | **new** — barrel |
| G | `src/components/FormDataDetails/ImageView.js` | **new** — moved verbatim |
| G | `src/components/FormDataDetails/AttachmentView.js` | **new** — moved verbatim |
| G | `src/components/FormDataDetails/SubtitleContent.js` | **new** — moved verbatim |
| G | `src/components/FormDataDetails/styles.js` | **new** — shared styles |
| G | `src/components/index.js` | re-export the three |
| G | `src/pages/FormData/FormDataDetails.js` | delete the three components + their styles; import them instead |
| A | `src/pages/FormData/FormDataDetails.js` | `savePhoto` extraction; `handlePickFromGallery`; photo-branch wiring |
| A | `src/components/FormDataDetails/ImageView.js` | new props + buttons |
| A | `src/components/FormDataDetails/styles.js` | `buttonRow`, `repairButton` |
| B | `src/lib/image-compressor.js` | Sentry on the `persistImage` fallback |
| C | `src/components/FormDataDetails/ImageView.js` | remote-vs-local failure branch + **Try again** |
| C | `src/lib/i18n/ui-text.js` | 2 new keys × `en` + `fr` |
| D | `src/lib/background-task.js` | existence pre-check, `missingFileDataIDs`, skip + recursion guard |
| H | `src/database/migrations/09_add_saveToGallery_to_config.js` | **new** |
| H | `src/database/migrations/index.js`, `App.js` | register + run `m09` |
| H | `src/database/tables.js` | `saveToGallery` on `config` |
| H | `src/store/buildParams.js` | `saveToGallery: 0` |
| H | `src/pages/Settings/config.js`, `SettingsForm.js` | the switch |
| H | `src/form/fields/TypeImage.js` | `copyToGallery`, `apkName` album, camera-only wiring |
| H | `app.json`, `package.json` | `expo-media-library` plugin + dependency |
| E | `src/form/fields/TypeImage.js` | `onError` + missing notice |
| — | `src/components/FormDataDetails/__tests__/ImageView.test.js` | **new** |
| — | `src/components/FormDataDetails/__tests__/AttachmentView.test.js` | **new** |
| — | `src/components/FormDataDetails/__tests__/SubtitleContent.test.js` | **new** |
| — | `src/pages/FormData/__tests__/FormDataDetails.test.js` | integration cases only |
| — | `src/form/fields/__test__/TypeImage.test.js` | new cases |
| — | `src/lib/__tests__/image-compressor.test.js` | Sentry-on-fallback case |
| F | `app/app.json`, `app/package.json`, `app/src/build.json` | version bump `4.1.29` → `4.1.30`, versionCode `4129` → `4130` |
| — | `app/jest.config.js` | **unplanned** — `ts`/`tsx` added to `moduleFileExtensions`, see below |

**A–G add no dependency**; workstream **H** adds `expo-media-library@~17.1.7`.
`Submission.js` is untouched: its `needsRetake` badge already surfaces broken rows.
**No file under `src/database/` was modified.**

> `jest.config.js` was not in the plan. `moduleFileExtensions` listed only
> `js/jsx/json/node`, so jest could not resolve `expo-modules-core/src/Refs` — a `.ts`
> file that jest-expo 53's `preset/setup.js` imports. Every suite in `app/` died at load.
> The two added extensions are a prerequisite for running any test at all.

---

### Task 0 — (G) Extract the components

**Behaviour-neutral move. No logic changes in this task** — the existing
`FormDataDetails.test.js.snap` must pass **unchanged** afterwards. That snapshot is the
proof the move was clean; if it shifts, something was altered by accident.

**0a — style audit.** The single `StyleSheet.create` block splits three ways:

| Style | Goes to |
|---|---|
| `title`, `containerImage`, `image` | `ImageView.js` |
| `sectionTitle`, `listContainer`, `sectionList` | page (stays) |
| `missingText`, `processingContainer`, `processingText` | `styles.js` — used by `ImageView` **and** `AttachmentView` |
| `listItem`, `listItemContent`, `listItemTitle` | `styles.js` — used by `AttachmentView` **and** the page's default branch |

**0b — the three files.** Each is a verbatim move; only the import depth changes
(`../../lib`, `../../store` from `src/components/FormDataDetails/`):

```js
// src/components/FormDataDetails/ImageView.js
import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { Image, Button } from '@rneui/themed';
import { api } from '../../lib';
import styles from './styles';

const ImageView = ({ label, uri, textTestID, imageTestID, onRetake = null, ... }) => {
  ...
};

export default ImageView;
```

`AttachmentView.js` additionally imports `expo-linking`, `expo-file-system` and
`react-native`'s `Alert`. `SubtitleContent.js` imports `moment`, `expo-linking`,
`UIState`, `cascades`, `i18n` and `QUESTION_TYPES`.

**0c — barrel.** `src/components/FormDataDetails/index.js`:

```js
export { default as ImageView } from './ImageView';
export { default as AttachmentView } from './AttachmentView';
export { default as SubtitleContent } from './SubtitleContent';
```

Add to `src/components/index.js` alongside the existing exports:

```js
export { ImageView, AttachmentView, SubtitleContent } from './FormDataDetails';
```

**0d — the page.** `FormDataDetails.js` drops ~200 lines and gains one import. Its
existing `import { BaseLayout } from '../../components'` extends to:

```js
import {
  BaseLayout,
  ImageView,
  AttachmentView,
  SubtitleContent,
} from '../../components';
```

Then delete the three component declarations and the styles that moved. Imports that
become unused in the page — `Image`/`Button` from `@rneui/themed`, `moment`,
`expo-linking`, `cascades` — must go too, or `no-unused-vars` fails the lint gate.
`FileSystem` and `Alert` stay only if the page still uses them; check before deleting.

**0e — checkpoint.** Run before writing any feature code:

```bash
cd app && npm run lint && npm test -- FormDataDetails
```

Snapshot unchanged + lint clean ⇒ the move is sound and Tasks 1–12 can proceed.

---

### Task 1 — Extract the shared save tail

`handleRetake` currently owns the whole pipeline. Split it: everything from
`setRetakingKey` down is identical for both pickers, so it moves into `savePhoto`.
`handleRetake` keeps only the camera-specific prelude.

Replace `handleRetake` (currently lines 305–336) with:

```js
  // Shared tail for both repair paths — camera and gallery differ only in the
  // picker call that produces imageUri.
  const savePhoto = async (questionKey, imageUri) => {
    setRetakingKey(questionKey);
    try {
      let newUri = imageUri;
      try {
        const compressed = await compressImage(imageUri, imageQuality);
        newUri = compressed.uri;
      } catch (error) {
        Sentry.captureMessage(`Image compression failed for ${imageUri}`);
        Sentry.captureException(error);
      }
      // Move out of the purgeable cache dir so the photo survives until synced
      newUri = await persistImage(newUri);
      const updatedValues = { ...currentValues, [questionKey]: newUri };
      FormState.update((s) => {
        s.currentValues = updatedValues;
      });
      await crudDataPoints.updateJson(db, datapointId, updatedValues);
      ToastAndroid.show(trans.retakeSuccess, ToastAndroid.LONG);
    } finally {
      setRetakingKey(null);
    }
  };

  const handleRetake = async (questionKey) => {
    const allowed = await ensureCameraPermission();
    if (!allowed) {
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ base64: true });
    if (result?.canceled) {
      return;
    }
    await savePhoto(questionKey, result.assets[0].uri);
  };

  /**
   * No permission request is necessary for launching the image library.
   * docs: https://docs.expo.dev/versions/latest/sdk/imagepicker/#usage
   */
  const handlePickFromGallery = async (questionKey) => {
    const result = await ImagePicker.launchImageLibraryAsync({ base64: true });
    if (result?.canceled) {
      return;
    }
    await savePhoto(questionKey, result.assets[0].uri);
  };
```

`ensureCameraPermission`, `handleReattach`, and the `imageQuality` / `db` / `datapointId`
bindings above are untouched. `handleReattach` deliberately does **not** route through
`savePhoto` — it persists into the `attachments` subdir and fires a different toast.

#### Invalidating the Submission list

Found on device: after a successful repair the list still showed the **File missing**
badge, and re-opening the datapoint showed the old missing state — even though SQLite held
the repaired uri and the file existed.

`Submission.fetchData` runs on mount and when `UIState.refreshPage` flips true. Pushing
`FormDataDetails` does not unmount `Submission`, so its `data` array kept the pre-repair
row. `goToDetails` then reseeds `FormState.currentValues` from that stale `item.json`,
which is what made the repaired photo look like it had vanished.

Both `savePhoto` and `handleReattach` therefore signal a refresh after `updateJson`,
matching how `SyncService` and `background-task` already invalidate these lists:

```js
      await crudDataPoints.updateJson(db, datapointId, updatedValues);
      // The Submission list caches its rows and only refetches on mount or on
      // refreshPage. Without this it keeps showing the File missing badge, and
      // re-opening this screen reseeds currentValues from the stale row.
      UIState.update((s) => {
        s.refreshPage = true;
      });
```

Only the repair paths signal this. Any other pushed screen that mutates a datapoint has
the same staleness; a `focus` listener on `Submission` would fix the class rather than the
instance, but that changes a shared screen's behaviour and was left alone.

---

### Task 2 — `ImageView`: two new props

In `src/components/FormDataDetails/ImageView.js` (post-Task 0). Signature gains
`onPickGallery` and `galleryLabel`, mirroring `onRetake` / `retakeLabel`:

```js
const ImageView = ({
  label,
  uri,
  textTestID,
  imageTestID,
  onRetake = null,
  onPickGallery = null,
  missingText = '',
  retakeLabel = '',
  galleryLabel = '',
  isRetaking = false,
  processingLabel = '',
}) => {
```

Replace the single `showRetake` line with a shared local-file check:

```js
  // Repair only makes sense for local files pending upload, not remote images
  const isLocalFile = !!uri?.startsWith('file://');
  const showRetake = !!onRetake && isLocalFile;
  const showGallery = !!onPickGallery && isLocalFile;
```

---

### Task 3 — `ImageView`: render both buttons

The `fileMissing` branch wraps its buttons in a row:

```jsx
  if (fileMissing) {
    content = (
      <View>
        <Text style={styles.missingText} testID={`${imageTestID}-missing`}>
          {missingText}
        </Text>
        <View style={styles.buttonRow}>
          {showRetake && (
            <Button
              title={retakeLabel}
              onPress={onRetake}
              testID={`${imageTestID}-retake`}
              containerStyle={styles.repairButton}
            />
          )}
          {showGallery && (
            <Button
              title={galleryLabel}
              onPress={onPickGallery}
              testID={`${imageTestID}-gallery`}
              containerStyle={styles.repairButton}
            />
          )}
        </View>
      </View>
    );
  }
```

The `isRetaking` block below it is unchanged and still wins — it is evaluated after
`fileMissing`, so the spinner replaces both buttons while a pick is processing.

---

### Task 4 — Wire the photo branch in `renderItem`

Only the `photo` / `signature` branch changes. The `canRetake && q.type === photo` guard
already excludes signatures; reuse it verbatim for the new prop:

```jsx
    if ([QUESTION_TYPES.photo, QUESTION_TYPES.signature].includes(q.type) && answer) {
      const isPhoto = canRetake && q.type === QUESTION_TYPES.photo;
      return (
        <ImageView
          key={`${q.id}-${answer}`}
          label={q.label}
          uri={answer}
          textTestID={`text-question-${qIndex}`}
          imageTestID={`image-question-${qIndex}`}
          missingText={trans.fileMissingText}
          retakeLabel={trans.buttonRetakePhoto}
          galleryLabel={trans.buttonFromGallery}
          onRetake={isPhoto ? () => handleRetake(q.id) : null}
          onPickGallery={isPhoto ? () => handlePickFromGallery(q.id) : null}
          isRetaking={retakingKey === q.id}
          processingLabel={trans.compressingImage}
        />
      );
    }
```

The image-attachment branch above (`trans.buttonReattachFile` + `handleReattach`) passes
no `onPickGallery`, so `showGallery` stays false there — satisfying **U9** / **T9**.

---

### Task 5 — Styles

Append to `src/components/FormDataDetails/styles.js`:

```js
  buttonRow: {
    flexDirection: 'column',
    gap: 8,
  },
  repairButton: {
    flex: 1,
  },
```

Stacked, not side by side: the French pair (`Reprendre la photo` / `De la galerie`) is the
longest, and at half width on a narrow device the labels truncate. Full-width buttons also
give a larger touch target for a one-handed field user.

---

### Task 6 — Tests

Split per the table in **Per-component unit tests** above: presentational assertions go to
`src/components/FormDataDetails/__tests__/`, handler assertions stay in the page suite.

The page suite mocks `../../../lib` with **only** `cascades` and `i18n`. `ImageView`
also reads `api.getConfig()`, and `renderItem` calls `helpers.isImageFile` — both must be
added to the mock or the new cases throw before rendering:

```js
jest.mock('../../../lib', () => ({
  cascades: { /* ...existing... */ },
  i18n: {
    text: jest.fn(() => ({
      fileMissingText: 'Photo file is missing on this device. Retake it to allow syncing.',
      buttonRetakePhoto: 'Retake photo',
      buttonFromGallery: 'From Gallery',
      retakeSuccess: 'Photo updated. It will be uploaded on the next sync.',
      compressingImage: 'Compressing...',
    })),
  },
  api: { getConfig: jest.fn(() => ({ baseURL: 'http://example.com/api/v1/' })) },
  helpers: { isImageFile: jest.fn(() => true) },
}));

jest.mock('expo-image-picker');
jest.mock('../../../lib/image-compressor', () => ({
  compressImage: jest.fn(async (uri) => ({ uri, size: 1024 })),
  persistImage: jest.fn(async (uri) => uri.replace('/cache/', '/files/images/')),
}));
```

Reaching the missing state means firing `onError` on the rendered `Image` — that is the
only thing that flips `fileMissing`:

```js
  const openMissingPhoto = () => {
    const utils = render(<FormDataDetails navigation={useNavigation()} route={route} />);
    fireEvent(utils.getByTestId('image-question-0'), 'error');
    return utils;
  };

  it('shows both repair buttons when a local photo file is missing', async () => {
    const { getByTestId } = openMissingPhoto();
    await waitFor(() => {
      expect(getByTestId('image-question-0-missing')).toBeDefined();
      expect(getByTestId('image-question-0-retake')).toBeDefined();
      expect(getByTestId('image-question-0-gallery')).toBeDefined();
    });
  });

  it('replaces the answer when a gallery image is picked', async () => {
    ImagePicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///cache/picked.jpg' }],
    });
    const { getByTestId } = openMissingPhoto();
    await act(async () => {
      fireEvent.press(getByTestId('image-question-0-gallery'));
    });
    expect(PermissionsAndroid.request).not.toHaveBeenCalled();   // T3
    expect(crudDataPoints.updateJson).toHaveBeenCalled();        // T5
  });

  it('changes nothing when the picker is cancelled', async () => {
    ImagePicker.launchImageLibraryAsync.mockResolvedValue({ canceled: true });
    const { getByTestId } = openMissingPhoto();
    await act(async () => {
      fireEvent.press(getByTestId('image-question-0-gallery'));
    });
    expect(crudDataPoints.updateJson).not.toHaveBeenCalled();    // T4
  });

  it('still saves when compression fails', async () => {
    compressImage.mockRejectedValueOnce(new Error('boom'));
    ImagePicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///cache/picked.jpg' }],
    });
    const { getByTestId } = openMissingPhoto();
    await act(async () => {
      fireEvent.press(getByTestId('image-question-0-gallery'));
    });
    expect(persistImage).toHaveBeenCalledWith('file:///cache/picked.jpg');  // T6
  });

  it('hides the gallery button for a remote uri', async () => {
    // route.params.isSynced = true → canRetake false → no buttons at all
    const { queryByTestId } = openSyncedPhoto();
    expect(queryByTestId('image-question-0-gallery')).toBeNull();           // T1
  });
```

---

### Task 7 — (B) Stop the `persistImage` fallback being silent

`src/lib/image-compressor.js` — add the import and two Sentry calls. This is the only
failure path in the photo pipeline that reports nothing:

```js
import * as Sentry from '@sentry/react-native';

export const persistImage = async (uri, subDir = 'images') => {
  try {
    ...
    await FileSystem.moveAsync({ from: uri, to });
    return to;
  } catch (error) {
    // The caller keeps a cacheDirectory uri, which Android may purge before
    // sync — loud enough to diagnose, not fatal enough to lose the answer.
    Sentry.captureMessage(`[persistImage] fallback to cache uri: ${uri}`);
    Sentry.captureException(error);
    return uri;
  }
};
```

Deliberately **not** thrown: failing the whole capture would lose the photo the user just
took. A purgeable uri that syncs within the hour is better than no answer at all.

---

### Task 8 — (C) Tell a network failure apart from a missing file

Two new keys in `src/lib/i18n/ui-text.js`, `en` block beside `fileMissingText`:

```js
    photoLoadFailedText: 'Photo could not be loaded. Check your connection and try again.',
    buttonTryAgain: 'Try again',
```

`fr` block, beside its `fileMissingText`:

```js
    photoLoadFailedText:
      'Impossible de charger la photo. Vérifiez votre connexion et réessayez.',
    buttonTryAgain: 'Réessayer',
```

In `src/components/FormDataDetails/ImageView.js`, the error branch now forks on the uri
shape. A `reloadKey` remounts the `Image` so **Try again** actually re-requests it:

```jsx
  const [fileMissing, setFileMissing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const isLocalFile = !!uri?.startsWith('file://');

  const handleRetry = () => {
    setFileMissing(false);
    setReloadKey((k) => k + 1);
  };

  let content = (
    <Image
      key={reloadKey}
      source={{ uri: imageURL }}
      testID={imageTestID}
      style={styles.image}
      onError={() => setFileMissing(true)}
    />
  );

  if (fileMissing) {
    content = isLocalFile ? (
      <View>
        <Text style={styles.missingText} testID={`${imageTestID}-missing`}>
          {missingText}
        </Text>
        <View style={styles.buttonRow}>
          {showRetake && (
            <Button title={retakeLabel} onPress={onRetake}
              testID={`${imageTestID}-retake`} containerStyle={styles.repairButton} />
          )}
          {showGallery && (
            <Button title={galleryLabel} onPress={onPickGallery}
              testID={`${imageTestID}-gallery`} containerStyle={styles.repairButton} />
          )}
        </View>
      </View>
    ) : (
      // Remote path — the file is on the server, this is a connectivity problem.
      // Never offer retake/gallery here: there is nothing local to repair.
      <View>
        <Text style={styles.missingText} testID={`${imageTestID}-load-failed`}>
          {loadFailedText}
        </Text>
        <Button title={tryAgainLabel} onPress={handleRetry}
          testID={`${imageTestID}-reload`} />
      </View>
    );
  }
```

New props: `loadFailedText`, `tryAgainLabel`. Both image call sites in `renderItem` pass
`loadFailedText={trans.photoLoadFailedText}` and `tryAgainLabel={trans.buttonTryAgain}`.

---

### Task 9 — (D) Skip datapoints whose file is gone

Entirely in `src/lib/background-task.js`. **No migration, no schema change, no CRUD change.**

**9a — existence pre-check.** In `handleOnUploadFiles`, once `allFiles` is collected:

```js
  // A file that is verifiably gone can never upload, so attempting it just burns
  // a request on every sync run, forever. Ask the filesystem once and drop those
  // datapoints from this batch instead of counting them as failures.
  const fileExists = await Promise.all(
    allFiles.map((f) =>
      FileSystem.getInfoAsync(f.value)
        .then(({ exists }) => exists)
        .catch(() => false),
    ),
  );
  const missingFileDataIDs = new Set(
    allFiles.filter((_, i) => !fileExists[i]).map((f) => f.dataID),
  );
  const presentFiles = allFiles.filter((_, i) => fileExists[i]);
```

`uploadFns` is then built from `presentFiles`, and the result mapping indexes
`presentFiles[i]` rather than `allFiles[i]`. Both early returns and the final return carry
`missingFileDataIDs`. `Promise.all` keeps it off the airbnb `no-await-in-loop` path.

**9b — skip in `processBatch`.** Both `handleOnUploadFiles` calls destructure the new
field, and the union is checked before any work for the datapoint:

```js
  const missingFileIDs = new Set([...missingPhotos, ...missingAttachments]);

  // ...inside the per-datapoint reduce, ahead of the failedUploadIDs branch:
  if (missingFileIDs.has(d.id)) {
    counts.skipped += 1;
    return;
  }
```

`counts.skipped`, not `counts.failed` — that is what preserves retry behaviour for
transient errors (**T19**).

**9c — recursion guard.** `selectSubmissionToSync` re-reads the *oldest* unsynced rows
every recursion (`WHERE syncedAt IS NULL ORDER BY createdAt ASC LIMIT 20`), so a batch made
entirely of skipped rows would fetch the same 20 forever. Recursion now also requires that
the batch cleared something:

```js
  // at the top of processBatch, after the empty-data guard
  const successBefore = counts.success;

  // ...at the tail
  if (data.length >= BATCH_SIZE && counts.failed === 0 && counts.success > successBefore) {
    return processBatch(db, activeJob, session, counts);
  }
```

The counts default becomes `{ success: 0, failed: 0, skipped: 0 }`.

No new UI: `Submission.js` already badges these rows through `needsRetake`. Skipping stops
the wasted request loop; the badge already tells the enumerator which row to repair, and
**From Gallery** repairs it.

---

### Task 10 — (E) Missing notice on the form field

`src/form/fields/TypeImage.js` — the preview currently renders a bare `Image` with no
error handling, so a vanished file shows an empty box:

Same derived-state approach as `ImageView` — **no `useEffect`**. Storing which uri failed
means a fresh pick changes `value`, so the comparison goes false on its own:

```js
  // Remember which uri failed rather than a boolean: picking a new photo changes
  // `value`, so the comparison below goes false on its own — no reset needed.
  const [failedUri, setFailedUri] = useState(null);
```

```jsx
        {value && typeof value === 'string' && !isCompressing && (
          <View>
            {failedUri === value ? (
              <Text style={styles.missingText} testID="image-missing">
                {trans.photoMissingText}
              </Text>
            ) : (
              <Image
                source={{ uri: value }}
                style={styles.imagePreview}
                PlaceholderContent={<ActivityIndicator />}
                testID="image-preview"
                onError={() => setFailedUri(value)}
              />
            )}
            ...
          </View>
        )}
```

Uses the existing `trans.photoMissingText` ("File missing" / "Fichier manquant") — no new
key. One new local style, `missingText`. The camera and gallery buttons above are already
always rendered, so the field is self-repairing; this only replaces a blank box with an
explanation.

---

### Task 11 — (F) Bump the version

Non-optional here, not cosmetic: `01d3f6b2` and `713ea04d` are already on `main` but
carry the **same** versionCode as the build that predates them, so the update check can
never offer them. Shipping this work under 4129 would repeat that.

`./update-mobile-version.sh` could **not** be used: it aborts unless the current branch is
`main`, and it is interactive (`read -r -p`). The three files were edited directly, using
the same field names the script targets:

| File | Field | Value |
|---|---|---|
| `app/package.json` | `version` | `4.1.30` |
| `app/src/build.json` | `appVersion` | `4.1.30` |
| `app/app.json` | `expo.version` | `4.1.30` |
| `app/app.json` | `expo.android.versionCode` | `4130` |

Verified all four agree:

```bash
cd app
node -p "require('./package.json').version"                    # 4.1.30
node -p "require('./src/build.json').appVersion"               # 4.1.30
node -p "const a=require('./app.json').expo; a.version+' / '+a.android.versionCode"
```

Note the plan said `app/build.json`; the real path is **`app/src/build.json`**.

---

### Task 12 — Verify

Use the **local** binaries. `npx eslint` resolves a system ESLint at
`/usr/share/nodejs/eslint` which is too old for the airbnb config and dies with
`Configuration for rule "prefer-regex-literals" is invalid`:

```bash
cd app
./node_modules/.bin/eslint src/                                  # ✅ 0 errors
./node_modules/.bin/prettier --check "src/**/*.js"               # ✅ clean
```

Result: **0 errors**. Four `no-console` warnings remain, all on pre-existing lines that
were preserved (`TypeImage.js:46`, `image-compressor.js:59,103,159`).

```bash
npx jest --ci FormDataDetails                   # ❌ blocked, see below
npx jest --ci components/FormDataDetails        # ❌ blocked, see below
```

---

### Task 13 — (H) Copy captures to the device gallery

#### Why it is worth doing

Workstreams A–G make a lost photo *repairable*; they cannot make it *recoverable*. When
R1/R2/R4 destroys the app's copy, the pixels are gone from the device entirely, so
**From Gallery** can only attach a **substitute** image — a different photo, or a photo of
a photo. A gallery copy changes that: the original still exists outside the app's sandbox,
which Android's cache purge, an app-data clear, and a partial backup restore all leave
untouched. The repair button stops being damage control and becomes an actual fix (**U17**).

It is also the only one of these measures that survives *reinstalling the app*.

#### Why it is gated off by default

| Cost | Detail |
|---|---|
| New dependency | `expo-media-library` is **not installed**. Bundled in Expo Go, so it tests without a rebuild, but a standalone build needs one |
| New permission prompt | The gallery *pick* path is currently the only one that asks for nothing (**F3**) — part of why it works well in the office. Writing reintroduces a prompt that can be denied |
| Privacy | Site and asset photos become visible to every app with media access, and to anyone scrolling the tablet. These are shared enumerator devices |
| Storage | Doubles per-photo footprint, on devices where low storage is the suspected cause of R2 in the first place |

Hence **F14**: off unless a deployment turns it on.

#### Setup

```bash
cd app && npx expo install expo-media-library     # resolved to 17.1.7
```

`npm install` fails on a **pre-existing** peer conflict (`@rneui/base@4.0.0-rc.7` vs
`@rneui/themed@4.0.0-rc.8`), unrelated to this package. Use:

```bash
npm install --legacy-peer-deps
```

`app.json` — add the plugin so the manifest carries the permission, with copy the
enumerator will actually see:

```json
[
  "expo-media-library",
  {
    "photosPermission": "DWS DataPro saves a copy of each photo you take to your gallery, so it can be recovered if the app loses it.",
    "savePhotosPermission": "DWS DataPro saves a copy of each photo you take to your gallery.",
    "isAccessMediaLocationEnabled": false
  }
]
```

`isAccessMediaLocationEnabled: false` — the app never needs to read EXIF GPS off gallery
images, and requesting `ACCESS_MEDIA_LOCATION` would widen the permission for nothing.

#### 13a — the setting

Follows `imageQuality` exactly (its own migration `06`, `tables.js` column, Settings entry,
`BuildParamsState` field). The migration number is free again now that the `syncAttempts`
column was dropped:

`src/database/migrations/09_add_saveToGallery_to_config.js`

```js
import sql from '../sql';

const up = async (db) => {
  await sql.addNewColumn(db, 'config', 'saveToGallery', 'TINYINT DEFAULT 0');
};

const down = () => {
  throw new Error('Migration 09 is irreversible. Create a new forward migration instead.');
};

export { up, down };
```

Wiring, all following `imageQuality`:

| File | Change |
|---|---|
| `migrations/index.js` | `export * as m09` |
| `App.js` | import `m09`; run it at `currentDbVersion === 8`, then `PRAGMA user_version = 9` |
| `src/lib/constants.js` | `DATABASE_VERSION` **was already 9** — no change needed |
| `tables.js` | `saveToGallery: 'TINYINT DEFAULT 0'` on `config` |
| `src/store/buildParams.js` | `saveToGallery: 0` (integer, matching the TINYINT the switch writes) |
| `App.js` `handleInitConfig` | include in `addConfig`; hydrate `s.saveToGallery = configExist.saveToGallery \|\| 0` |
| `Settings/config.js` | `id: 52`, `type: 'switch'`, key `BuildParamsState.saveToGallery`, with `fr` translations |
| `Settings/SettingsForm.js` | destructure from `BuildParamsState`, seed `settingsState`, **and add `saveToGallery` to the `configFields` whitelist** |

`handleOnSwitch` writes `1`/`0` to the store and calls `handleUpdateOnDB` — but that
function persists only fields present in a hardcoded `configFields` array. Omitting the
new field made the switch flip on screen and silently never reach SQLite, so it reset on
the next launch. **This whitelist is a silent-failure trap**: any future setting added to
`Settings/config.js` without a matching entry here fails the same way, with no error.
Worth replacing with a check against the actual `config` columns; out of scope here.

#### 13b — the write

`src/form/fields/TypeImage.js`. The album name comes from the store, **not a literal**, so
a rebranded APK groups photos under its own name:

```js
import * as MediaLibrary from 'expo-media-library';

  const saveToGallery = BuildParamsState.useState((s) => s.saveToGallery);
  // Album name follows the build's app name rather than a literal, so a
  // rebranded APK groups its photos under its own name
  const apkName = BuildParamsState.useState((s) => s.apkName);

  const copyToGallery = async (uri) => {
    try {
      // Full access, not write-only: grouping into an album needs to *read*
      // MediaStore to find whether the album already exists. With write-only the
      // asset lands in the default camera bucket and getAlbumAsync fails.
      const { granted } = await MediaLibrary.requestPermissionsAsync();
      if (!granted) {
        return;
      }
      const asset = await MediaLibrary.createAssetAsync(uri);
      const album = await MediaLibrary.getAlbumAsync(apkName);
      if (album) {
        await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
      } else {
        await MediaLibrary.createAlbumAsync(apkName, asset, false);
      }
    } catch (error) {
      Sentry.captureMessage(`[TypeImage] gallery copy failed for ${uri}`);
      Sentry.captureException(error);
    }
  };
```

`apkName` already exists in `BuildParamsState`, sourced from `src/build.json`
(`"apkName": "DWS DataPro"`).

`false` as the last argument to both album calls means **move, not copy**
(`copyAsset` defaults to `true`). Copying would leave a duplicate in the default camera
bucket and double the storage this feature costs, so the asset is relocated into the album
instead. The app's own `documentDirectory` copy is untouched either way — it is a separate
file, and remains the authoritative one the answer points at.

`handleOnChange` gains one parameter and one trailing call. Order matters (**T29**):
`onChange` fires first so the preview appears immediately, and the gallery write happens
after.

Note the restructure: the compression `try/catch` became an **inner** block producing
`persisted`, so the compression fallback no longer duplicates the `onChange` call and the
gallery write runs on both the compressed and the fallback path:

```js
  const handleOnChange = async (dataResult, fromCamera = false) => {
    const { uri: imageUri } = dataResult.assets[0];
    setIsCompressing(true);
    try {
      let persisted;
      try {
        const result = await compressImage(imageUri, imageQuality);
        setFileSize(result.size);
        persisted = await persistImage(result.uri);
      } catch (error) {
        console.error('[TypeImage] Compression error:', error);
        setFileSize(null);
        persisted = await persistImage(imageUri);
      }
      // Set the answer first so the preview appears without waiting on the
      // gallery write. A photo picked from the library is already there, so
      // only camera captures are mirrored.
      onChange(id, persisted);
      if (fromCamera && saveToGallery) {
        await copyToGallery(persisted);
      }
    } finally {
      setIsCompressing(false);
    }
  };
```

Call sites: `handleCamera` passes `true`, `selectFile` passes nothing — satisfying **F17**
/ **T28**, since a picked photo is already in the gallery.

#### 13c — tests

Five cases added to `src/form/fields/__test__/TypeImage.test.js` under a
`describe('save to gallery')`, with `expo-media-library` jest-mocked: setting off → library
untouched (**T26**); permission requested + album created from `apkName`; existing album
reused instead of duplicated; denied permission → answer still set (**T27**); write throws
→ answer still set; gallery pick → no copy back (**T28**).

The Sentry-was-called assertion was deliberately **not** written: the shared mock in
`setup-test-env.js` defines `captureException: (e) => jest.fn(e)` — a plain function, not a
spy — so it cannot be asserted without changing a file every other suite depends on.

#### Deliberately out of scope for H

| Excluded | Why |
|---|---|
| Attachments | Arbitrary documents do not belong in a photo gallery |
| Signatures | Base64 data URLs, not files; and a signature in the public gallery is a liability |
| Retroactive copy of existing photos | A one-off migration writing every stored photo to the gallery would surprise users and could be large |
| Copying photos repaired via **From Gallery** | The source *is* the gallery |
| Deleting gallery copies after sync | The whole point is that they outlive the app's copy |

#### Manual verification

```bash
# with the setting on, take a photo in a form, then:
adb shell 'content query --uri content://media/external/images/media --projection _display_name:bucket_display_name' \
  | grep -i 'DWS DataPro'
```

Note the same MediaStore query was used to seed the emulator gallery for manual QA of
workstream A — see [Task 12](#task-12--verify).

---

<a id="blocked-the-test-suite-cannot-run"></a>

#### Blocked: the test suite cannot run

```
react                19.0.0     package.json: "react": "19.0.0"
react-test-renderer  18.3.1     package.json: "react-test-renderer": "^18.2.0"
```

React 19 removed the `ReactCurrentOwner` internal, so `react-test-renderer` 18 throws
`TypeError: Cannot read properties of undefined (reading 'ReactCurrentOwner')` at import,
before any test body executes.

**This is pre-existing and unrelated to this work** — confirmed by stashing every change
in this branch and reproducing the same failure. The mismatch is declared in
`package.json`, so it is not a stale `node_modules`; `npm install` will not fix it.

Consequence: **T13, T21, T22, T24 and all 22 new unit tests are written but unverified.**

Unblocking it needs a dependency bump, deliberately left out of this work:

```bash
npm install --save-dev react-test-renderer@^19 @testing-library/react-native@^13
```

(RNTL 12.x supports React 18; React 19 support landed in 13.) Once green, re-run Task 0e's
snapshot check — **T21 has never been executed**, so the extraction's behaviour-neutrality
rests on code review alone.

Manual pass (**U1–U10**) needs a device where the photo file can be deleted. Use a
`google_apis` (non-Play-Store) AVD, where `adb root` works.

Find which pending submissions reference which files, then delete one:

```bash
adb root
DB=/data/data/host.exp.exponent/files/SQLite/app.db
# pending submissions and the file:// answers they point at
adb shell "sqlite3 $DB \"SELECT id, json FROM datapoints WHERE syncedAt IS NULL;\"" \
  | grep -oE 'file://[^\"]+'
adb shell 'rm /data/data/host.exp.exponent/files/images/<file>.jpeg'
```

Back the file up with `adb pull` first if you want to undo it — otherwise every run costs
a fresh submission. When restoring with `adb push`, note it lands as `root:root` mode
`666`; `chown` it to the images directory's owner and `chmod 600`, or the app cannot read
its own file back.

Seeding the emulator gallery, so **From Gallery** has something to pick:

```bash
adb push <file> /sdcard/DCIM/Camera/<name>.jpg
adb shell 'am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/DCIM/Camera/<name>.jpg'
```

The broadcast is the part that matters — without it the file exists on disk but never
enters MediaStore, so the picker does not list it.

#### Gotcha: the Docker dev server can serve a stale file

`./dc-mobile.sh` bind-mounts `./app` into `iwsims-mobileapp-1`. An editor that saves
atomically (write temp → rename) creates a **new inode**, and the container can keep
serving the old one — same path, different inode, so Metro bundles pre-edit code while
`git diff` shows the fix. New files appear instantly, which makes the mount look healthy.

Symptom: a change has no effect on device no matter how many reloads. Check with:

```bash
md5sum app/src/<file>
docker exec iwsims-mobileapp-1 md5sum /app/src/<file>
```

If they differ, rewrite the file in place (preserves the inode) or restart the container:

```bash
cp app/src/<file> /tmp/f && cat /tmp/f > app/src/<file> && rm /tmp/f
```
