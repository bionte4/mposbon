import { ApiError, isOfflineError } from './errors';

type ParsedApiError = {
  status: number;
  title: string;
  message: string;
};

export function parseApiError(error: unknown): ParsedApiError {
  if (isOfflineError(error) || (error instanceof ApiError && error.status === 0)) {
    return {
      status: 0,
      title: 'Koneksi terputus',
      message: 'Periksa jaringan. Data lokal tetap aman di perangkat.',
    };
  }

  if (error instanceof ApiError) {
    let message = error.message;
    let code: string | undefined;
    try {
      const json = JSON.parse(error.message) as {
        message?: string | string[];
        error?: string;
        code?: string;
      };
      code = json.code;
      if (Array.isArray(json.message)) {
        message = json.message.join(', ');
      } else if (typeof json.message === 'string') {
        message = json.message;
      } else if (json.error) {
        message = json.error;
      }
    } catch {
      // plain text body
    }
    return {
      status: error.status,
      title:
        code === 'STOCK_CONFLICT'
          ? 'Konflik stok'
          : error.status >= 500
            ? 'Kesalahan server'
            : 'Permintaan gagal',
      message,
    };
  }

  if (error instanceof Error) {
    return { status: 500, title: 'Kesalahan', message: error.message };
  }

  return { status: 500, title: 'Kesalahan', message: String(error) };
}
