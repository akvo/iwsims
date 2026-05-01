# Mobile Auto-Update — Requirements Specification v1.0

> Scope: automatic APK version check on app launch that forces users to update
> before using the app when a newer version is available.
> Extends the existing manual check in `About.js`.
> Next step: `/sc:implement`.

## Decisions locked

| ID | Decision |
|---|---|
| A | Shared `useVersionCheck` hook — both Home and About use the same API call and state logic |
| B | Offline guard — if the device is offline on mount, the auto-check is skipped entirely and never retried in that session |
| C | One-shot check per mount — `hasChecked` ref prevents re-running when `isOnline` flips or `useCallback` deps refresh |
| D | Force-update dialog is non-dismissable — `onBackdropPress` is a no-op; no Cancel button |
| E | Silent mode for Home — dialog does NOT appear while checking; it only appears when a 200 response confirms an update |
| F | About.js manual check is unchanged for the user — dialog shows loading state immediately on button press |

---

## 1. Functional Requirements

### FR-1 — Automatic version check on Home screen mount

When `Home.js` mounts and `isOnline = true`, call `GET /apk/version/{appVersion}` exactly once.

| Response | Action |
|---|---|
| `200 OK` | Set `visible = true` — show force-update dialog |
| `404 Not Found` | No action — current version is up to date |
| `5xx / network error` | Capture to Sentry, no dialog shown |
| Device offline | Skip check entirely |

### FR-2 — Force-update dialog (Home)

When an update is available:

- Dialog is **non-dismissable**: `onBackdropPress` is a no-op; no Cancel or close button
- Shows the new version text: `"New version available. (v X.X.X)"`
- Shows a single **Update** button that opens `apkURL` via `Linking.openURL`
- Dialog title: `"Update Required"` (translated)
- Dialog remains visible if the user returns to the app after switching to the browser/download manager

### FR-3 — Shared hook (`useVersionCheck`)

Extracted to `app/src/hooks/use-version-check.js`. Accepts `{ autoCheck: boolean }`.

```
checkVersion(silent = false)
  silent=true  → used by autoCheck: visible set only on 200
  silent=false → used by About button: visible set immediately (shows loading)
```

Returns: `{ visible, setVisible, checking, updateInfo, checkVersion, handleUpdate }`

### FR-4 — About.js refactored to use hook

`About.js` replaces its local `useState`/`useCallback` state and `handleCheckAppVersion`/`handleUpdateButton` logic with the shared hook. Visible behaviour for the user is **identical** to before:

- Manual button press → dialog opens with loading spinner → shows result
- Cancel button remains (soft update — user can dismiss)
- Update button opens `apkURL`

### FR-5 — Offline enforcement

The `checkVersion` function returns early (`return`) when `isOnline = false`. The `autoCheck` effect additionally guards with `isOnline` before calling. Result: zero API calls when the device is offline.

---

## 2. Non-Functional Requirements

- **NFR-1** — No new npm packages. `@rneui/themed`, `expo-linking`, `@sentry/react-native` are already available.
- **NFR-2** — Airbnb ESLint compliance: no `for...of`, arrow components, `useCallback` deps complete, `prefer-const`.
- **NFR-3** — The hook must not cause extra re-renders. `hasChecked` is a `useRef` (no render on write); state updates are batched within `.then()` / `.catch()` / `.finally()`.
- **NFR-4** — Existing About.js test coverage must continue to pass without modification to test files.
- **NFR-5** — The auto-check fires at most once per mount of `Home.js`. Navigation away and back resets `hasChecked.current` (fresh mount), which is acceptable — ensures the check runs again if the user was away long enough for the device to update network state.

---

## 3. User Stories & Acceptance Criteria

**US-1 — Forced update on launch (online)**

- *Given* the device is online and a newer APK exists,
  *when* `Home.js` mounts,
  *then* a non-dismissable dialog appears within ~2 s (API round-trip).
- *When* the user taps **Update**, *then* `Linking.openURL(apkURL)` is called.
- *When* the user taps outside the dialog or presses Android back, *then* the dialog remains open.

**US-2 — No interruption when up to date (online)**

- *Given* the device is online and no update is available (API returns 404),
  *when* `Home.js` mounts,
  *then* no dialog appears and the home screen renders normally.

**US-3 — No interruption when offline**

- *Given* the device is offline,
  *when* `Home.js` mounts,
  *then* no API call is made and no dialog appears.

**US-4 — API error does not interrupt the user**

- *Given* the `/apk/version` endpoint returns 5xx or a network timeout,
  *when* `Home.js` mounts,
  *then* no dialog appears and the error is captured to Sentry.

**US-5 — About screen manual check unchanged**

- *Given* the user navigates to About and taps **Update application**,
  *then* the dialog opens immediately with a loading spinner.
- *When* the check completes, *then* the appropriate message is shown.
- *When* an update is available, *then* both **Update** and **Cancel** buttons are shown (soft update — user can dismiss).
- *When* no update exists (404), *then* only **Cancel** is shown.

**US-6 — Language support**

- *Given* the app language is set to French,
  *then* the force-update dialog title, body text, and button labels render in French.

---

## 4. Out of Scope

- iOS APK/IPA update flow (this project is Android-only)
- In-app download progress UI
- Storing "dismissed" state across sessions (the dialog is always force-shown if an update exists)
- Checking for updates in the background (e.g. via `expo-background-fetch`)
- Version pinning or min-version enforcement from the backend

---

## 5. Risks & Notes

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| R-1 | `hasChecked.current` resets on every Home mount — deep-link navigation may re-trigger the check | LOW | Acceptable: the check is lightweight (one GET), and re-checking on re-mount ensures freshness |
| R-2 | `apkURL` is empty or `undefined` in some build configs | LOW | `handleUpdate` already guards with `Linking.canOpenURL`; if unsupported, `Alert.alert` fires |
| R-3 | Android back button dismisses RNEUI `Dialog` despite `onBackdropPress` no-op | MED | Test on device; if confirmed, add `BackHandler` listener in Home to intercept while `visible = true` |
| R-4 | `checkVersion` useCallback deps include `trans.*` — language change recreates it and triggers the effect | LOW | `hasChecked.current` blocks re-run; no observable side effect |

---

## 6. Files

| File | Action | Notes |
|---|---|---|
| `app/src/hooks/use-version-check.js` | **Create** | New shared hook (kebab-case filename, default export `useVersionCheck`) |
| `app/src/lib/i18n/ui-text.js` | **Modify** | Add `updateRequiredTitle` to `en` and `fr` |
| `app/src/pages/Home.js` | **Modify** | Add hook + force-update Dialog |
| `app/src/pages/About/About.js` | **Modify** | Replace inline state/logic with hook |

---

## 7. Handoff to implementation

The implementation must produce:

1. `useVersionCheck.js` with `silent` param, `hasChecked` ref, and `autoCheck` effect
2. `index.js` updated export
3. `ui-text.js` with `updateRequiredTitle` in both locales
4. `Home.js` with non-dismissable force-update Dialog
5. `About.js` refactored — identical UX, removed inline logic

Lint check after each file: `./dc-mobile.sh exec app npx eslint src/pages/Home.js src/pages/About/About.js src/hooks/use-version-check.js`
