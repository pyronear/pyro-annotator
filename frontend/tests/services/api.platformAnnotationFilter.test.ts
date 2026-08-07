import { describe, it, expect, beforeEach } from 'vitest';
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { apiClient } from '@/services/api';

// The alert-platform annotation filter is the one filter whose "no value from
// the platform" choice is a real value (Unclassified). It has to survive
// query-string encoding, where the client's paramsSerializer drops nulls — so
// these tests assert on the serialized URL, not on the params object.

// The axios instance is private to ApiClient; reach it to swap in a capturing
// adapter, which is the only way to see the post-serialization URL.
const axiosInstance = (apiClient as unknown as { client: AxiosInstance }).client;

let requestedUrls: string[] = [];

beforeEach(() => {
  requestedUrls = [];
  axiosInstance.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    requestedUrls.push(axiosInstance.getUri(config));
    return {
      data: { items: [], page: 1, pages: 0, size: 50, total: 0 },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    };
  };
});

const lastUrl = () => requestedUrls[requestedUrls.length - 1];

describe('is_wildfire_alertapi on the wire', () => {
  it('sends the Unclassified choice as the literal "null" the API expects', async () => {
    await apiClient.getClassifyDone({ is_wildfire_alertapi: null });
    expect(lastUrl()).toContain('is_wildfire_alertapi=null');
  });

  it('sends a concrete platform annotation unchanged', async () => {
    await apiClient.getClassifyDone({ is_wildfire_alertapi: 'wildfire_smoke' });
    expect(lastUrl()).toContain('is_wildfire_alertapi=wildfire_smoke');
  });

  it('omits the param entirely when the filter is unset', async () => {
    await apiClient.getClassifyDone({ camera_name: 'CAM_01' });
    expect(lastUrl()).not.toContain('is_wildfire_alertapi');
  });

  it('sends the filter on the classify queue', async () => {
    await apiClient.getClassifyQueue({ is_wildfire_alertapi: 'other' });
    expect(lastUrl()).toContain('is_wildfire_alertapi=other');
    await apiClient.getClassifyQueue({ is_wildfire_alertapi: null });
    expect(lastUrl()).toContain('is_wildfire_alertapi=null');
  });

  it('sends the filter on the localize-done queue', async () => {
    await apiClient.getLocalizeDoneQueue({ is_wildfire_alertapi: 'other_smoke' });
    expect(lastUrl()).toContain('is_wildfire_alertapi=other_smoke');
    await apiClient.getLocalizeDoneQueue({ is_wildfire_alertapi: null });
    expect(lastUrl()).toContain('is_wildfire_alertapi=null');
  });
});
