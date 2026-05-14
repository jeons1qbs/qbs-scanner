# Project Specification: Hybrid GAS + GitHub Pages Barcode Scanner

## 1. Context
We are building a barcode scanner for warehouse staff. The backend and UI are hosted on Google Apps Script (GAS). However, because GAS wraps HTML in strict iframes, mobile browsers block the camera feed. 
To bypass this, we are using a "Pop-Up Handoff" architecture. The GAS app will open a GitHub Pages-hosted HTML file (`wrapper.html`) in a new tab. This wrapper will access the camera, run continuously, and use `window.opener.postMessage()` to send scanned barcodes back to the GAS app.

## 2. Current File Structure (Already in Workspace)
- `Code.gs`: Handles Google Sheets backend logic. **(DO NOT MODIFY)**
- `Index.html`: The main UI (Vue.js template).
- `Scanner.html`: The Vue.js application logic.
- `wrapper.html`: A new blank file that will be hosted on GitHub Pages.

## 3. Tasks to Execute

### Task A: Build `wrapper.html` (The GitHub Pages App)
Create a standalone, mobile-optimized HTML file with the following requirements:
1. Include the `html5-qrcode` library via CDN.
2. Build a full-screen UI with a camera viewport and a large, fixed "🛑 Done Scanning (Return to App)" button at the bottom.
3. On load, immediately start the rear-facing camera.
4. **Continuous Scanning Logic:** - When a barcode is detected, send it to the parent window using `window.opener.postMessage({ type: 'BARCODE', value: decodedText }, '*');`.
   - Add a 2-second debounce/throttle after a successful scan so it doesn't send the same barcode 50 times in a row. Play a short beep sound on scan.
5. **Close Logic:** When the "Done Scanning" button is clicked, stop the camera and execute `window.close()` to drop the user back to the GAS tab.

### Task B: Modify `Index.html` (GAS UI)
1. Remove the "📷 Web Cam" and "🛑 Stop" buttons, as well as the Continuous and Hide Done toggles. 
2. Replace them with a single, prominent button: "📷 Open Web Scanner".
3. Remove the `<div id="reader"></div>` block entirely, as the camera feed no longer lives inside the GAS app.

### Task C: Modify `Scanner.html` (Vue Logic)
1. Remove all `html5-qrcode` initialization, start, and stop logic from the Vue methods. 
2. Change the "Open Web Scanner" button method to open the new tab: `window.open('https://[YOUR-GITHUB-USERNAME].github.io/qbs-scanner/wrapper.html', '_blank');` *(Leave a placeholder for the URL).*
3. Add a global message listener in the Vue `mounted()` hook:
   `window.addEventListener("message", this.receiveMessage, false);`
4. Create the `receiveMessage(event)` method. It should:
   - Check if `event.data.type === 'BARCODE'`.
   - If true, extract `event.data.value` and pass it directly into the existing `this.handleScan()` method.
   - Do NOT close the window from GAS (the wrapper handles its own closing).

## 4. Technical Constraints
- Do not alter the Google Apps Script `doGet` or `updateAsset` functions in `Code.gs`.
- Ensure Vue.js reactivity is maintained when `receiveMessage` calls `handleScan`.
- The `handleScan` logic (splitting by `|`, tracking locations, and auto-scrolling) must remain exactly as it currently is.

Please generate the updated code for `Index.html` and `Scanner.html`, and write the complete `wrapper.html` file.