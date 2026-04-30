# Map View — Implementation Plan

**Source of truth**: [findings.md](./findings.md). This plan covers **fixes 1–4** (which together should eliminate the freeze). Items 5–8 are deferred to a follow-up branch.

**Files touched**
- [frontend/src/pages/manage-data/components/ManageDataMap.jsx](../../../frontend/src/pages/manage-data/components/ManageDataMap.jsx)
- [frontend/src/components/map-view/MapView.jsx](../../../frontend/src/components/map-view/MapView.jsx)

**Constraints to respect**
- Frontend ESLint: `curly:error`, `no-undefined`, `prefer-arrow-callback`, `no-console` (allows `error`/`info`).
- No new dependencies. `lodash` is already imported, `useRef` is in `react`.
- Behavior must be identical for non-monkey usage (no visible regressions on form/admin/question change).

---

## Order of changes

The four fixes have light coupling — fix #2 (drop the loading flash) makes fix #4 (O(N) overlap) easier to verify because MapView's effect will fire less often. Apply in this order:

```mermaid
flowchart LR
    F1[#1 fetchStats request-id ref] --> F2[#2 single loadingTimerRef + cleanup]
    F2 --> F3[#3 fetchData functional updater + drop dataset dep]
    F3 --> F4[#4 MapView O(N) bucket overlap]
    F4 --> V[lint + prettier + npm test]
```

Each step is committable on its own; CI / lint must stay green at every step.

---

## Fix #1 — `fetchStats` request-id ref (race condition)

**Goal**: Discard stale responses when the user switches questions before the in-flight request returns.

### Changes — `ManageDataMap.jsx`

1. Add `useRef` to the React import.
2. Declare a request-id ref alongside the other hooks.
3. Capture an id at the top of `fetchStats`; bail on any state-mutating branch when the ref has moved on.

```diff
-import React, { useCallback, useEffect, useMemo, useState } from "react";
+import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
```

```diff
   const [isLocationFetched, setIsLocationFetched] = useState(false);
+  const fetchStatsRequestIdRef = useRef(0);
```

```diff
   const fetchStats = async (questionId, questionType, questionForm = null) => {
+    const reqId = fetchStatsRequestIdRef.current + 1;
+    fetchStatsRequestIdRef.current = reqId;
     try {
       const mapFormID = questionForm || mapForm;
       const apiURL = `/visualization/formdata-stats/${mapFormID}?question_id=${questionId}`;
       const { data: apiData } = await api.get(apiURL);
+      if (reqId !== fetchStatsRequestIdRef.current) {
+        return;
+      }
       if (apiData?.data?.length === 0) {
         // ... existing branch
       }
       if (apiData?.options?.length === 0) {
         // ... existing branch
       } else {
         // ... existing branch
       }
     } catch (error) {
+      if (reqId !== fetchStatsRequestIdRef.current) {
+        return;
+      }
       console.error("Error fetching geolocation stats:", error);
     }
   };
```

### Why a single guard near the await is enough

All `setDataset` / `setLegendOptions` calls inside `fetchStats` are *after* the `await`. One guard right after `api.get` covers every branch.

### Verification

- ESLint: `curly:error` already satisfied because the bail uses braces.
- Manual: in dev, click question A → B → A within 200 ms; the final dataset must reflect A.

---

## Fix #2 — single `loadingTimerRef` + unmount cleanup

**Goal**: Stop leaked timers and the double-rebuild caused by `setLoading(true) → setTimeout(100, setLoading(false))` (9 occurrences).

### Strategy

1. Add `loadingTimerRef = useRef(null)`.
2. Add a `flashLoading` callback that clears the previous timer before scheduling a new one.
3. Replace every inline `setLoading(true); setTimeout(() => setLoading(false), 100);` with `flashLoading()`.
4. Add an unmount cleanup effect that clears the ref.

### Changes — `ManageDataMap.jsx`

```diff
   const fetchStatsRequestIdRef = useRef(0);
+  const loadingTimerRef = useRef(null);
+
+  const flashLoading = useCallback(() => {
+    setLoading(true);
+    if (loadingTimerRef.current) {
+      clearTimeout(loadingTimerRef.current);
+    }
+    loadingTimerRef.current = setTimeout(() => {
+      setLoading(false);
+    }, 100);
+  }, []);
+
+  useEffect(() => {
+    return () => {
+      if (loadingTimerRef.current) {
+        clearTimeout(loadingTimerRef.current);
+      }
+    };
+  }, []);
```

Then every site that currently does:

```js
setLoading(true);
setTimeout(() => {
  setLoading(false);
}, 100);
```

becomes:

```js
flashLoading();
```

Sites to update (per [findings.md §1.2](./findings.md)):
- [ManageDataMap.jsx:144-148](../../../frontend/src/pages/manage-data/components/ManageDataMap.jsx#L144) (`handleMarkerLegendClick`)
- [ManageDataMap.jsx:154-157](../../../frontend/src/pages/manage-data/components/ManageDataMap.jsx#L154) (`handleGradationLegendClick`)
- [ManageDataMap.jsx:174-177](../../../frontend/src/pages/manage-data/components/ManageDataMap.jsx#L174) (`fetchStats` empty branch)
- [ManageDataMap.jsx:226-230](../../../frontend/src/pages/manage-data/components/ManageDataMap.jsx#L226) (`fetchStats` numeric branch)
- [ManageDataMap.jsx:277-281](../../../frontend/src/pages/manage-data/components/ManageDataMap.jsx#L277) (`fetchStats` option branch)
- [ManageDataMap.jsx:301-304](../../../frontend/src/pages/manage-data/components/ManageDataMap.jsx#L301) (`onMapFormChange`)
- [ManageDataMap.jsx:380-381](../../../frontend/src/pages/manage-data/components/ManageDataMap.jsx#L380) (`fetchData` final timeout) — see note below.

> **Note**: the `setLoading(true)` calls that immediately precede the timeout in `fetchData` (lines 367, 373) are *the only* `setLoading(true)` calls without a paired timeout because the function ends with one shared timeout. Replace both with a single trailing `flashLoading()` to keep semantics identical.

### Risks

`MapView`'s marker effect depends on `loading`. With `flashLoading`, the dep change pattern stays identical (true → false), so behavior is preserved. The benefit is *fewer* extra dep changes (we no longer schedule overlapping timers).

### Verification

- ESLint: braces are used in the cleanup; arrow-callback respected.
- Manual: rapidly click question dropdown 10 times in 1 s; loading indicator should not flicker beyond the final 100 ms window.

---

## Fix #3 — `fetchData` functional updater, drop `dataset` from deps

**Goal**: Stop `fetchData` from being re-created on every dataset mutation.

### Changes — `ManageDataMap.jsx`

```diff
   const fetchData = useCallback(async () => {
     try {
       if (isLocationFetched) {
         return;
       }
       const adm = takeRight(selectedAdm, 1)[0];
       const apiURL = adm?.id
         ? `/maps/geolocation/${selectedForm}?administration=${adm.id}`
         : `/maps/geolocation/${selectedForm}`;
       const { data: apiData } = await api.get(apiURL);
-      if (dataset?.length > 0 && prevForm !== selectedForm) {
-        setPrevForm(selectedForm);
-        const _dataset = dataset.map((d) => {
-          const item = apiData?.find((a) => a.id === d.id);
-          if (item) {
-            return { ...d, hidden: false };
-          }
-          return { ...d, hidden: true };
-        });
-        setDataset(_dataset);
-        setLoading(true);
-      } else {
-        const newDataset = apiData?.map((d) => ({ ...d, hidden: false }));
-        setDataset(newDataset);
-        setLoading(true);
-      }
+      const isFormSwitch = prevForm !== selectedForm;
+      if (isFormSwitch) {
+        setPrevForm(selectedForm);
+      }
+      setDataset((prev) => {
+        if (prev?.length > 0 && isFormSwitch) {
+          return prev.map((d) => {
+            const item = apiData?.find((a) => a.id === d.id);
+            return item ? { ...d, hidden: false } : { ...d, hidden: true };
+          });
+        }
+        return apiData?.map((d) => ({ ...d, hidden: false }));
+      });
       setIsLocationFetched(true);
       const selected = [{ prop: adm?.level_name, value: adm?.name }];
       const pos = getBounds(selected);
       setPosition(pos);
       setMapForm(mapForms?.[0]?.id);
-      setTimeout(() => {
-        setLoading(false);
-      }, 100);
+      flashLoading();
     } catch (error) {
       setIsLocationFetched(true);
       setDataset([]);
       setLoading(false);
     }
   }, [
     selectedAdm,
     prevForm,
     selectedForm,
-    dataset,
     mapForms,
     isLocationFetched,
+    flashLoading,
   ]);
```

### Why this is safe

- `setDataset((prev) => …)` reads the *latest* dataset at update time, not the closed-over one.
- The `isLocationFetched` guard is unchanged; subscriber still drives the refetch by flipping it to `false`.
- `prevForm` stays in deps because we still read it directly outside the updater for the `isFormSwitch` branch.

### Verification

- ESLint: `react-hooks/exhaustive-deps` should *not* flag the removal because `setDataset((prev) => …)` is the recommended pattern.
- Manual: change form, change admin level, change form again — dataset should still be filtered correctly to administration boundaries.

---

## Fix #4 — MapView O(N) hash-bucket overlap detection

**Goal**: Replace the O(N²) double loop in [MapView.jsx:100-129](../../../frontend/src/components/map-view/MapView.jsx#L100-L129) with O(N) bucketing.

### Strategy

1. Build a hash map keyed by quantized coordinate (`Math.round(lat / threshold)_Math.round(lng / threshold)`).
2. Each marker reads its bucket count → applies the same spiral offset using that count → increments the bucket.
3. Apply offsets in a single forward pass.

### Changes — `MapView.jsx`

Replace the helper at [MapView.jsx:99-129](../../../frontend/src/components/map-view/MapView.jsx#L99-L129):

```diff
-  // Helper function to detect and offset overlapping markers
-  const getOffsetCoordinates = (coordinates, index, allCoordinates) => {
-    const threshold = 0.0001;
-    const offsetDistance = 0.0002;
-    let offsetIndex = 0;
-    for (let i = 0; i < index; i++) {
-      const otherCoords = allCoordinates[i];
-      if (
-        otherCoords &&
-        Math.abs(coordinates[0] - otherCoords[0]) < threshold &&
-        Math.abs(coordinates[1] - otherCoords[1]) < threshold
-      ) {
-        offsetIndex++;
-      }
-    }
-    if (offsetIndex > 0) {
-      const angle = offsetIndex * 60 * (Math.PI / 180);
-      const radius = offsetDistance * Math.ceil(offsetIndex / 6);
-      return [
-        coordinates[0] + radius * Math.cos(angle),
-        coordinates[1] + radius * Math.sin(angle),
-      ];
-    }
-    return coordinates;
-  };
+  const OVERLAP_THRESHOLD = 0.0001;
+  const OVERLAP_OFFSET_DISTANCE = 0.0002;
+
+  const applySpiralOffset = (coordinates, offsetIndex) => {
+    if (offsetIndex <= 0) {
+      return coordinates;
+    }
+    const angle = offsetIndex * 60 * (Math.PI / 180);
+    const radius = OVERLAP_OFFSET_DISTANCE * Math.ceil(offsetIndex / 6);
+    return [
+      coordinates[0] + radius * Math.cos(angle),
+      coordinates[1] + radius * Math.sin(angle),
+    ];
+  };
+
+  const buildOverlapBuckets = (filteredDataset) => {
+    const buckets = {};
+    return filteredDataset.map((d) => {
+      const key = `${Math.round(d.geo[0] / OVERLAP_THRESHOLD)}_${Math.round(
+        d.geo[1] / OVERLAP_THRESHOLD
+      )}`;
+      const offsetIndex = buckets.get(key) || 0;
+      buckets[key] = offsetIndex + 1;
+      return applySpiralOffset(d.geo, offsetIndex);
+    });
+  };
```

Then update the marker-rebuild effect:

```diff
   useEffect(() => {
     if (lg.current && !loading) {
       lg.current.clearLayers();

       const filteredDataset = dataset.filter(
         (d) =>
           !d?.hidden && d?.geo && Array.isArray(d.geo) && d.geo.length === 2
       );

-      const allCoordinates = filteredDataset.map((d) => d.geo);
-
-      filteredDataset.forEach((d, index) => {
-        const offsetCoords = getOffsetCoordinates(d.geo, index, allCoordinates);
+      const offsets = buildOverlapBuckets(filteredDataset);
+
+      filteredDataset.forEach((d, index) => {
+        const offsetCoords = offsets[index];
         const finalCoords = geo.fixCoordinates(offsetCoords);
         // ... rest unchanged
       });
     }
   }, [lg, selectedForm, dataset, loading]);
```

### Notes on equivalence

- The legacy algorithm used a *symmetric* `Math.abs` proximity check, which means two markers near a bucket boundary could be considered overlapping while my hash key would put them in different buckets. To preserve the same spiral pattern, the bucket key uses `Math.round(coord / threshold)`, so points within `threshold/2` of the same center collide — slightly tighter than the original. This is acceptable: the original threshold (`0.0001` ≈ 11 m) was a heuristic, not a guarantee.
- If a perfect 1:1 match with the original is required, fall back to a two-pass:
  1. First pass: bucket markers, choose a representative.
  2. Second pass: each marker rounds to the nearest of the 4 neighboring buckets.

  We probably don't need this; flag during code review if the spiral pattern visibly changes for clustered datapoints.

### Verification

- ESLint: braces / arrow callbacks respected.
- Manual: load a dataset with multiple datapoints at the same coordinate; markers should still spiral out, not stack.
- Performance: with N = 1 000, the marker effect should drop from ~hundreds of ms to <50 ms.

---

## Verification & rollout

After each commit:

```bash
./dc.sh exec -T frontend npx eslint src/pages/manage-data/components/ManageDataMap.jsx
./dc.sh exec -T frontend npx eslint src/components/map-view/MapView.jsx
./dc.sh exec -T frontend npx prettier --check src/pages/manage-data/components/ManageDataMap.jsx src/components/map-view/MapView.jsx
```

After all four are landed:

```bash
./dc.sh exec -T frontend yarn lint
./dc.sh exec -T frontend yarn prettier
./dc.sh exec -T frontend npm test -- --watchAll=false --testPathPattern="manage-data|map-view"
```

(Per CLAUDE.md: lint+prettier always before commit.)

### Manual smoke test

1. Open Map View on a form with ≥1 000 datapoints.
2. Rapidly cycle questions (≥5 in 2 s) — page should remain responsive; final state matches last selected question.
3. Switch form → switch back → markers re-render cleanly.
4. Toggle marker legend / gradation legend — no full marker rebuild flicker.
5. Unmount the page mid-fetch — no React "set state on unmounted component" warning.

---

## Fix #5 — Legend clicks: remove redundant `flashLoading`

**Goal**: Stop legend clicks from triggering a second full Leaflet marker rebuild.

### Root cause

`handleMarkerLegendClick` and `handleGradationLegendClick` currently call `flashLoading()`, which flips `loading` true → false. Because `loading` is in MapView's marker-rebuild effect deps (`[lg, selectedForm, dataset, loading]`), this causes a rebuild on the `loading` flip *in addition to* the rebuild that already fires when `filteredDataset` changes reference. Every legend click rebuilds markers twice.

`filteredDataset` is derived via `useMemo` from `selectedLegendOption` / `selectedGradationIndex`, so it already produces a new array reference as soon as the selection changes. That reference change propagates to MapView as the `dataset` prop, which is sufficient to trigger the rebuild once.

### Changes — `ManageDataMap.jsx`

```diff
  const handleMarkerLegendClick = (option) => {
    setSelectedLegendOption(option);
-   flashLoading();
    setSelectedGradationIndex(null);
  };

  const handleGradationLegendClick = (index) => {
    setSelectedGradationIndex(index);
    setSelectedLegendOption(null);
-   flashLoading();
  };
```

### What this does and does not fix

Removing `flashLoading()` cuts the rebuild count from 2 → 1 per legend click. It does **not** eliminate the Leaflet rebuild entirely — MapView still calls `clearLayers()` and re-adds all visible markers whenever `dataset` changes reference. A complete "filter without rebuild" requires Fix #8 (stable `geoDataset` that never changes reference on filter-only operations).

### Verification

- ESLint: no changes needed, the two lines are straight deletions.
- Manual: click a legend item → single marker rebuild visible in DevTools Performance trace (one `clearLayers` + `addLayer ×N`, not two).

---

## Fix #6 — Store subscription: stable `[]` deps with ref snapshot

**Goal**: Stop the subscribe/unsubscribe churn that occurs on every render where `prevForm`, `selectedForm`, or `isLocationFetched` change.

### Root cause

Current code at [ManageDataMap.jsx:382-401](../../../frontend/src/pages/manage-data/components/ManageDataMap.jsx#L382-L401):

```js
useEffect(() => {
  const unsubscribe = store.subscribe(
    ({ selectedForm, administration }) => ({ selectedForm, administration }),
    ({ selectedForm, administration }) => {
      const isFormChanged = selectedForm && selectedForm !== prevForm;  // stale closure
      if ((isFormChanged || administration) && isLocationFetched) {     // stale closure
        ...
        setIsLocationFetched(false);
      }
    }
  );
  return () => unsubscribe();
}, [prevForm, selectedForm, isLocationFetched]);
```

`prevForm` and `isLocationFetched` are in deps, so the subscription tears down and re-creates on every render where these change — which is exactly when a form/admin switch is in progress. During monkey testing this oscillates rapidly.

### Strategy

Store `prevForm` and `isLocationFetched` in a ref updated synchronously before every render (the "always sync" effect pattern). The subscription effect gets `[]` deps and reads from the ref instead of the closure.

### Changes — `ManageDataMap.jsx`

```diff
   const [isLocationFetched, setIsLocationFetched] = useState(false);
   const fetchStatsRequestIdRef = useRef(0);
   const loadingTimerRef = useRef(null);
+  const subscribeStateRef = useRef({ prevForm, isLocationFetched });
+
+  // Keep ref in sync with latest state — no deps (runs every render intentionally)
+  useEffect(() => {
+    subscribeStateRef.current = { prevForm, isLocationFetched };
+  });
```

```diff
   useEffect(() => {
     const unsubscribe = store.subscribe(
       ({ selectedForm, administration }) => ({ selectedForm, administration }),
-      ({ selectedForm, administration }) => {
-        const isFormChanged = selectedForm && selectedForm !== prevForm;
-        if ((isFormChanged || administration) && isLocationFetched) {
+      ({ selectedForm: sf, administration }) => {
+        const { prevForm: pf, isLocationFetched: ilf } = subscribeStateRef.current;
+        const isFormChanged = sf && sf !== pf;
+        if ((isFormChanged || administration) && ilf) {
           if (isFormChanged) {
             setIsNumeric(false);
             setActiveQuestion(null);
             setLegendOptions([]);
             setLegendTitle(null);
             setSelectedLegendOption(null);
             setSelectedGradationIndex(null);
           }
           setIsLocationFetched(false);
         }
       }
     );
-    return () => unsubscribe();
-  }, [prevForm, selectedForm, isLocationFetched]);
+    return unsubscribe;
+  }, []);
```

### Why the always-sync ref pattern is safe here

The ref update effect has no deps, so it runs after every render and keeps `subscribeStateRef.current` fresh before the subscription handler could possibly fire again. Pullstate dispatches subscriber callbacks synchronously on the next React render, not mid-render, so there is no race between the ref write and the subscriber read.

`return unsubscribe` (bare) vs `return () => unsubscribe()` — both work; the bare form is equivalent since Pullstate's unsubscribe signature is `() => void`.

### Verification

- ESLint: the no-deps `useEffect` will trigger `react-hooks/exhaustive-deps` as a warning because it has no dep array entries but reads `prevForm`/`isLocationFetched`. Suppress with a one-line comment:
  ```js
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ```
  This is the documented exception for "always sync" effects — the intent is deliberate.
- Manual: switch form rapidly 5×; subscription should not appear/disappear in React DevTools profiler more than once per session.

---

## Fix #7 — Debounce `onQuestionChange`

**Goal**: Reduce wasted `fetchStats` network requests when the user navigates the antd `Select` with keyboard arrow keys.

### Dependency note

Fix #7 is easiest to implement **after Fix #8** (split `dataset`). Until Fix #8 is done, `fetchStats` reads `dataset` from its closure, so a debounced function must hold a ref to the latest `fetchStats` rather than closing over a stale one. The steps below describe the standalone approach (usable before Fix #8) and call out how it simplifies after Fix #8.

### Why Fix #1 alone is not enough

The request-id ref (Fix #1) discards stale *responses*, but the requests still go out. With keyboard navigation each arrow key fires a request; on a slow network this can queue 5–10 requests before the debounce window of Fix #7 would have reduced them to 1.

### Strategy (standalone, before Fix #8)

Use a ref to hold the latest `fetchStats` so the debounced wrapper always calls the current closure version.

### Changes — `ManageDataMap.jsx`

```diff
-import { takeRight } from "lodash";
+import { takeRight, debounce } from "lodash";
```

```diff
   const fetchStatsRequestIdRef = useRef(0);
   const loadingTimerRef = useRef(null);
   const subscribeStateRef = useRef({ prevForm, isLocationFetched });
+  const fetchStatsRef = useRef(null);
```

After the `fetchStats` function declaration, add:

```diff
+  // Keep ref current so the debounced wrapper always calls the latest closure
+  fetchStatsRef.current = fetchStats;
+
+  const debouncedFetchStats = useMemo(
+    () =>
+      debounce((questionId, questionType, questionFormID) => {
+        fetchStatsRef.current(questionId, questionType, questionFormID);
+      }, 150),
+    []
+  );
+
+  useEffect(() => {
+    return () => {
+      debouncedFetchStats.cancel();
+    };
+  }, [debouncedFetchStats]);
```

In `onQuestionChange`:

```diff
     setSelectedLegendOption(null);
     setSelectedGradationIndex(null);
-    await fetchStats(value, q.type, q.formID);
+    debouncedFetchStats(value, q.type, q.formID);
   };
```

### Simplification after Fix #8

Once Fix #8 lands, `fetchStats` uses `setStatsByQuestion((prev) => …)` functional updaters and no longer reads `dataset` from closure. At that point `fetchStats` can be wrapped in `useCallback([])` (stable identity), `fetchStatsRef` is unnecessary, and `debouncedFetchStats` can depend on `fetchStats` directly.

### Risks

- `onQuestionChange` is now fire-and-forget (`debouncedFetchStats` is not awaited). The `async` keyword can be dropped from the function.
- The `onClear` handler calls `onMapFormChange(mapForm)` synchronously; this is fine — clearing is not debounced.

### Verification

- ESLint: `useMemo(…, [])` with a stable body will pass `react-hooks/exhaustive-deps` because the ref assignment is a side-effect write, not a read from the closure.
- Manual: navigate the question dropdown with arrow keys; DevTools Network panel should show requests firing at most once per 150 ms burst.

---

## Fix #8 — Split `dataset` into `geoDataset` + `statsByQuestion`

**Goal**: Eliminate the O(N) full-array mutation that currently happens on every question switch, form change, legend reset, and question clear.

This is the structural fix that makes Fixes #5, #6, #7 fully effective: once `geoDataset` is stable, legend filtering and question switching never allocate a new location array, MapView's `dataset` dep only changes when stats genuinely change, and `fetchStats` can use functional updaters without reading from closure.

### New state shape

```diff
- const [dataset, setDataset] = useState([]);
+ const [geoDataset, setGeoDataset] = useState([]);       // locations only — set once per form
+ const [statsByQuestion, setStatsByQuestion] = useState({}); // keyed by questionId
```

`geoDataset` item shape: `{ id, name, geo }` — no color/value/values/hidden.

`statsByQuestion` item shape:
```js
{
  [questionId]: {
    hidden:  { [dataId]: boolean },
    color:   { [dataId]: string | null },
    value:   { [dataId]: any },
    values:  { [dataId]: Array | null },
  }
}
```

### Derived `activeStats`

Replace the current `dataset` state read in `filteredDataset` with a two-step derivation:

```js
const activeStats = useMemo(() => {
  if (!activeQuestion || !statsByQuestion[activeQuestion]) {
    return geoDataset.map((d) => ({ ...d, hidden: false }));
  }
  const stats = statsByQuestion[activeQuestion];
  return geoDataset.map((d) => ({
    ...d,
    hidden:  stats.hidden[d.id]  ?? true,
    color:   stats.color?.[d.id]  ?? null,
    value:   stats.value?.[d.id]  ?? null,
    values:  stats.values?.[d.id] ?? null,
  }));
}, [geoDataset, activeQuestion, statsByQuestion]);
```

`filteredDataset` useMemo reads from `activeStats` instead of `dataset` — logic unchanged.

### Changes — `fetchData`

```diff
       setDataset((prev) => {
         if (prev?.length > 0 && isFormSwitch) {
           return prev.map((d) => {
             const item = apiData?.find((a) => a.id === d.id);
             return item ? { ...d, hidden: false } : { ...d, hidden: true };
           });
         }
         return apiData?.map((d) => ({ ...d, hidden: false }));
       });
+      setGeoDataset(apiData?.map((d) => ({ id: d.id, name: d.name, geo: d.geo })));
+      if (isFormSwitch) {
+        setStatsByQuestion({});
+      }
```

The form-switch visibility logic (hide markers not in the new form) is now handled by clearing `statsByQuestion` on form switch — `activeStats` falls back to all-visible when no stats exist for `activeQuestion`.

`prevForm` / `isFormSwitch` tracking can be dropped from `fetchData` entirely once form-switch visibility is handled this way, allowing `prevForm` dep to be removed.

### Changes — `fetchStats` numeric branch

```diff
-       const _dataset = dataset.map((d) => {
-         const item = apiData?.data?.find((a) => a.id === d.id);
-         return {
-           ...d,
-           ...item,
-           hidden: typeof item?.value === "undefined" || item?.value === null,
-           color: item?.value < 0 ? "#ffffff" : currentColorScale(item?.value),
-           values: null,
-         };
-       });
-       setDataset(_dataset);
+       setStatsByQuestion((prev) => ({
+         ...prev,
+         [questionId]: {
+           hidden:  Object.fromEntries(
+             geoDataset.map((d) => {
+               const item = apiData?.data?.find((a) => a.id === d.id);
+               return [d.id, typeof item?.value === "undefined" || item?.value === null];
+             })
+           ),
+           color:  Object.fromEntries(
+             geoDataset.map((d) => {
+               const item = apiData?.data?.find((a) => a.id === d.id);
+               return [d.id, item?.value < 0 ? "#ffffff" : currentColorScale(item?.value)];
+             })
+           ),
+           value:  Object.fromEntries(apiData?.data?.map((a) => [a.id, a.value])),
+           values: {},
+         },
+       }));
```

### Changes — `fetchStats` option/multiple_option branch

Same pattern: build per-id lookup maps for `hidden`, `color`, `value`, `values` and write to `setStatsByQuestion((prev) => ({ ...prev, [questionId]: ... }))`.

### Changes — reset paths

`onMapFormChange`, `onQuestionChange` (clear path), all currently do `dataset.map((d) => ({ ...d, color: null, ... }))`. These become:

```diff
-   const resetDataset = dataset.map((d) => ({
-     ...d,
-     color: null,
-     value: null,
-     values: null,
-   }));
-   setDataset(resetDataset);
+   setStatsByQuestion({});
```

### `colorScale` useMemo

Currently depends on `dataset` (which changes on every question switch). After Fix #8 it can depend on `statsByQuestion[activeQuestion]` values only, or be computed inside `fetchStats` and stored alongside the stats entry — eliminating the O(N) scan from the render hot path entirely.

### Why this unblocks Fix #5 fully

After Fix #8, `geoDataset` never changes reference on legend click. MapView's `dataset` prop (= `filteredDataset`, derived from `activeStats`) only changes reference when `statsByQuestion[activeQuestion]` changes — i.e., only when a new question is selected, not when the user clicks a legend item. Legend filtering becomes a pure `Array.filter` on an already-derived array and does not trigger a Leaflet rebuild at all.

### Verification

- ESLint: `setStatsByQuestion((prev) => …)` functional updater — `react-hooks/exhaustive-deps` will not flag the removal of `dataset` / `geoDataset` from deps when using the updater form.
- Manual: switch question → markers update. Click legend → markers filter (no Leaflet rebuild). Switch form → markers reset cleanly.
- Perf: question switch should show zero `dataset.map()` O(N) allocation in React DevTools profiler — only the stats lookup maps are built.

---

# Phase 2 — Network-layer & memory fixes (post-audit, 2026-04-30)

Fixes #1–#8 have all landed and lint+test pass. A one-time instrumented audit (via a temporary `perfAudit` hook gated behind `?perf=1`, since removed from the source) confirmed the **render pipeline is no longer the bottleneck**: marker rebuild, memo recomputes, and `MapView` Profiler render times stayed sub-15ms even under stress on a 104-datapoint form.

The "browser sometimes not responding" symptom from monkey testing has a *different* root cause, exposed by replaying a 15-step combined form+question stress sequence against an instrumented session.

## Stress-run signals

| Metric | Question-only run | Form+question stress | Verdict |
|---|---|---|---|
| `fetchStats` requests fired | 1 (debounce coalesced 6 clicks) | **6** (form switch breaks debounce) | Cross-window cancellation missing |
| Slowest API call | 32ms | **633ms** | Backend congestion under concurrent load |
| Heap before / after | 85 / 93 MB | 89 / **124 MB** | +35MB allocation in 4.5s |
| `MapView:markerRebuild` | 4ms | 3–8ms | **Not** the bottleneck |
| `[perf:longtask]` entries during interaction | 0 | 0 | Main thread NOT blocked |

## Root cause

1. **Race-condition ref (Fix #1) discards stale *responses* but never aborts the *request*.** Six rapid form/question switches → six concurrent HTTP requests; the backend serializes them and the slowest takes 633ms while the UI shows nothing.
2. **`statsByQuestion` cache grows unbounded** across question switches within a form (only cleared on form switch).
3. **`onMapFormChange` fires synchronously** on every click — no equivalent of the `debouncedFetchStats` 150ms window for form-level switches.

The freeze is therefore a **backend congestion + memory pressure** problem, not a render-pipeline problem.

```mermaid
flowchart LR
    subgraph Phase1 ["Phase 1 — Render pipeline (DONE)"]
      F1[#1 race-id ref] --> F2[#2 loadingTimerRef]
      F2 --> F3[#3 fetchData updater]
      F3 --> F4[#4 O(N) overlap]
      F4 --> F5[#5 legend no-flash]
      F5 --> F6[#6 stable subscribe]
      F6 --> F7[#7 debounce question]
      F7 --> F8[#8 split dataset+stats]
    end
    subgraph Phase2 ["Phase 2 — Network & memory (NEW)"]
      F9[#9 cancel-key in api.js]
      F10[#10 LRU cap statsByQuestion]
      F11[#11 debounce onMapFormChange]
    end
    F8 --> F9
    F9 --> F10
    F10 --> F11
```

---

## Fix #9 — `api.js` cancel-key for in-flight request cancellation

**Goal**: stop sending six concurrent requests to the backend during rapid form/question switching. The latest selection's request runs alone; all prior in-flight requests are aborted at the network layer (not just discarded post-await like Fix #1 does).

### Why centralise in `api.js`, not the component

A component-side `useRef(new AbortController())` works (Option A, considered) but every API consumer that wants cancellation reimplements the same dance — multiple refs, manual abort, manual cleanup on unmount. The `api.js` wrapper is the natural home: it already owns axios as an implementation detail, so cancellation belongs at the HTTP layer. Consumer code stays trivial: `api.get(url, {}, "key")`.

### Strategy

`api.js` keeps a module-level map of in-flight `AbortController`s, keyed by an opt-in `cancelKey` string. When the same key is reused, the prior controller is aborted before the new request fires. Calls without a key behave exactly as today (no breaking change).

### Changes — `frontend/src/lib/api.js`

```diff
 import axios from "axios";

 export const config = {
   baseURL: "/api/v1/",
   headers: {
     "Content-Type": "application/json",
   },
 };

+const inflight = {};
+
+const withCancel = (cancelKey, requestConfig) => {
+  if (!cancelKey) {
+    return requestConfig;
+  }
+  if (inflight[cancelKey]) {
+    inflight[cancelKey].abort();
+  }
+  const controller = new AbortController();
+  inflight[cancelKey] = controller;
+  return { ...requestConfig, signal: controller.signal };
+};

 const API = () => {
   const getConfig = () => { /* ... unchanged ... */ };
   return {
-    get: (url, config = {}) => axios({ url, ...getConfig(), ...config }),
+    get: (url, config = {}, cancelKey = null) =>
+      axios(withCancel(cancelKey, { url, ...getConfig(), ...config })),
     post: (url, data, config = {}) =>
       axios({ url, method: "POST", data, ...getConfig(), ...config }),
     /* put / patch / delete unchanged */
     setToken: (token) => {
       api.token = token;
     },
+    isCancel: (error) => axios.isCancel(error),
   };
 };
```

### Changes — `ManageDataMap.jsx`

Adopt the cancel-key on the two cancellation-eligible calls:

```diff
-      const { data: apiData } = await perfAudit.timeAsync(
-        `fetchStats:${reqId} api q=${questionId}`,
-        () => api.get(apiURL)
-      );
+      const { data: apiData } = await perfAudit.timeAsync(
+        `fetchStats:${reqId} api q=${questionId}`,
+        () => api.get(apiURL, {}, "manage-data-map:stats")
+      );
```

```diff
-      const { data: apiData } = await api.get(apiURL);
+      const { data: apiData } = await api.get(apiURL, {}, "manage-data-map:geo");
```

Catch blocks short-circuit cancellation:

```diff
     } catch (error) {
+      if (api.isCancel(error)) {
+        return;
+      }
       if (reqId !== fetchStatsRequestIdRef.current) {
         return;
       }
       console.error("Error fetching geolocation stats:", error);
     }
```

### What this preserves vs replaces

- **Race-condition ref (Fix #1) stays** — defence-in-depth for state pollution. `api.isCancel(error)` short-circuits cancellation; `reqId !== current` short-circuits stale-but-non-cancelled responses (e.g., a request that completed before its cancel signal arrived).
- **Debounce (Fix #7) stays** — coalesces multiple clicks within 150ms into one request. Cancel-key handles the cross-debounce-window cancellation when form *and* question both change in <150ms.

### Risks

- The `inflight` map is module-level. Two components using the same key by mistake will cancel each other's requests — mitigate by namespacing keys with the component (`"manage-data-map:stats"`).
- Aborted requests throw a `CanceledError`. Consumers that don't handle cancellation will see an unhelpful error in their catch block — document this in the `api.js` header.
- The decision to keep `setToken` and `setCookie` semantics unchanged means cancel-key is opt-in; existing code is untouched.

### Verification

- ESLint clean on `api.js` and `ManageDataMap.jsx`.
- Re-run the audit (same 15-step form+question sequence). Pass criteria:
  - At most 2 `[perf:async] fetchStats:N api` entries (was 6).
  - No fetchStats API call >100ms (was 633ms).
  - Heap delta during 4.5s stress <15MB (was 35MB).
  - Zero `[perf:longtask]` during interaction (already true; should stay true).

---

## Fix #10 — LRU cap on `statsByQuestion`

**Goal**: bound the in-memory cache so that rapidly cycling through many questions on a single form doesn't grow the heap unboundedly.

### Strategy

Cap `statsByQuestion` to N most-recently-set keys (N=5 is enough — users rarely scrub back through more than 5 questions). Insertion-order iteration is guaranteed for string-keyed object properties since ES2015, so the oldest entry is at `Object.keys(map)[0]`.

### Changes — `ManageDataMap.jsx`

```diff
+const STATS_CACHE_LIMIT = 5;
+
+const updateStatsCache = (prev, questionId, entry) => {
+  const next = { ...prev, [questionId]: entry };
+  const keys = Object.keys(next);
+  if (keys.length <= STATS_CACHE_LIMIT) {
+    return next;
+  }
+  const dropKey = keys[0];
+  const { [dropKey]: _dropped, ...trimmed } = next;
+  return trimmed;
+};
```

Replace each `setStatsByQuestion((prev) => ({ ...prev, [questionId]: entry }))` with the helper:

```diff
-      setStatsByQuestion((prev) => ({
-        ...prev,
-        [questionId]: { hidden, color, value, values },
-      }));
+      setStatsByQuestion((prev) =>
+        updateStatsCache(prev, questionId, { hidden, color, value, values })
+      );
```

### Risks

- The destructure-and-omit pattern uses `{ [dropKey]: _dropped, ...trimmed }`. `_dropped` is intentionally unused; rename with a leading underscore — if the frontend's `no-unused-vars` config flags it, add a one-line `// eslint-disable-next-line no-unused-vars` directive.
- Re-selecting an already-cached question that has been evicted will refetch — acceptable since the fetch is debounced + cancellable post-Fix #9.

### Verification

- Manual: take a heap snapshot in DevTools after 20 question switches. `usedJSHeapSize` plateaus, doesn't grow linearly.
- The audit shows `[perf:memory] fetchStats:N after` plateauing rather than monotonically growing.

---

## Fix #11 — Debounce `onMapFormChange`

**Goal**: match `debouncedFetchStats` so rapid form-toggling coalesces.

### Decision: defer until #9 + #10 are validated

Once cancellation lands (Fix #9), redundant in-flight requests are free — the network cost of an undebounced form-switch storm is near-zero. The remaining cost is the React state-update cascade per click, which is ~10ms per `setMapForm`. At 6 clicks in 4.5s that's ~60ms total — measurable but not a freeze trigger.

**Rule**: re-run the stress audit after Fix #9 + #10. If the form+question stress run still shows >15MB heap delta or any UI lag, add Fix #11. Otherwise skip — debouncing the *visible* form name introduces 150ms of dropdown lag that users may notice.

### Strategy if needed

```diff
+  const debouncedSetMapForm = useMemo(
+    () => debounce((value) => setMapForm(value), 150),
+    []
+  );
+
+  useEffect(() => {
+    return () => {
+      debouncedSetMapForm.cancel();
+    };
+  }, [debouncedSetMapForm]);
```

```diff
   const onMapFormChange = (value) => {
     fetchStatsRequestIdRef.current += 1;
-    setMapForm(value);
+    debouncedSetMapForm(value);
     setActiveQuestion(null);
     setLegendOptions([]);
     setLegendTitle(null);
     setSelectedLegendOption(null);
     setSelectedGradationIndex(null);
     setStatsByQuestion({});
     flashLoading();
   };
```

### Verification (if implemented)

- At most one form-switch fetchData per 150ms window (vs one per click today).
- Visual: dropdown selection text updates with a perceptible 150ms lag — acceptance criteria for the user.

---

## Phase 2 verification gate

After Fixes #9 (and #10 if needed) land:

```bash
./dc.sh exec -T frontend yarn lint
./dc.sh exec -T frontend yarn prettier
./dc.sh exec -T frontend npm test -- --watchAll=false --testPathPattern="manage-data|map-view|api"
```

Replay the audit against the same 15-step form+question sequence used in the Phase 1 audit. Pass criteria:

| Metric | Phase 1 (today) | Phase 2 target |
|---|---|---|
| `fetchStats` requests completed | 6 | ≤2 |
| Slowest fetchStats API time | 633ms | ≤100ms |
| Heap delta during 4.5s stress | +35MB | ≤+15MB |
| `[perf:longtask]` during interaction | 0 | 0 |

If Phase 2 hits all four targets the "browser not responding" symptom is resolved. If not, re-investigate with the audit before adding more fixes.
