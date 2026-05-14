# QBS Asset Scanner — Full Project Specification

> **Based on:** commit `3163d9e` (stable baseline)
> **Last updated:** 2026-05-15

---

## 1. Purpose

The QBS Asset Scanner is a multi-user barcode-based asset auditing tool. Staff members open a web page served by Google Apps Script, scan physical barcodes with their phone cameras, and the system records who checked each asset, when, and where — all written directly to a Google Sheet.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  User's Browser                                                 │
│                                                                 │
│  ┌──────────────────────────┐    postMessage()    ┌───────────┐ │
│  │  GAS Web App             │◄───────────────────│ wrapper    │ │
│  │  (Index.html +           │     { type:         │ .html     │ │
│  │   Scanner.html)          │       'BARCODE',    │ (GitHub   │ │
│  │                          │       value: '...'} │  Pages)   │ │
│  │  Vue 3 + Bootstrap 5.3   │                     │ html5-    │ │
│  └──────────┬───────────────┘                     │ qrcode    │ │
│             │ google.script.run                   └───────────┘ │
│             ▼                                                   │
│  ┌──────────────────────────┐                                   │
│  │  Google Apps Script       │                                   │
│  │  (Code.js / Code.gs)     │                                   │
│  │  - LockService           │                                   │
│  │  - SpreadsheetApp        │                                   │
│  └──────────┬───────────────┘                                   │
│             ▼                                                   │
│  ┌──────────────────────────┐                                   │
│  │  Google Sheet             │                                   │
│  │  - Config sheet           │                                   │
│  │  - Audit data sheet       │                                   │
│  │  - Locations sheet        │                                   │
│  └──────────────────────────┘                                   │
└─────────────────────────────────────────────────────────────────┘
```

**Why the pop-up?** GAS serves HTML inside a strict `<iframe>`. Mobile browsers block camera access inside iframes. The `wrapper.html` page runs on GitHub Pages (a first-party origin), gets camera access, and sends scanned barcodes back to the GAS tab via `window.opener.postMessage()`.

---

## 3. Repository Structure

```
qbs-scanner/
├── .clasp.json          ← Links to GAS project (scriptId)
├── .claspignore         ← Excludes *.md and wrapper.html from clasp push
├── appsscript.json      ← GAS manifest (timezone, runtime, webapp config)
├── Code.js              ← Server-side logic (pushed to GAS as Code.gs)
├── Index.html           ← Main HTML template (pushed to GAS)
├── Scanner.html         ← Vue 3 app logic (included into Index.html at runtime)
├── wrapper.html         ← Barcode scanner pop-up (served by GitHub Pages ONLY)
├── plan.md              ← Original design spec / task list
└── specification.md     ← This document
```

### Deployment Targets

| File | Deployed to | Mechanism |
|------|-------------|-----------|
| `Code.js` | Google Apps Script (as `Code.gs`) | `clasp push` |
| `Index.html` | Google Apps Script | `clasp push` |
| `Scanner.html` | Google Apps Script | `clasp push` |
| `appsscript.json` | Google Apps Script | `clasp push` |
| `wrapper.html` | GitHub Pages | `git push` to `main` branch |
| `*.md` files | Not deployed anywhere | Excluded by `.claspignore` |

### Clasp Configuration (`.clasp.json`)

```json
{
  "scriptId": "1vcO9MdYGe_0jb1pQ6R6dPmQBQwXsH__P8CPBhvFAIB7wOR-ZGMXBkepy",
  "scriptExtensions": [".js", ".gs"],
  "htmlExtensions": [".html"],
  "jsonExtensions": [".json"]
}
```

### Clasp Ignore (`.claspignore`)

```
**/*.md
wrapper.html
```

This ensures `wrapper.html` and markdown files are NOT pushed to GAS — `wrapper.html` is only served by GitHub Pages.

---

## 4. GAS Manifest (`appsscript.json`)

```json
{
  "timeZone": "Asia/Shanghai",
  "runtimeVersion": "V8",
  "exceptionLogging": "STACKDRIVER",
  "webapp": {
    "executeAs": "USER_DEPLOYING",
    "access": "ANYONE_ANONYMOUS"
  }
}
```

| Setting | Value | Meaning |
|---------|-------|---------|
| `executeAs` | `USER_DEPLOYING` | All spreadsheet writes use the deployer's permissions |
| `access` | `ANYONE_ANONYMOUS` | No Google login required to open the page (but `Session.getActiveUser()` still reads the signed-in user) |
| `runtimeVersion` | `V8` | Modern JS (arrow functions, template literals, etc.) |

---

## 5. Google Sheet Data Model

The app reads from three sheets in the bound Google Spreadsheet:

### 5.1 Config Sheet

| Row | Column A | Column B |
|-----|----------|----------|
| 1 | `CurrentAuditSheet` | `Audit 11May2026` |

- Tells the app which data sheet to read/write.
- If the Config sheet is missing, defaults to `"Audit 11May2026"`.

### 5.2 Audit Data Sheet (e.g. "Audit 11May2026")

Column mapping is done dynamically by header text matching (`getColumnMap_`). Default index fallbacks are provided:

| Column | Header Text Match | Default Index | Data Type |
|--------|-------------------|---------------|-----------|
| Asset No | contains `"asset no"` | 0 | String (barcode value) |
| Description | contains `"description"` | 1 | String |
| Location | contains `"location"` | 3 | String (location name) |
| Tag | exact match `"tag"` | 4 | String |
| Staff No | contains `"staff no"` | 5 | String |
| Timestamp | contains `"timestamp"` | 6 | String (written as `en-GB` locale) |
| Username | contains `"username"` | 7 | String (email prefix) |
| Need Tag | contains `"need tag"` | 8 | `"Yes"` or empty |
| Remarks | contains `"remarks"` | 9 | String (pipe-delimited) |

**Check status logic:** If the `Timestamp` column has a value → `syncStatus = 2` (checked). Otherwise → `syncStatus = 0` (unchecked).

### 5.3 Locations Sheet

| Column | Header Text Match | Default Index |
|--------|-------------------|---------------|
| Location (name) | exact `"location"` | 3 |
| Loc Code | `"loc_code"` or `"loc code"` | 4 |

Returns a dictionary: `{ locCode: locationName }`.
Used for the **location tracking** feature: when a user scans a location barcode, the view auto-filters to that location.

---

## 6. Backend — `Code.js` (205 lines)

### 6.1 Function Reference

| # | Function | Visibility | Purpose |
|---|----------|------------|---------|
| 1 | `doGet(e)` | Public (web app entry) | Renders `Index.html` as a template, sets title and viewport meta tag |
| 2 | `include(filename)` | Template helper | Embeds `Scanner.html` into `Index.html`; sets `XFrameOptionsMode.ALLOWALL` |
| 3 | `getConfig_()` | Private (`_` suffix) | Reads Config sheet → returns target audit sheet name |
| 4 | `getInitialData()` | Public (called from client) | Bulk-reads the entire audit sheet, returns `{ assets[], currentUser, locationMap, currentSheetName }` |
| 5 | `updateAsset(assetNo, payload)` | Public (called from client) | Single-asset update with `LockService` (10s timeout) |
| 6 | `updateAssetsBulk(assetNos, payload)` | Public (called from client) | Multi-asset update with `LockService` (15s timeout) |
| 7 | `getColumnMap_(headers)` | Private | Maps header strings → column indexes |
| 8 | `getLocationMap_()` | Private | Reads Locations sheet → returns `{ code: name }` dictionary |

### 6.2 `getInitialData()` Return Shape

```js
{
  assets: [
    {
      rowIdx: 2,              // 1-based sheet row
      assetNo: "QBS-001",
      description: "HP Laptop 14 inch",
      location: "Room 201",
      tag: "A-101",
      staffNo: "S001",
      timestamp: "14/05/2026, 10:30:00",  // or empty string
      username: "steve",                   // or empty string
      needTag: false,
      remarks: "",
      syncStatus: 0           // 0=unchecked, 2=checked
    },
    // ...
  ],
  currentUser: "steve",       // email prefix before @
  locationMap: {              // from Locations sheet
    "RM201": "Room 201",
    "RM301": "Room 301"
  },
  currentSheetName: "Audit 11May2026"
}
```

### 6.3 `updateAsset(assetNo, payload)` Details

**Payload shape:**
```js
{
  user: "steve",
  needTag: true,          // optional
  remark: "some note"     // optional
}
```

**What it writes:**
1. `Timestamp` column ← `new Date().toLocaleString('en-GB')`
2. `Username` column ← `payload.user`
3. `Need Tag` column ← `"Yes"` or `""` (only if `payload.needTag` is defined)
4. `Remarks` column ← appends with `" | "` separator (only if `payload.remark` is truthy)
5. Calls `SpreadsheetApp.flush()` to ensure immediate write

**Concurrency:** Uses `LockService.getScriptLock()` with 10-second wait. Returns `{ success, error }` on failure.

**Return:** `{ success: true, assetNo: "QBS-001", timestamp: "14/05/2026, 10:30:00" }`

### 6.4 `updateAssetsBulk(assetNos, payload)` Details

- Same lock strategy but 15-second timeout
- Only writes `Timestamp` and `Username` (no needTag or remarks in bulk mode)
- Returns `{ success: true, timestamp: "..." }`

---

## 7. Frontend — `Index.html` (188 lines)

### 7.1 External Dependencies (CDN)

```html
<script src="https://unpkg.com/vue@3/dist/vue.global.js"></script>
<script src="https://unpkg.com/html5-qrcode"></script>
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
```

> **Note:** `html5-qrcode` is loaded in `Index.html` but NOT used there — it's only actively used in `wrapper.html`. It's likely included here as a leftover from the pre-popup architecture.

### 7.2 Layout (CSS Flexbox)

```
┌─────────────────────────────────────┐
│ #app (flex column, height: 100%)    │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ .top-fixed-area (flex-shrink:0) │ │
│ │ - Sheet title + User badge      │ │
│ │ - Location alert (if tracking)  │ │
│ │ - Location dropdown             │ │
│ │ - "Open Web Scanner" button     │ │
│ │ - Sort/Bulk/Search controls     │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │ .scrollable-list-area           │ │
│ │ (flex-grow:1, overflow-y:auto)  │ │
│ │ - Asset cards (v-for)           │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │ #bulk-footer (fixed bottom)     │ │
│ │ (visible only in bulk mode)     │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

- `body` has `overflow: hidden` — only the `.scrollable-list-area` scrolls.
- `[v-cloak]` hides raw Vue mustaches until mount completes.

### 7.3 Asset Card States

| syncStatus | CSS Class | Visual |
|------------|-----------|--------|
| `0` (unchecked) | `.status-0` | Grey left border |
| `1` (processing) | `.status-1` | Orange left border, yellow background |
| `2` (checked) | `.status-2` | Green left border, 85% opacity |

### 7.4 Asset Card — Expanded View

When a card is clicked (not in bulk mode), it expands to show action buttons:

- **Check** — manually mark as checked (disabled if already checked)
- **Need Tag?** / **Tag Needed** — toggle; turns red when active
- **✏️ Edit** — opens a textarea for custom remarks

### 7.5 Template Inclusion

Line 186: `<?!= include('Scanner'); ?>`

This is a GAS template directive. At serve time, GAS calls `include('Scanner')`, which reads `Scanner.html` and injects its content inline.

---

## 8. Frontend — `Scanner.html` (291 lines)

This file contains the entire Vue 3 application. It is a `<script>` tag (no template — the template is in `Index.html`).

### 8.1 Data Properties

```js
data() {
  return {
    assets: [],             // Array of asset objects from getInitialData()
    locationMap: {},        // { locCode: locationName }
    currentSheet: 'Loading...',
    currentUser: '...',
    selectedLocation: 'All',
    trackedLocation: null,  // Auto-set when a location barcode is scanned
    hideChecked: false,     // (currently unused in UI but exists in filter logic)
    sortBy: 'assetNo',     // Current sort column
    searchQuery: '',        // Free-text search across all columns
    lastScan: '',           // Last scanned barcode text
    bulkMode: false,        // Bulk selection mode toggle
    selectedAssets: [],     // Array of assetNo strings selected for bulk check
    isProcessing: false     // Debounce flag after a scan
  }
}
```

### 8.2 Computed Properties

| Property | Purpose |
|----------|---------|
| `totalAssets` | `assets.length` |
| `totalChecked` | Count of assets with `syncStatus === 2` |
| `locationStats` | Array of `{ name, total, checked, isComplete }` for each unique location |
| `isCurrentLocationComplete` | Whether all assets in the selected location are checked |
| `filteredAssets` | The main display list — filtered by location, hide-checked toggle, and search query, then sorted |

### 8.3 `filteredAssets` Pipeline

```
All assets
  → Filter by selectedLocation (or 'All')
  → Filter by hideChecked toggle
  → Filter by searchQuery (case-insensitive, searches: assetNo, location, description, tag, staffNo, remarks, username)
  → Sort by sortBy column (string comparison, ascending)
```

### 8.4 Methods

| Method | Lines | Behaviour |
|--------|-------|-----------|
| `loadData()` | 81–93 | Calls `google.script.run.getInitialData()`, maps results into reactive assets with `expanded`, `editingRemark`, `newRemark` added |
| `handleCardClick(asset)` | 95–105 | In bulk mode: toggles selection. Otherwise: toggles card expansion |
| `toggleNeedTag(asset)` | 107–110 | Flips `needTag` boolean; if already synced, calls `syncAsset` |
| `manualCheck(asset)` | 112–115 | Guards `syncStatus > 0`, then calls `processAssetCheck` |
| `submitRemark(asset)` | 117–127 | Formats remark as `"username:text"`, appends to `asset.remarks`, calls `syncAsset` |
| `toggleBulkMode()` | 129–132 | Toggles bulk mode; clears selections |
| `bulkCheck()` | 134–163 | Filters selected unchecked assets, sets `syncStatus=1`, calls `updateAssetsBulk`, handles success/failure |
| `openWebScanner()` | 165–167 | `window.open('https://jeons1qbs.github.io/qbs-scanner/wrapper.html', '_blank')` |
| `receiveMessage(event)` | 169–173 | Listens for `{ type: 'BARCODE', value }` from `wrapper.html`; calls `handleScan(value)` |
| `scrollToAsset(assetNo)` | 175–188 | Smooth-scrolls to the card; flashes yellow highlight for 800ms |
| `handleScan(rawText)` | 190–243 | **Core scan logic** — see below |
| `processAssetCheck(asset, remark)` | 245–249 | Sets `syncStatus=1`, calls `syncAsset`, calls `resumeScanner` |
| `resumeScanner()` | 251–253 | Resets `isProcessing` after 1500ms delay |
| `syncAsset(asset, remark)` | 255–274 | Calls `google.script.run.updateAsset(assetNo, payload)` with success/failure handlers |
| `playBeep()` | 276–284 | 800Hz sine wave, 100ms duration via Web Audio API |

### 8.5 `handleScan(rawText)` — Detailed Flow

```
1. Set isProcessing = true
2. Split rawText on '|', take first part, trim → text
3. Store in lastScan
4. Play beep sound

5. IF text matches a location code in locationMap:
   → Set trackedLocation and selectedLocation
   → Resume scanner and return (no asset check)

6. Find asset by assetNo === text
   → IF not found: alert("Asset not found") → resume → return
   → Scroll to the asset card

7. IF asset already checked (syncStatus === 2):
   → Resume and return (skip duplicate)

8. IF no trackedLocation yet:
   → Auto-set trackedLocation = asset.location

9. IF user is filtering by location AND asset.location ≠ trackedLocation:
   → Show confirm() dialog:
     "OK" = user moved to new room → update trackedLocation → processAssetCheck
     "Cancel" = item is mislocated → add remark "Mislocated. Found in {trackedLocation}" → processAssetCheck

10. ELSE: processAssetCheck(asset) normally
```

### 8.6 Lifecycle

```js
mounted() {
  this.loadData();
  window.addEventListener("message", this.receiveMessage, false);
}
```

- Loads all data from the spreadsheet on mount
- Registers the `postMessage` listener for barcodes from `wrapper.html`
- **No polling or interval in the stable version** — data only updates on scan actions

---

## 9. Scanner Pop-up — `wrapper.html` (209 lines)

Served from: `https://jeons1qbs.github.io/qbs-scanner/wrapper.html`

### 9.1 Dependencies

```html
<script src="https://unpkg.com/html5-qrcode"></script>
```

### 9.2 Layout

```
┌─────────────────────────────────┐
│ #scan-indicator (floating)      │ ← "✓ Scanned" toast, fades in/out
├─────────────────────────────────┤
│ #reader-container               │
│ (height: calc(100% - 80px))     │
│ ┌─────────────────────────────┐ │
│ │ #reader                     │ │ ← html5-qrcode renders camera here
│ │ (full-screen camera feed)   │ │
│ └─────────────────────────────┘ │
├─────────────────────────────────┤
│ .bottom-bar (fixed, 80px)       │
│ [🛑 Done Scanning (Return)]    │ ← Stops camera, closes window
└─────────────────────────────────┘
```

- Black background, fullscreen camera
- Video is `object-fit: cover` for edge-to-edge display
- Bottom bar accounts for iPhone safe area: `padding-bottom: env(safe-area-inset-bottom)`

### 9.3 Scanner Configuration

```js
{
  fps: 10,
  qrbox: { width: 250, height: 250 },
  aspectRatio: window.innerWidth / (window.innerHeight - 80)
}
```

- Uses rear-facing camera: `{ facingMode: "environment" }`
- Starts immediately on `DOMContentLoaded`

### 9.4 Scan Success Flow

```
1. Check 2-second debounce (lastScanTime)
2. Play beep (800Hz, 100ms, with gain fade-out)
3. Show "✓ Scanned" indicator for 600ms
4. Post message to parent:
   window.opener.postMessage({ type: 'BARCODE', value: decodedText }, '*')
```

### 9.5 Close Button

```
1. Stop html5QrCode scanner
2. Call window.close()
3. (Falls back to window.close() even if stop fails)
```

---

## 10. User Flows

### 10.1 Single Asset Scan

```
User opens GAS web app → clicks "Open Web Scanner"
  → wrapper.html opens in new tab → camera starts
  → User points camera at barcode
  → Barcode detected → beep + visual indicator
  → postMessage sent to GAS tab
  → GAS receives message → handleScan() runs
  → Asset found → scrollToAsset + yellow flash
  → syncAsset() → server writes to Google Sheet
  → Card turns green (syncStatus = 2)
  → User scans next barcode (wrapper stays open)
  → When done: clicks "Done Scanning" → window closes
```

### 10.2 Location Tracking

```
User scans a LOCATION barcode (e.g. "RM201")
  → locationMap["RM201"] = "Room 201"
  → trackedLocation = "Room 201"
  → selectedLocation auto-changes to "Room 201"
  → All subsequent asset scans compare asset.location vs trackedLocation
  → If mismatch: confirm dialog (moved room? or mislocated item?)
```

### 10.3 Bulk Check

```
User clicks "☑️ Select" → enters bulk mode
  → Taps asset cards to select (unchecked only)
  → Clicks "Bulk Check (N Selected)"
  → All selected assets → syncStatus = 1 (processing)
  → Server: updateAssetsBulk() writes timestamp+username for all
  → On success: all → syncStatus = 2, exit bulk mode
```

### 10.4 Manual Check (No Scanner)

```
User taps an asset card → card expands
  → Clicks "Check" button
  → processAssetCheck → syncAsset → server write
  → Card turns green
```

### 10.5 Adding Remarks

```
User taps card → clicks "✏️ Edit"
  → Textarea appears → types remark → clicks "Submit"
  → Remark formatted as "username:text"
  → Appended to existing remarks with " | " separator
  → syncAsset() writes to server
```

---

## 11. Deployment Workflow

### Push to GAS

```bash
cd /Users/steve.home/Documents/AI_Programming/qbs-scanner
clasp push        # Pushes Code.js, Index.html, Scanner.html, appsscript.json
```

Files excluded by `.claspignore`: `*.md`, `wrapper.html`

### Push wrapper.html to GitHub Pages

```bash
git add wrapper.html
git commit -m "Update scanner wrapper"
git push origin main
```

GitHub Pages automatically serves from `main` branch at:
`https://jeons1qbs.github.io/qbs-scanner/wrapper.html`

### DEV vs Production URLs

| Type | URL Pattern |
|------|-------------|
| DEV (Head deployment) | `.../s/AKfycbz.../dev` |
| Production (Versioned) | `.../s/AKfycbz.../exec` |

**DEV** always reflects the latest `clasp push`. **Production** requires creating a new deployment in the GAS editor.

---

## 12. Security & Concurrency

| Concern | Current Approach |
|---------|------------------|
| **Authentication** | `Session.getActiveUser().getEmail()` extracts the signed-in user's email prefix. The webapp is accessible to anyone (`ANYONE_ANONYMOUS`), but writes are scoped to the deployer's permissions. |
| **Concurrency** | `LockService.getScriptLock()` prevents simultaneous writes to the same row. Single: 10s timeout. Bulk: 15s timeout. |
| **Cross-origin messaging** | `postMessage` uses wildcard origin (`'*'`). The receiver does not validate `event.origin`. |
| **Data integrity** | `SpreadsheetApp.flush()` is called after every write to force immediate persistence. |
| **Remarks** | Append-only with `" | "` separator — existing remarks are never overwritten. |

---

## 13. Known Limitations

1. **No real-time sync between users** — The stable version has no polling. If User A checks an asset, User B won't see it until they reload.
2. **No continuous scan toggle** — The wrapper always stays open (continuous scanning). There is no single-scan auto-close mode.
3. **`html5-qrcode` loaded unnecessarily** — `Index.html` loads the library via CDN even though it's only used in `wrapper.html`.
4. **No offline support** — Requires network connectivity for both the GAS page and the camera wrapper.
5. **postMessage security** — No origin validation on the receiving end.
6. **`hideChecked` data property exists** but is not exposed in the UI (no toggle for it).
7. **Confirm dialog blocks scanning** — The location mismatch `confirm()` is a blocking browser dialog.

---

## 14. File-by-File Line Count Summary

| File | Lines | Bytes | Role |
|------|-------|-------|------|
| `Code.js` | 205 | 7,754 | Server-side GAS logic |
| `Index.html` | 188 | 9,048 | HTML template + CSS |
| `Scanner.html` | 291 | 9,769 | Vue 3 app (data, computed, methods, lifecycle) |
| `wrapper.html` | 209 | 7,048 | Standalone camera scanner (GitHub Pages) |
| `appsscript.json` | 10 | 205 | GAS project manifest |
| `plan.md` | 44 | 3,249 | Original design spec |
| **Total** | **947** | **37,073** | |

---

## Appendix A — Full API Reference (Client → Server)

### `getInitialData()`

| | |
|---|---|
| **Called by** | `Scanner.html` → `loadData()` on `mounted()` |
| **Parameters** | None |
| **Returns** | `{ assets: Asset[], currentUser: string, locationMap: object, currentSheetName: string }` |
| **Can fail** | Yes — throws if target sheet not found |

### `updateAsset(assetNo, payload)`

| | |
|---|---|
| **Called by** | `Scanner.html` → `syncAsset()` |
| **Parameters** | `assetNo`: string, `payload`: `{ user: string, needTag?: boolean, remark?: string }` |
| **Returns** | `{ success: true, assetNo: string, timestamp: string }` or `{ success: false, error: string }` |
| **Lock** | Script lock, 10s timeout |

### `updateAssetsBulk(assetNos, payload)`

| | |
|---|---|
| **Called by** | `Scanner.html` → `bulkCheck()` |
| **Parameters** | `assetNos`: string[], `payload`: `{ user: string }` |
| **Returns** | `{ success: true, timestamp: string }` or `{ success: false, error: string }` |
| **Lock** | Script lock, 15s timeout |

---

## Appendix B — Asset Object Shape (Client-Side)

```js
{
  // From server (getInitialData)
  rowIdx: number,           // 1-based sheet row
  assetNo: string,          // Barcode value / asset identifier
  description: string,      // Human-readable name
  location: string,         // Location name (e.g. "Room 201")
  tag: string,              // Physical tag label
  staffNo: string,          // Assigned staff number
  timestamp: string,        // Check timestamp (empty if unchecked)
  username: string,         // Who checked it (empty if unchecked)
  needTag: boolean,         // Whether a new tag is needed
  remarks: string,          // Pipe-delimited notes
  syncStatus: number,       // 0=unchecked, 1=processing, 2=checked

  // Added client-side in loadData()
  expanded: boolean,        // Card is expanded to show actions
  editingRemark: boolean,   // Remark textarea is visible
  newRemark: string         // Text in the remark textarea
}
```

---

**End of Specification**
