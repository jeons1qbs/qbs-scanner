// ==========================================
// 1. WEB APP SETUP & TEMPLATING
// ==========================================
function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
      .evaluate()
      .setTitle('QBS Asset Scanner')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL).getContent();
}

// ==========================================
// 2. CONFIGURATION HELPER
// ==========================================
function getConfig_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const configSheet = ss.getSheetByName("Config");
  let targetSheetName = "Audit 11May2026"; 
  
  if (configSheet) {
    const data = configSheet.getDataRange().getValues();
    for (let i = 0; i < data.length; i++) {
      if (data[i][0].toString().trim() === "CurrentAuditSheet") {
        targetSheetName = data[i][1].toString().trim();
        break;
      }
    }
  }
  return targetSheetName;
}

// ==========================================
// 3. DATA FETCHING (INITIAL LOAD)
// ==========================================
function getInitialData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const targetSheetName = getConfig_();
  const dataSheet = ss.getSheetByName(targetSheetName);
  
  if (!dataSheet) throw new Error(`Target sheet '${targetSheetName}' not found. Please check your Config sheet.`);
  const data = dataSheet.getDataRange().getValues();
  const headers = data[0];
  const colMap = getColumnMap_(headers);
  
  let assets = [];
  for (let i = 1; i < data.length; i++) {
    let row = data[i];
    if (!row[colMap.assetNo]) continue;
    assets.push({
      rowIdx: i + 1, 
      assetNo: row[colMap.assetNo].toString().trim(),
      description: row[colMap.desc] ? row[colMap.desc].toString() : '',
      location: row[colMap.location] ? row[colMap.location].toString().trim() : 'Unknown',
      tag: row[colMap.tag] ? row[colMap.tag].toString().trim() : '',
      staffNo: row[colMap.staffNo] ? row[colMap.staffNo].toString().trim() : '',
      timestamp: row[colMap.timestamp] ? row[colMap.timestamp].toString() : '',
      username: row[colMap.username] ? row[colMap.username].toString() : '',
      needTag: row[colMap.needTag] ? true : false,
      
      remarks: row[colMap.remarks] ? row[colMap.remarks].toString() : '',
      syncStatus: row[colMap.timestamp] ? 2 : 0
    });
  }
  
  return {
    assets: assets,
    currentUser: Session.getActiveUser().getEmail().split('@')[0] ||
    'User',
    locationMap: getLocationMap_(),
    currentSheetName: targetSheetName
  };
}

// ==========================================
// 4. ASSET UPDATING WITH CONCURRENCY LOCK
// ==========================================
function updateAsset(assetNo, payload) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000); 
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const dataSheet = ss.getSheetByName(getConfig_());
    if (!dataSheet) throw new Error("Target sheet not found.");

    const headers = dataSheet.getRange(1, 1, 1, dataSheet.getLastColumn()).getValues()[0];
    const colMap = getColumnMap_(headers);
    const assetColData = dataSheet.getRange(1, colMap.assetNo + 1, dataSheet.getLastRow(), 1).getValues();
    let targetRow = -1;
    for (let i = 1; i < assetColData.length; i++) {
      if (assetColData[i][0].toString().trim() === assetNo) {
        targetRow = i + 1;
        break;
      }
    }
    
    if (targetRow === -1) throw new Error("Asset not found in sheet.");
    const now = new Date();
    const timestampStr = now.toLocaleString('en-GB'); 
    
    dataSheet.getRange(targetRow, colMap.timestamp + 1).setValue(timestampStr);
    dataSheet.getRange(targetRow, colMap.username + 1).setValue(payload.user);
    if (payload.needTag !== undefined) {
      dataSheet.getRange(targetRow, colMap.needTag + 1).setValue(payload.needTag ? "Yes" : "");
    }
    
    if (payload.remark) {
      let currentRemark = dataSheet.getRange(targetRow, colMap.remarks + 1).getValue();
      let newRemark = currentRemark ? currentRemark + " | " + payload.remark : payload.remark;
      dataSheet.getRange(targetRow, colMap.remarks + 1).setValue(newRemark);
    }
    
    SpreadsheetApp.flush(); 
    return { success: true, assetNo: assetNo, timestamp: timestampStr };
  } catch (e) {
    return { success: false, error: e.toString() };
  } finally {
    lock.releaseLock();
  }
}

// ==========================================
// 5. BULK ASSET UPDATING 
// ==========================================
function updateAssetsBulk(assetNos, payload) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000); 
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const dataSheet = ss.getSheetByName(getConfig_());
    if (!dataSheet) throw new Error("Target sheet not found.");

    const headers = dataSheet.getRange(1, 1, 1, dataSheet.getLastColumn()).getValues()[0];
    const colMap = getColumnMap_(headers);
    const assetColData = dataSheet.getRange(1, colMap.assetNo + 1, dataSheet.getLastRow(), 1).getValues();
    
    const now = new Date();
    const timestampStr = now.toLocaleString('en-GB');
    // Find all rows matching the bulk array
    let rowsToUpdate = [];
    for (let i = 1; i < assetColData.length; i++) {
      if (assetNos.includes(assetColData[i][0].toString().trim())) {
        rowsToUpdate.push(i + 1);
      }
    }

    // Write data to all found rows
    rowsToUpdate.forEach(row => {
       dataSheet.getRange(row, colMap.timestamp + 1).setValue(timestampStr);
       dataSheet.getRange(row, colMap.username + 1).setValue(payload.user);
    });
    SpreadsheetApp.flush(); 
    return { success: true, timestamp: timestampStr };
    
  } catch (e) {
    return { success: false, error: e.toString() };
  } finally {
    lock.releaseLock();
  }
}

// ==========================================
// UTILITY FUNCTIONS
// ==========================================
function getColumnMap_(headers) {
  let map = { assetNo: 0, desc: 1, location: 3, tag: 4, staffNo: 5, timestamp: 6, username: 7, needTag: 8, remarks: 9 };
  headers.forEach((h, index) => {
    let header = h.toString().toLowerCase().trim();
    if (header.includes("asset no")) map.assetNo = index;
    if (header.includes("description")) map.desc = index;
    if (header.includes("location")) map.location = index;
    if (header === "tag") map.tag = index; 
    if (header.includes("staff no")) map.staffNo = index;
    if (header.includes("timestamp")) map.timestamp = index;
    if (header.includes("username")) map.username = index;
    if (header.includes("need tag")) map.needTag = index;
    if (header.includes("remarks")) map.remarks = index;
  });
  return map;
}

function getLocationMap_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const locSheet = ss.getSheetByName("Locations") || ss.getSheetByName("locations");
  let dict = {};
  if (!locSheet) return dict; 
  const data = locSheet.getDataRange().getValues();
  if (data.length < 2) return dict; 
  
  const headers = data[0];
  let locNameCol = 3, locCodeCol = 4; 
  for (let i = 0; i < headers.length; i++) {
    let header = headers[i].toString().toLowerCase().trim();
    if (header === 'location') locNameCol = i;
    if (header === 'loc_code' || header === 'loc code') locCodeCol = i;
  }
  for (let i = 1; i < data.length; i++) {
    let locName = data[i][locNameCol];
    let locCode = data[i][locCodeCol];
    if (locCode !== undefined && locCode !== "") dict[locCode.toString().trim()] = locName.toString().trim();
  }
  return dict;
}