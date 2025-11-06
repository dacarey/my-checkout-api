import axios, { AxiosInstance, AxiosResponse, AxiosError } from 'axios';
import { ApiConfig, ApiResponse } from './types';

export class CheckoutApiClient {
  private client: AxiosInstance;
  private verbose: boolean;

  constructor(config: ApiConfig, options: { timeout?: number; verbose?: boolean } = {}) {
    this.verbose = options.verbose || false;

    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: options.timeout || 10000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    // Request interceptor for logging
    this.client.interceptors.request.use(
      (request) => {
        if (this.verbose) {
          console.log(`🔄 ${request.method?.toUpperCase()} ${request.url}`);
          if (request.data) {
            console.log('📤 Request body:', JSON.stringify(request.data, null, 2));
          }
          if (request.headers) {
            const headers = { ...request.headers };
            // Hide sensitive headers in logs
            if (headers['Authorization']) {
              headers['Authorization'] = '[REDACTED]';
            }
            console.log('📋 Request headers:', JSON.stringify(headers, null, 2));
          }
        }
        return request;
      },
      (error) => {
        console.error('❌ Request error:', error.message);
        return Promise.reject(error);
      }
    );

    // Response interceptor for logging
    this.client.interceptors.response.use(
      (response) => {
        if (this.verbose) {
          console.log(`✅ ${response.status} ${response.statusText}`);
          console.log('📥 Response body:', JSON.stringify(response.data, null, 2));
        }
        return response;
      },
      (error) => {
        if (this.verbose && error.response) {
          console.log(`❌ ${error.response.status} ${error.response.statusText}`);
          console.log('📥 Error response:', JSON.stringify(error.response.data, null, 2));
        }
        return Promise.reject(error);
      }
    );
  }

  async post<T = any>(
    endpoint: string,
    data: any,
    headers: Record<string, string> = {}
  ): Promise<ApiResponse<T>> {
    try {
      const response: AxiosResponse<T> = await this.client.post(endpoint, data, {
        headers: {
          ...headers,
          // Add idempotency key for POST requests
          'Idempotency-Key': headers['Idempotency-Key'] || `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        }
      });

      return {
        statusCode: response.status,
        data: response.data,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;

        return {
          statusCode: axiosError.response?.status || 0,
          data: axiosError.response?.data as T,
          error: this.formatError(axiosError),
          timestamp: new Date().toISOString()
        };
      }

      return {
        statusCode: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      };
    }
  }

  async options(endpoint: string): Promise<ApiResponse> {
    try {
      const response = await this.client.options(endpoint);

      return {
        statusCode: response.status,
        data: {
          headers: response.headers,
          corsEnabled: !!response.headers['access-control-allow-origin']
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;

        return {
          statusCode: axiosError.response?.status || 0,
          data: axiosError.response?.data,
          error: this.formatError(axiosError),
          timestamp: new Date().toISOString()
        };
      }

      return {
        statusCode: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      };
    }
  }

  private formatError(error: AxiosError): string {
    const status = error.response?.status;
    const statusText = error.response?.statusText;
    const message = error.message;

    if (status && statusText) {
      return `HTTP ${status} ${statusText}: ${message}`;
    }

    if (error.code === 'ECONNABORTED') {
      return 'Request timeout';
    }

    if (error.code === 'ECONNREFUSED') {
      return 'Connection refused - API may be unavailable';
    }

    return message || 'Unknown error';
  }

  setVerbose(verbose: boolean): void {
    this.verbose = verbose;
  }

  setTimeout(timeout: number): void {
    this.client.defaults.timeout = timeout;
  }
}
