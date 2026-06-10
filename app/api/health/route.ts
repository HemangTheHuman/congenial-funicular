import { testConnection as testSheets } from '@/lib/googleSheets'
import { testConnection as testLS } from '@/lib/labelStudio'

export const dynamic = 'force-dynamic'

export async function GET() {
  const [sheets, labelStudio] = await Promise.allSettled([
    testSheets(),
    testLS(),
  ])

  const result = {
    sheets: sheets.status === 'fulfilled' && sheets.value ? 'ok' : 'error',
    labelStudio:
      labelStudio.status === 'fulfilled' && labelStudio.value ? 'ok' : 'error',
    sheetsError:
      sheets.status === 'rejected' ? (sheets.reason as Error).message : undefined,
    labelStudioError:
      labelStudio.status === 'rejected'
        ? (labelStudio.reason as Error).message
        : undefined,
    timestamp: new Date().toISOString(),
  }

  const allOk = result.sheets === 'ok' && result.labelStudio === 'ok'
  return Response.json(result, { status: allOk ? 200 : 503 })
}
