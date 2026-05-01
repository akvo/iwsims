# Mobile Auto-Update — Implementation Plan

**Companion**: [`requirements.md`](./requirements.md) · [`plan.md`](./plan.md)
**Files touched**: 4 (1 new, 3 modified)

---

## File layout

```
app/src/
├── hooks/
│   └── use-version-check.js       ← NEW: shared hook (default export: useVersionCheck)
├── lib/
│   └── i18n/
│       └── ui-text.js             ← MODIFIED: add updateRequiredTitle (en + fr)
└── pages/
    ├── Home.js                    ← MODIFIED: autoCheck + force-update Dialog
    └── About/
        └── About.js               ← MODIFIED: replace inline state/logic with hook
```

> Imports are direct (no barrel): `import useVersionCheck from '../hooks/use-version-check'` from Home, `'../../hooks/use-version-check'` from About.

---

## Data flow

```
useVersionCheck({ autoCheck })
   │
   ├── BuildParamsState → appVersion, apkURL
   ├── UIState          → isOnline, lang
   │
   ├── state: visible, checking, updateInfo
   ├── ref:   hasChecked (prevents re-run)
   │
   ├── checkVersion(silent)
   │     silent=true  → GET /apk/version/{appVersion}
   │                      200 → setUpdateInfo + setVisible(true)
   │                      404 → setUpdateInfo (no setVisible)
   │                      5xx → Sentry.captureException (no setVisible)
   │     silent=false → setVisible(true) immediately, then same flow
   │
   └── handleUpdate → Linking.openURL(apkURL)

Home.js
   └── useEffect: autoCheck && isOnline && !hasChecked → checkVersion(true)
   └── <Dialog isVisible={visible} onBackdropPress={noop}>
         <Dialog.Title title="Update Required" />
         <Text>{updateInfo.text}</Text>
         <Dialog.Button>Update</Dialog.Button>   ← only button, no Cancel
       </Dialog>

About.js
   └── <Button onPress={() => checkVersion()}>Update application</Button>
   └── <Dialog isVisible={visible}>
         {checking ? <Loading /> : updateInfo.text + Update? + Cancel}
       </Dialog>
```

---

## Phased task breakdown

### Phase 1 — Create `use-version-check.js`

New file: `app/src/hooks/use-version-check.js`

```javascript
import { useState, useEffect, useCallback, useRef } from 'react';
import { Linking, Alert } from 'react-native';
import * as Sentry from '@sentry/react-native';
import { BuildParamsState, UIState } from '../store';
import { api, i18n } from '../lib';

const useVersionCheck = ({ autoCheck = false } = {}) => {
  const { appVersion, apkURL } = BuildParamsState.useState((s) => s);
  const isOnline = UIState.useState((s) => s.online);
  const { lang } = UIState.useState((s) => s);
  const trans = i18n.text(lang);

  const [visible, setVisible] = useState(false);
  const [checking, setChecking] = useState(false);
  const [updateInfo, setUpdateInfo] = useState({ status: null, text: '' });
  const hasChecked = useRef(false);

  const checkVersion = useCallback(
    (silent = false) => {
      if (!isOnline) {
        return;
      }
      setChecking(true);
      if (!silent) {
        setVisible(true);
      }
      api
        .get(`/apk/version/${appVersion}`)
        .then((res) => {
          setUpdateInfo({
            status: 200,
            text: `${trans.newVersionAvailable} (v ${res.data.version})`,
          });
          if (silent) {
            setVisible(true);
          }
        })
        .catch((e) => {
          setUpdateInfo({ status: e?.response?.status || 500, text: trans.noUpdateFound });
          if (e?.response?.status !== 404) {
            Sentry.captureMessage('[VersionCheck] Unable to fetch app version');
            Sentry.captureException(e);
          }
        })
        .finally(() => {
          setChecking(false);
        });
    },
    [appVersion, isOnline, trans.newVersionAvailable, trans.noUpdateFound],
  );

  const handleUpdate = useCallback(async () => {
    const supported = await Linking.canOpenURL(apkURL);
    if (supported) {
      await Linking.openURL(apkURL);
    } else {
      Alert.alert(`Don't know how to open this URL: ${apkURL}`);
    }
  }, [apkURL]);

  useEffect(() => {
    if (autoCheck && isOnline && !hasChecked.current) {
      hasChecked.current = true;
      checkVersion(true);
    }
  }, [autoCheck, isOnline, checkVersion]);

  return { visible, setVisible, checking, updateInfo, checkVersion, handleUpdate };
};

export default useVersionCheck;
```

**Key notes:**
- `silent=true`: visible is set only in `.then()` (update found) — Home never flashes a dialog while checking
- `silent=false`: visible is set immediately — About shows the loading spinner at once
- `hasChecked.current = true` is set synchronously before the async `checkVersion(true)` call — no race condition
- The `.catch()` branch for 5xx does NOT call `setVisible` in either mode — errors are silent in auto-check

---

### Phase 2 — Add `updateRequiredTitle` translation

File: `app/src/lib/i18n/ui-text.js`

**`en` block** — insert after `updateApp`:
```diff
     updateApp: 'Update application',
+    updateRequiredTitle: 'Update Required',
     checkingVersion: 'Checking for update',
```

**`fr` block** — insert after `updateApp`:
```diff
     updateApp: "Met à jour l'application",
+    updateRequiredTitle: 'Mise à jour requise',
     checkingVersion: 'Vérification des mises à jour',
```

---

### Phase 3 — Refactor `About.js`

File: `app/src/pages/About/About.js`

**Import changes:**
```diff
-import React, { useState, useCallback } from 'react';
-import { View, Linking, Alert, StyleSheet, Text } from 'react-native';
+import React from 'react';
+import { View, StyleSheet, Text } from 'react-native';
 import { Icon, Dialog, Button } from '@rneui/themed';
-import * as Sentry from '@sentry/react-native';
 import { BaseLayout } from '../../components';
 import { BuildParamsState, UIState } from '../../store';
-import { i18n, api } from '../../lib';
+import { i18n } from '../../lib';
+import useVersionCheck from '../../hooks/use-version-check';
```

**State / logic replacement** — remove the three `useState` declarations, `handleCheckAppVersion`, and `handleUpdateButton`; replace with:
```diff
-  const [visible, setVisible] = useState(false);
-  const [checking, setChecking] = useState(false);
-  const [updateInfo, setUpdateInfo] = useState({ status: null, text: '' });
-
-  const handleCheckAppVersion = () => { ... };
-  const handleUpdateButton = useCallback(async () => { ... }, [apkURL]);
+  const { visible, setVisible, checking, updateInfo, checkVersion, handleUpdate } =
+    useVersionCheck();
```

**`BuildParamsState` selector** — no longer needs `appVersion` and `apkURL`:
```diff
-  const { appVersion, apkURL, apkName } = BuildParamsState.useState((s) => s);
+  const { apkName } = BuildParamsState.useState((s) => s);
```

**JSX — button and dialog** — update handler references:
```diff
-          onPress={handleCheckAppVersion}
+          onPress={() => checkVersion()}
```
```diff
-                    <Dialog.Button onPress={handleUpdateButton}>{trans.buttonUpdate}</Dialog.Button>
+                    <Dialog.Button onPress={handleUpdate}>{trans.buttonUpdate}</Dialog.Button>
```

No changes to the dialog structure or the Cancel button — About.js UX is unchanged.

---

### Phase 4 — Update `Home.js`

File: `app/src/pages/Home.js`

**Import changes:**
```diff
-import { Platform, ToastAndroid, TouchableOpacity } from 'react-native';
+import { Platform, Text, ToastAndroid, TouchableOpacity } from 'react-native';
+import { Dialog } from '@rneui/themed';
 ...
 import { api, cascades, i18n } from '../lib';
+import useVersionCheck from '../hooks/use-version-check';
```

**Add hook call** — after existing store selectors (before `getUserForms`):
```diff
+  const { appVersion } = BuildParamsState.useState((s) => s);
+  const {
+    visible: updateDialogVisible,
+    updateInfo,
+    handleUpdate,
+  } = useVersionCheck({ autoCheck: true });
```

> Note: `appVersion` is already in `BuildParamsState`; the hook reads it internally too. We don't need to pass it as a prop.

**Add force-update dialog to JSX** — inside `<BaseLayout>`, after `<FAButton>`:
```diff
       <FAButton ... />
+      <Dialog isVisible={updateDialogVisible} onBackdropPress={() => {}}>
+        <Dialog.Title title={trans.updateRequiredTitle} />
+        <Text>{updateInfo.text}</Text>
+        <Dialog.Actions>
+          <Dialog.Button onPress={handleUpdate}>{trans.buttonUpdate}</Dialog.Button>
+        </Dialog.Actions>
+      </Dialog>
     </BaseLayout>
```

**No other changes to Home.js.** Existing sync logic, GPS, form list, and FAButton are untouched.

---

### Phase 5 — Verification

- [ ] `./dc-mobile.sh exec app npx eslint src/hooks/use-version-check.js src/pages/Home.js src/pages/About/About.js src/lib/i18n/ui-text.js`
- [ ] `./dc-mobile.sh exec app npx prettier --check src/hooks/use-version-check.js src/pages/Home.js src/pages/About/About.js`
- [ ] `cd app && npm test -- --watchAll=false` — existing test suite green; no test files require modification for this change
- [ ] Manual device smoke (online): launch app → Home loads → if update exists, dialog appears and blocks; Update button opens browser
- [ ] Manual device smoke (offline): launch app → Home loads → no dialog, no API call

---

### Phase 6 — Commit

Two sequential commits with `[#<issue>]` prefix:

1. `feat(mobile): extract useVersionCheck shared hook`
   - `app/src/hooks/use-version-check.js`
   - `app/src/lib/i18n/ui-text.js`

2. `feat(mobile): auto version check on Home with force-update dialog + refactor About`
   - `app/src/pages/Home.js`
   - `app/src/pages/About/About.js`

Wait for explicit user go-ahead before push.

---

## Risk register

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| R-1 | Android hardware back button dismisses Dialog despite `onBackdropPress` no-op | MED | Test on device; if confirmed, add `BackHandler` listener in Home while `updateDialogVisible = true` that returns `true` (consume event) |
| R-2 | `apkURL` is blank in a build config | LOW | `handleUpdate` guards with `Linking.canOpenURL`; falls back to `Alert.alert` |
| R-3 | `checkVersion` useCallback recreates on language change → `useEffect` runs → `hasChecked.current` blocks re-run | LOW | No action needed; `hasChecked` correctly gates it |
| R-4 | `silent=true` in `.catch()` — 5xx shows `updateInfo.text` as `trans.noUpdateFound` even though it's a server error | LOW | Acceptable for auto-check (silent): user sees nothing. About.js (non-silent) shows the message in the dialog which already has a Cancel button |

---

## Out of scope

- iOS update flow
- Android `BackHandler` for R-1 (add only if confirmed broken on device)
- Test file additions (`useVersionCheck` is covered via existing About.js path; new unit tests for the hook are a follow-up)
- In-app download progress indicator
