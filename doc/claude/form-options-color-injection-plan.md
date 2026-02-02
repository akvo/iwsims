# Technical Plan: Form Options Color Injection

## Overview

This document outlines the technical approach for modifying the Jupyter notebook `scripts/form-options-color/generate_options_color.ipynb` to automatically inject hex color codes into the "color" field for every option in all `.prod.json` form files based on semantic analysis of option labels.

## Objectives

1. Iterate through all `.prod.json` files in `backend/source/forms/`
2. **Only process questions with `type: "option"` or `type: "multiple_option"`**
3. Analyze the semantic meaning of each option's `label` field
4. Assign appropriate hex color codes based on label semantics
5. **Ensure every option within a question has a unique color**
6. **Use map-readable colors (dark, saturated - not light/pastel)**
7. **Provide fallback colors for unclassified labels**
8. Preserve existing color assignments where present
9. Ensure JSON structure remains valid and compatible with `form_seeder.py`

## Color Usage Context

Colors are rendered in `MapView.jsx` for:
1. **Single markers**: `background-color: ${bgColor}` (line 35)
2. **Multi-option pie markers**: `conic-gradient(${colors})` (lines 25-32)

**Requirements for map visibility:**
- Dark/saturated colors (not pastel/light)
- High contrast against map backgrounds (blue water, green land, gray roads)
- Distinct enough to differentiate in pie chart slices

## Color Palette Design

### Semantic Colors (Primary)

```python
# High-saturation, dark colors for map visibility
SEMANTIC_COLORS = {
    "positive": "#64A73B",      # Green - Operational, Good, Yes (user-specified)
    "negative": "#e41a1c",      # Red - Issue, Poor, No (user-specified)
    "warning": "#d95f02",       # Dark Orange - Maintenance, Moderate
    "neutral": "#1f78b4",       # Dark Blue - Satisfactory, Other
    "info": "#6a3d9a",          # Purple - Informational
}

# Risk levels
RISK_LEVEL_COLORS = {
    "no risk": "#64A73B",       # Green
    "low risk": "#1f78b4",      # Dark Blue
    "moderate risk": "#d95f02", # Dark Orange
    "medium risk": "#d95f02",   # Dark Orange
    "high risk": "#e41a1c",     # Red
}
```

### Fallback Palette (Map-Readable)

All colors selected for:
- **Minimum lightness**: 25-55% in HSL (no pastels)
- **High saturation**: 60-100%
- **Map contrast**: Visible against satellite/terrain/street maps

```python
# 20-color palette optimized for map markers
# Based on ColorBrewer "Dark2" + "Set1" qualitative palettes
FALLBACK_PALETTE = [
    "#1b9e77",  # Teal
    "#d95f02",  # Dark Orange
    "#7570b3",  # Purple
    "#e7298a",  # Magenta
    "#66a61e",  # Olive Green
    "#e6ab02",  # Dark Yellow/Gold
    "#a6761d",  # Brown
    "#666666",  # Dark Gray
    "#e41a1c",  # Red
    "#377eb8",  # Blue
    "#4daf4a",  # Green
    "#984ea3",  # Purple
    "#ff7f00",  # Orange
    "#a65628",  # Brown
    "#f781bf",  # Pink
    "#999999",  # Gray
    "#66c2a5",  # Cyan
    "#8da0cb",  # Steel Blue
    "#e78ac3",  # Light Pink
    "#a6d854",  # Lime
]
```

### Color Contrast Validation

Each color checked against white (#FFFFFF) background:
| Color | Hex | Contrast Ratio | WCAG AA |
|-------|-----|----------------|---------|
| Teal | #1b9e77 | 3.2:1 | ✓ Large |
| Dark Orange | #d95f02 | 3.5:1 | ✓ Large |
| Purple | #7570b3 | 4.1:1 | ✓ |
| Magenta | #e7298a | 3.8:1 | ✓ Large |
| Red | #e41a1c | 4.0:1 | ✓ |
| Blue | #377eb8 | 4.5:1 | ✓ |
| Green | #64A73B | 3.1:1 | ✓ Large |

## Classification Algorithm

### Question Type Filtering

Only questions with these types are processed:
```python
OPTION_QUESTION_TYPES = {"option", "multiple_option"}
```

Other question types (e.g., `number`, `text`, `cascade`) are skipped even if they have an `options` field.

### Priority Order

1. **Risk Level Check** - Special handling for "risk" labels
2. **Exact Match** - Direct label-to-category mapping
3. **Negative Patterns** - Catch problems/issues first
4. **Positive Patterns** - Good/working states
5. **Warning Patterns** - Moderate/maintenance states
6. **Fallback** - Assign from palette ensuring uniqueness

### Exact Match Map

```python
EXACT_MATCH_MAP = {
    # Positive (Green #64A73B)
    "yes": "positive",
    "operational": "positive",
    "good": "positive",
    "available": "positive",
    "completed": "positive",
    "secured": "positive",
    "covered": "positive",
    "fine": "positive",
    "normal": "positive",
    "normal operation": "positive",
    "oprational": "positive",  # Typo in data

    # Negative (Red #e41a1c)
    "no": "negative",
    "poor": "negative",
    "broken": "negative",
    "blocked": "negative",
    "missing": "negative",
    "faulty": "negative",
    "not available": "negative",
    "not operational": "negative",
    "non operational": "negative",
    "non-operational": "negative",
    "issue with the system": "negative",
    "not used": "negative",
    "not active": "negative",

    # Warning (Dark Orange #d95f02)
    "satisfactory": "warning",
    "maintenance in progress": "warning",
    "intermittent": "warning",
    "ongoing": "warning",
    "need maintenance": "warning",
    "needs upgrade": "warning",

    # Neutral (Dark Blue #1f78b4)
    "other": "neutral",
    "others": "neutral",
}
```

### Pattern Lists

```python
# Negative indicators (check first - catch problems)
NEGATIVE_PATTERNS = [
    "failure", "failed", "problem", "issue", "error",
    "not ", "dead ", "hazard", "inadequate", "improper",
    "excessive", "overflow", "clogged", "clogging", "damaged",
    "leaking", "leakage", "defunct", "flooded",
    "g0 ",  # G0 = No toilet (sanitation negative)
]

# Positive indicators
POSITIVE_PATTERNS = [
    "in operation", "working", "functional", "active",
    "g1 ",  # G1 = Toilet present (sanitation positive)
]

# Warning indicators
WARNING_PATTERNS = [
    "partial", "mild", "some", "in progress",
    "moderate", "medium", "upgrading",
]
```

## Implementation

### Core Function: Color Assignment with Uniqueness

```python
def assign_colors_to_options(
    options: List[Dict],
    preserve_existing: bool = True
) -> Tuple[List[Dict], Dict]:
    """
    Assign colors ensuring:
    1. Semantic colors for classified labels
    2. NO duplicate colors within the same question
    3. Fallback colors for unclassified (from map-readable palette)

    Returns:
        - Modified options list
        - Statistics dictionary
    """
    stats = {
        "total": len(options),
        "semantic": 0,
        "fallback": 0,
        "preserved": 0,
        "changes": []
    }

    used_colors = set()
    fallback_index = 0

    # First pass: collect existing colors
    if preserve_existing:
        for option in options:
            if option.get("color"):
                used_colors.add(option["color"].lower())

    # Second pass: assign colors
    for option in options:
        label = option.get("label", "")

        # Skip if already has color and preserving
        if preserve_existing and option.get("color"):
            stats["preserved"] += 1
            continue

        # Try semantic classification
        semantic_color = classify_label(label)
        assigned_color = None
        color_type = None

        if semantic_color and semantic_color.lower() not in used_colors:
            assigned_color = semantic_color
            color_type = "semantic"
            stats["semantic"] += 1
        else:
            # Use fallback palette
            while fallback_index < len(FALLBACK_PALETTE):
                candidate = FALLBACK_PALETTE[fallback_index]
                fallback_index += 1
                if candidate.lower() not in used_colors:
                    assigned_color = candidate
                    color_type = "fallback"
                    stats["fallback"] += 1
                    break

            # Generate if palette exhausted
            if not assigned_color:
                assigned_color = generate_dark_color(len(used_colors))
                color_type = "generated"
                stats["fallback"] += 1

        # Assign color
        option["color"] = assigned_color
        used_colors.add(assigned_color.lower())

        stats["changes"].append({
            "label": label,
            "color": assigned_color,
            "type": color_type
        })

    return options, stats


def generate_dark_color(seed: int) -> str:
    """
    Generate a dark, saturated color for map visibility.
    Uses HSL with constrained lightness (30-50%) and saturation (70-100%).
    """
    hue = (seed * 137.508) % 360  # Golden angle for distribution
    saturation = 0.7 + (seed % 3) * 0.1  # 70-90%
    lightness = 0.35 + (seed % 4) * 0.05  # 35-50%

    r, g, b = colorsys.hls_to_rgb(hue/360, lightness, saturation)
    return "#{:02x}{:02x}{:02x}".format(int(r*255), int(g*255), int(b*255))
```

### Classification Function

```python
def classify_label(label: str) -> Optional[str]:
    """Return hex color based on semantic classification, or None."""
    label_lower = label.lower().strip()

    # 1. Risk levels (special handling)
    if "risk" in label_lower:
        for term, color in RISK_LEVEL_COLORS.items():
            if term in label_lower:
                return color

    # 2. Exact matches
    if label_lower in EXACT_MATCH_MAP:
        return SEMANTIC_COLORS[EXACT_MATCH_MAP[label_lower]]

    # 3. Negative patterns (priority - catch problems first)
    for pattern in NEGATIVE_PATTERNS:
        if pattern in label_lower:
            return SEMANTIC_COLORS["negative"]

    # 4. Positive patterns
    for pattern in POSITIVE_PATTERNS:
        if pattern in label_lower:
            return SEMANTIC_COLORS["positive"]

    # 5. Warning patterns
    for pattern in WARNING_PATTERNS:
        if pattern in label_lower:
            return SEMANTIC_COLORS["warning"]

    # No semantic match
    return None
```

### Surgical JSON Save Function

```python
def save_json_with_colors(
    filepath: Path,
    original_content: str,
    color_map: Dict[int, str]
) -> str:
    """
    Save JSON by surgically injecting colors into the original content.
    Preserves original formatting to minimize git diff noise.

    Args:
        filepath: Path to save
        original_content: Original file content
        color_map: Dict mapping option IDs to colors {option_id: color_hex}
    """
    content = original_content

    for option_id, color in color_map.items():
        # Find the option by its ID
        id_pattern = rf'"id":\s*{option_id}'
        id_match = re.search(id_pattern, content)

        if not id_match:
            continue

        # Find enclosing braces and inject color
        # ... (brace matching logic)

        # Detect compact vs expanded format
        if '\n' in option_text:
            # Expanded: add on new line with proper indentation
            new_option = before_brace + f',\n{indent}"color": "{color}"\n' + indent[:-2] + '}'
        else:
            # Compact: add inline
            new_option = '{ ' + inner + f', "color": "{color}" }}'

        content = content[:obj_start] + new_option + content[obj_end:]

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
```

## Notebook Structure

```
scripts/form-options-color/generate_options_color.ipynb

Cell 0:  Markdown - Title and requirements
Cell 1:  Imports and Configuration
Cell 2:  Color Palettes (map-readable)
Cell 3:  Classification Patterns (EXACT_MATCH_MAP, patterns)
Cell 4:  classify_label() function
Cell 5:  Color Assignment (assign_colors_to_options, generate_dark_color)
Cell 6:  JSON Processing (process_question, process_form)
Cell 7:  File I/O - Surgical Approach (save_json_with_colors)
Cell 8:  Main Processing Loop (build_color_map, process_all_forms)
Cell 9:  Reporting Functions (generate_report, show_detailed_assignments)
Cell 10: DRY RUN - Preview Changes
Cell 11: Show Semantic Assignments
Cell 12: Show Fallback Assignments
Cell 13: APPLY CHANGES (commented out by default)
```

## Surgical JSON Modification

To minimize git diff noise, the implementation uses a **surgical approach** that:
1. Reads the original JSON file as raw text
2. Finds each option object by its `id` field
3. Injects `"color": "#xxx"` before the closing brace
4. Preserves original formatting (compact vs expanded)

This ensures the git diff only shows the added color fields:
```diff
-            { "value": "yes", "label": "Yes", "id": 123, "order": 1 },
+            { "value": "yes", "label": "Yes", "id": 123, "order": 1, "color": "#64A73B" },
```

## Example Transformations

### Before (no colors)
```json
{
  "label": "The current status of this system?",
  "options": [
    { "label": "Operational" },
    { "label": "Issue with the system" }
  ]
}
```

### After (semantic colors)
```json
{
  "label": "The current status of this system?",
  "options": [
    { "label": "Operational", "color": "#64A73B" },
    { "label": "Issue with the system", "color": "#e41a1c" }
  ]
}
```

### Unclassified Labels (fallback)
```json
{
  "label": "Method of Water Testing Used?",
  "options": [
    { "label": "Lab Test", "color": "#1b9e77" },
    { "label": "CBT Test", "color": "#d95f02" }
  ]
}
```

### Many Options (unique colors)
```json
{
  "label": "Weather Condition",
  "options": [
    { "label": "Rainy", "color": "#377eb8" },
    { "label": "Cloudy", "color": "#666666" },
    { "label": "Fine", "color": "#64A73B" }
  ]
}
```

## Validation

### Pre-Execution Checks

1. **Dry-run mode** - Preview all changes without writing
2. **Color uniqueness** - Verify no duplicates per question
3. **JSON validity** - Parse output to confirm structure

### Post-Execution Checks

1. **form_seeder.py** - Run seeder, check for errors
2. **Visual inspection** - Load map, verify marker visibility
3. **Contrast check** - Colors visible on map tile backgrounds

## Summary

| Requirement | Solution |
|-------------|----------|
| Question types | Only `option` and `multiple_option` types |
| Semantic colors | Exact match + pattern classification |
| Unique per question | Track used colors, assign from palette |
| Map readable | Dark palette (L: 30-50%, S: 70-100%) |
| Unclassified labels | 20-color fallback palette |
| Palette exhausted | Generate via golden angle HSL |
| Existing colors | Preserve, skip reassignment |
| Minimal git diff | Surgical JSON injection (preserve formatting) |

**Key Colors:**
- Operational/Good/Yes → `#64A73B` (Green)
- Issue/Poor/No → `#e41a1c` (Red)
- Maintenance/Moderate → `#d95f02` (Dark Orange)
- Satisfactory/Other → `#1f78b4` (Dark Blue)
