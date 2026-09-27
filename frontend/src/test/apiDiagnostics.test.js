import { it, expect, vi } from 'vitest';
import { reportApiFailure } from '../services/apiDiagnostics';

it('distinguishes network/CORS, timeout, authorization and backend failure without logging secrets', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const privateData = { config: { data: { password: 'private-password' }, headers: { Authorization: 'Bearer private-token' } },
      message: 'private exception', response: { data: { detail: 'private database error' } } };
    for (const status of [undefined, 401, 403, 422, 500, 503]) {
      reportApiFailure({ ...privateData, response: { ...privateData.response, status } });
    }
    reportApiFailure({ ...privateData, code: 'ECONNABORTED' });
    expect(warn.mock.calls.map(([, details]) => details.category)).toEqual([
      'network_or_cors', 'authorization', 'authorization', 'request_rejected', 'server', 'service_unavailable', 'timeout',
    ]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private');
  } finally { warn.mockRestore(); }
});
