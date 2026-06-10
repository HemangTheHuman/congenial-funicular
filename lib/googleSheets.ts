import { google } from 'googleapis'

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function getAuthClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY

  if (!email || !key) {
    throw new Error(
      'Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY env vars'
    )
  }

  return new google.auth.GoogleAuth({
    credentials: {
      client_email: email,
      // Vercel/dotenv may escape newlines — unescape them here
      private_key: key.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
}

function getSheetsClient() {
  const auth = getAuthClient()
  return google.sheets({ version: 'v4', auth })
}

function getSheetId(): string {
  const id = process.env.GOOGLE_SHEET_ID
  if (!id) throw new Error('Missing GOOGLE_SHEET_ID env var')
  return id
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Reads all rows from a named sheet tab.
 * Returns raw 2-D array of strings (row 0 = headers).
 */
export async function readSheet(sheetName: string): Promise<string[][]> {
  const sheets = getSheetsClient()
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: getSheetId(),
    range: sheetName,
  })
  return (res.data.values as string[][]) ?? []
}

/**
 * Reads rows and returns them as an array of objects keyed by the header row.
 */
export async function readSheetAsObjects(
  sheetName: string
): Promise<Record<string, string>[]> {
  const rows = await readSheet(sheetName)
  if (rows.length < 2) return []
  const [headers, ...dataRows] = rows
  return dataRows.map((row) =>
    Object.fromEntries(headers.map((h, i) => [h, row[i] ?? '']))
  )
}

/**
 * Appends a single row to a named sheet tab.
 * `values` must be in the same column order as the sheet headers.
 */
export async function appendRow(
  sheetName: string,
  values: (string | number | boolean)[]
): Promise<void> {
  const sheets = getSheetsClient()
  await sheets.spreadsheets.values.append({
    spreadsheetId: getSheetId(),
    range: sheetName,
    valueInputOption: 'RAW',
    requestBody: { values: [values] },
  })
}

/**
 * Updates a specific row (1-indexed, where row 1 = headers).
 * `rowNumber` = 2 means the first data row.
 */
export async function updateRow(
  sheetName: string,
  rowNumber: number,
  values: (string | number | boolean)[]
): Promise<void> {
  const sheets = getSheetsClient()
  await sheets.spreadsheets.values.update({
    spreadsheetId: getSheetId(),
    range: `${sheetName}!A${rowNumber}`,
    valueInputOption: 'RAW',
    requestBody: { values: [values] },
  })
}

/**
 * Finds the first row where `column` header matches `value`.
 * Returns `{ row, rowNumber }` or null if not found.
 * `rowNumber` is 1-indexed (row 1 = headers, row 2 = first data row).
 */
export async function findRowByColumn(
  sheetName: string,
  column: string,
  value: string
): Promise<{ row: Record<string, string>; rowNumber: number } | null> {
  const rows = await readSheet(sheetName)
  if (rows.length < 2) return null
  const [headers, ...dataRows] = rows
  const colIndex = headers.indexOf(column)
  if (colIndex === -1) return null

  for (let i = 0; i < dataRows.length; i++) {
    if (dataRows[i][colIndex] === value) {
      return {
        row: Object.fromEntries(headers.map((h, j) => [h, dataRows[i][j] ?? ''])),
        rowNumber: i + 2, // +1 for header row, +1 for 1-based indexing
      }
    }
  }
  return null
}

/**
 * Lightweight connection test — reads the app_config sheet and returns one cell.
 * Returns true if the sheet is reachable.
 */
export async function testConnection(): Promise<boolean> {
  try {
    await readSheet('app_config')
    return true
  } catch {
    return false
  }
}
