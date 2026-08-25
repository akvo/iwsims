# Mobile: only ask to save when there are unsaved changes

**Status:** implemented and verified on device.
**Follows on from:** [`mobile-monitoring-draft-management.md`](doc/claude/mobile-monitoring-draft-management.md)
(issue [#33](https://github.com/akvo/iwsims/issues/33)), which added draft management to the
Submission list. This addresses the friction that work exposed: reviewing drafts became common, and
every review ends in a dialog that had nothing to offer.

---

## The problem

Open a saved draft, read it, press back — the save/exit dialog appears even though nothing was
touched. The trigger is not "did anything change" but "are there any answers at all":

```js
// app/src/pages/FormPage.js — the header back button
const handleOnPressArrowBackButton = async () => {
  if (Object.keys(currentValues).length) {
    setShowDialogMenu(true);
    return;
  }
  await refreshForm();
  navigation.goBack();
};
```

`fetchSavedSubmission` loads the draft's stored answers into `currentValues` on mount, so that
condition is true from the first frame. A new empty form behaves correctly; every existing draft is
a guaranteed false alarm. The same condition is duplicated in the hardware back handler.

## What counts as a change

Answers are not written only by typing. Five places write `currentValues`:

| Writer | When |
|---|---|
| [`QuestionGroup:57`](app/src/form/components/QuestionGroup.js#L57) | user edits a field |
| [`FormContainer:167-174`](app/src/form/FormContainer.js#L167-L174) | user pages between groups — fills `pre` questions still empty |
| [`TypeGeo:47,75`](app/src/form/fields/TypeGeo.js#L47) | a GPS fix resolves |
| [`TypeAutofield:70`](app/src/form/fields/TypeAutofield.js#L70) | dependencies resolve |
| [`MapView:40,66`](app/src/pages/MapView.js#L40) | user picks a point on the map |

**All five count.** A dirty flag that followed only typing would call the last four "unchanged" and
let back discard them. A captured GPS fix silently thrown away is far worse than one unnecessary
dialog, so the definition is: *anything that alters the answers after they were loaded is a change
worth offering to save.*

## Approach

One flag in `FormState`, set by a single subscription rather than at each writer — a missed writer
means silent data loss, and a sixth added later would be missed by default. `Pullstate.subscribe`
is already used this way in [`Home.js:308`](app/src/pages/Home.js#L308).

`TypeAutofield` mutates in place (`s.currentValues[id] = value`) rather than replacing the object.
Pullstate is immer-based, so that still produces a new reference and the subscription still fires.

---

## Change 1 — `app/src/store/forms.js`

```diff
 const FormState = new Store({
   form: {},
   currentValues: {}, // answers
   visitedQuestionGroup: [], // to store visited question group id
   surveyDuration: 0,
   surveyStart: null,
   cascades: {},
   lang: 'en',
   feedback: {},
   loading: false,
   prevAdmAnswer: null,
   entityOptions: {},
   repeats: {}, // to store repeatable question groups: { groupId: [0, 1, 2, ...] }
   forceUpdateToken: null, // to force re-render when needed
   previousForm: null,
+  // True once anything has written to currentValues that was not the initial load.
+  // Gates the save/exit dialog: without it, opening a saved draft and pressing back
+  // always prompted, because loading the answers looked the same as entering them.
+  hasUnsavedChanges: false,
 });
```

## Change 2 — `app/src/pages/FormPage.js`

### 2a. Track the load window

`fetchSavedSubmission` writes the stored answers into state. That write must not count as a change,
so it is bracketed by a ref the subscription checks.

```diff
   const db = SQLite.useSQLiteContext();
   // Stable for the life of this screen, so a retry after a failed save overwrites its
   // own fallback file instead of accumulating one per attempt.
   const submissionUuidRef = useRef(route.params?.uuid || Crypto.randomUUID());
+  // Writes made by the app itself — loading a draft, clearing the form — are not
+  // changes by the user. Pullstate runs subscriptions synchronously inside update()
+  // (`_updateState` iterates `clientSubscriptions` in a plain loop), so raising this
+  // before an update and lowering it after reliably covers exactly that update.
+  const suppressTrackingRef = useRef(false);
+
+  // Runs `write` with change tracking off. Synchronous by design: an async callback
+  // would leave the flag down while the write happens.
+  const withoutTracking = (write) => {
+    suppressTrackingRef.current = true;
+    try {
+      write();
+    } finally {
+      suppressTrackingRef.current = false;
+    }
+  };
```

### 2b. The subscription

Placed after `refreshForm` is defined. Empty dependency array — it must be installed once for the
life of the screen, and it captures nothing that changes.

```jsx
  useEffect(() => {
    // FormState is global and outlives this screen, so a flag left set by the last
    // form would make the very first back press prompt. Reset on mount.
    FormState.update((s) => {
      s.hasUnsavedChanges = false;
    });

    // Subscribing catches every writer — fields, prefill, geo, autofield, map —
    // including ones added later, which setting the flag at each call site would not.
    const unsubscribe = FormState.subscribe(
      (s) => s.currentValues,
      () => {
        if (suppressTrackingRef.current) {
          return;
        }
        FormState.update((s) => {
          s.hasUnsavedChanges = true;
        });
      },
    );

    return unsubscribe;
  }, []);
```

### 2c. Read the flag

```diff
   const currentValues = FormState.useState((s) => s.currentValues);
+  const hasUnsavedChanges = FormState.useState((s) => s.hasUnsavedChanges);
```

### 2d. Clear it when the answers are cleared

`refreshForm` already runs after a save, a submit and a discard — every path that legitimately ends
the editing session.

```diff
-    FormState.update((s) => {
-      s.surveyStart = null;
-      s.currentValues = {};
-      s.visitedQuestionGroup = [];
-      s.cascades = {};
-      s.surveyDuration = 0;
-      s.repeats = {};
-    });
+    // Suppressed: clearing the answers must not register as the user changing them.
+    // Setting hasUnsavedChanges = false inside this same update would NOT work —
+    // see the note below.
+    withoutTracking(() => {
+      FormState.update((s) => {
+        s.surveyStart = null;
+        s.currentValues = {};
+        s.visitedQuestionGroup = [];
+        s.cascades = {};
+        s.surveyDuration = 0;
+        s.repeats = {};
+        s.hasUnsavedChanges = false;
+      });
+    });
```

> **Why the suppression is required here, not merely tidy.** Subscribers run *inside*
> `_updateState`, after `this.currentState` has already been replaced. So a subscriber that calls
> `FormState.update` runs a **nested, re-entrant update on the new state**. Without the
> suppression, `refreshForm` would resolve like this:
>
> 1. `update()` produces the next state — `currentValues: {}`, `hasUnsavedChanges: false`;
> 2. `_updateState` commits it, then notifies subscribers;
> 3. our subscriber sees `currentValues` changed and calls `update(s => s.hasUnsavedChanges = true)`;
> 4. that nested update commits **on top of** the state from step 1.
>
> The flag ends up `true` immediately after the form was cleared, and the next back press prompts
> about a form with no answers in it. Suppressing the window is what makes step 3 a no-op.

### 2e. Both exit paths

```diff
   const handleOnPressArrowBackButton = async () => {
-    if (Object.keys(currentValues).length) {
+    if (hasUnsavedChanges) {
       setShowDialogMenu(true);
       return;
     }
     await refreshForm();
     navigation.goBack();
   };
```

```diff
   useEffect(() => {
     const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
-      if (Object.keys(currentValues).length) {
+      if (hasUnsavedChanges) {
         setShowDialogMenu(true);
         return true;
       }
       refreshForm();
       return false;
     });
     return () => backHandler.remove();
-  }, [currentValues, refreshForm]);
+  }, [hasUnsavedChanges, refreshForm]);
```

### 2f. Bracket the load

```diff
   const fetchSavedSubmission = useCallback(async () => {
     if (!savedDataPointId) {
       return;
     }
     setLoading(true);
     const dpValue = await crudDataPoints.selectDataPointById(db, { id: savedDataPointId });
     setCurrentDataPoint(dpValue);
     const jsonData = dpValue?.json;
     if (jsonData && Object.keys(jsonData).length) {
       // …cascade normalisation unchanged…
-      FormState.update((s) => {
-        s.currentValues = jsonData;
-        s.prevAdmAnswer = prevAdmAnswer;
-      });
+      // The stored answers arriving in state is not the user changing them.
+      withoutTracking(() => {
+        FormState.update((s) => {
+          s.currentValues = jsonData;
+          s.prevAdmAnswer = prevAdmAnswer;
+        });
+      });
     }
     setLoading(false);
   }, [db, savedDataPointId, formJSON]);
```

No timer is involved. Subscriptions are dispatched synchronously from within `update()`, so the
window that needs covering begins and ends inside the `withoutTracking` call.

> An earlier draft of this plan deferred the release with `setTimeout(…, 0)`, hedging against
> asynchronous notification. Reading `_updateState` settled it — and showed the timer was not just
> redundant but harmful: it left tracking suppressed for an extra macro task, so an edit or a GPS
> write landing in that window would have been ignored.

## Change 3 — `app/src/form/support/SaveDialogMenu.js`

Four unexplained buttons become four options under a heading. Worth adding only now: the dialog
previously appeared when there was nothing at stake, so a title claiming unsaved changes would
often have been false.

```diff
 import React from 'react';
 import { StyleSheet } from 'react-native';
 import { Dialog } from '@rneui/themed';
 import { UIState } from '../../store';
 import { i18n } from '../../lib';

 const SaveDialogMenu = ({ visible, setVisible, handleOnSaveAndExit, handleOnExit }) => {
   const activeLang = UIState.useState((s) => s.lang);
   const trans = i18n.text(activeLang);

   return (
     <Dialog visible={visible} testID="save-dialog-menu" overlayStyle={styles.dialogMenuContainer}>
+      <Dialog.Title title={trans.unsavedChangesTitle} />
       <Dialog.Button
         type="solid"
         title={trans.buttonSaveNExit}
         testID="save-and-exit-button"
```

The overlay is already content-sized, so the extra row cannot clip the last button the way
`flex: 0.2` did when the fourth button was added.

## Change 4 — `app/src/lib/i18n/ui-text.js`

```diff
 // en:
     confirmExit: 'Are you sure want to exit form submission?',
+    unsavedChangesTitle: 'You have unsaved changes',
```

```diff
 // fr:
     confirmExit: 'Êtes-vous sûr de vouloir quitter la soumission des formulaires?',
+    unsavedChangesTitle: 'Vous avez des modifications non enregistrées',
```

---

## Rejected alternative: compare snapshots

The first draft of this proposal snapshotted the answers on load and compared a stable-stringified
`transformAnswers(currentValues, formJSON)` against it on exit.

It reaches the same definition of "changed" by a longer route, and it depends on two things this
design does not: `transformAnswers` being pure — it is called on the save path but never twice on
the same input for comparison — and a key-order-independent serialisation, since `currentValues` is
rebuilt by spreading on every edit.

The flag observes that a write happened instead of reconstructing whether the outcome differs.

**What that gives up:** editing a value and changing it back still counts as a change. The snapshot
approach would have skipped that dialog. Accepted, in exchange for not having to trust a
serialisation to be canonical.

## Also rejected: set the flag at each writer

Five one-line edits instead of one subscription. Rejected because a missed writer means a silent
discard, and the failure is invisible — nothing warns you that a new writer needs the line. The
subscription is the same amount of code and cannot be forgotten.

---

## Verification

1. **The fix.** Open a saved draft, page through every group, press back → **no dialog**. This is
   also the case most likely to fail: paging triggers the prefill writer, which by design marks the
   form changed. If it fires on a draft where those questions were already answered, prefill needs
   the same suppression as the initial load.
2. Open a draft, edit one field, press back → dialog, now titled.
3. Open a draft containing a geo question, wait for the GPS fix, press back → dialog. `TypeGeo`
   writes a hardcoded `[-1.3855559, 37.9938594]` when it cannot get a fix
   ([`:57`](app/src/form/fields/TypeGeo.js#L57)); if that fires on drafts that already had
   coordinates, the dialog appears more often than it should. Pre-existing, but this change makes
   it visible.
4. New empty form, press back → no dialog (unchanged from today).
5. New form, one answer, press back → dialog.
6. Save and exit, reopen the draft, press back → no dialog. Proves the flag does not survive the
   screen.
7. `cd app && npm run lint` — note the test suite cannot run in this environment; see the Step 9
   note in the parent plan.

## Risks

- **Pullstate notification timing** is load-bearing twice: the `setTimeout` in 2f and the
  single-update reset in 2d. Both are called out inline above; both fail in the same visible
  direction — the dialog appears when it should not, which is today's behaviour, not a regression.
- **A global flag for screen-local state.** `hasUnsavedChanges` lives in `FormState` alongside
  `currentValues`, which it describes, and is reset on mount and on `refreshForm`. The alternative —
  `useState` in `FormPage` — cannot be read by the subscription without a ref dance, and nothing
  outside `FormPage` needs it today.
- **No automated coverage.** The mobile suite does not run (66 failed / 6 passed on stock `main`),
  so this ships on manual verification like the rest of #33.
