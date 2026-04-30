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

## Out of scope (deferred)

- Fix #5 (legend filter-only path): requires reshaping `MapView` to update existing layers in place rather than tearing down on `dataset` change. Larger refactor.
- Fix #6 (subscribe `useEffect` `[]` deps + state ref): straightforward but cross-cutting; bundle with #7.
- Fix #7 (debounce `onQuestionChange`): may interact with #1 (request-id ref already removes most of the wasted-fetch concern); evaluate after measuring.
- Fix #8 (split `dataset` into `locations` + `stats`): the proper structural fix; track in a separate ticket.
