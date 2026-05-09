import { NextRequest, NextResponse } from 'next/server';
import { syncPendingChanges } from '@/lib/sync-service';
import { isLocalOnlyMode } from '@/lib/runtime-mode-server';

/**
 * 手動觸發同步
 * GET /api/sync
 */
export async function GET(request: NextRequest) {
  if (await isLocalOnlyMode()) {
    return NextResponse.json({
      success: true,
      synced: 0,
      failed: 0,
      localOnly: true,
    });
  }

  try {
    const result = await syncPendingChanges();

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        message: error.message || '同步失敗',
      },
      { status: 500 }
    );
  }
}
