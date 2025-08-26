import axios, { AxiosInstance, AxiosResponse } from 'axios';
import qs from 'qs';
import {
  Sequence,
  SequenceAnnotation,
  DetectionAnnotation,
  Detection,
  Camera,
  Organization,
  SourceApi,
  User,
  UserCreate,
  UserUpdate,
  UserPasswordUpdate,
  LoginRequest,
  LoginResponse,
  UserFilters,
  PaginatedResponse,
  SequenceFilters,
  ExtendedSequenceFilters,
  SequenceWithAnnotation,
  SequenceAnnotationFilters,
  DetectionAnnotationFilters,
  ApiError
} from '@/types/api';
import { API_ENDPOINTS } from '@/utils/constants';

class ApiClient {
  private client: AxiosInstance;

  constructor(baseURL: string = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5050') {
    this.client = axios.create({
      baseURL: `${baseURL}/api/v1`,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 30000,
      paramsSerializer: (params) => {
        return qs.stringify(params, {
          arrayFormat: 'repeat',  // Convert arrays to repeated params: ?false_positive_types=antenna&false_positive_types=building
          skipNulls: true         // Skip null/undefined values
        });
      },
    });

    // Request interceptor to add authentication token
    this.client.interceptors.request.use(
      (config) => {
        // Get token from localStorage (where zustand persists it)
        const authStore = localStorage.getItem('auth-store');
        if (authStore) {
          try {
            const parsedStore = JSON.parse(authStore);
            const token = parsedStore.state?.token;
            if (token) {
              config.headers.Authorization = `Bearer ${token}`;
            }
          } catch (error) {
            // Ignore parsing errors
          }
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        // Handle 401 errors by triggering logout
        if (error.response?.status === 401) {
          // Clear auth store and redirect to login
          localStorage.removeItem('auth-store');
          window.location.href = '/login';
        }

        const apiError: ApiError = {
          detail: error.response?.data?.detail || error.message || 'Unknown error occurred',
        };
        return Promise.reject(apiError);
      }
    );
  }

  // Sequences
  async getSequences(filters: SequenceFilters = {}): Promise<PaginatedResponse<Sequence>> {
    const response: AxiosResponse<PaginatedResponse<Sequence>> = await this.client.get(API_ENDPOINTS.SEQUENCES, {
      params: filters,
    });
    return response.data;
  }

  async getSequence(id: number): Promise<Sequence> {
    const response: AxiosResponse<Sequence> = await this.client.get(`/sequences/${id}`);
    return response.data;
  }

  async getSequenceDetections(id: number): Promise<Detection[]> {
    // Fetch all detections for a sequence, handling pagination
    const allDetections: Detection[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await this.getDetections({
        sequence_id: id,
        order_by: 'recorded_at',
        order_direction: 'asc',
        page: page,
        size: 100 // Max allowed by backend
      });

      allDetections.push(...response.items);

      // Check if we've fetched all pages
      hasMore = page < response.pages;
      page++;
    }

    return allDetections;
  }

  async createSequence(sequence: Omit<Sequence, 'id' | 'created_at' | 'updated_at'>): Promise<Sequence> {
    const response: AxiosResponse<Sequence> = await this.client.post(API_ENDPOINTS.SEQUENCES, sequence);
    return response.data;
  }

  async deleteSequence(id: number): Promise<void> {
    await this.client.delete(`/sequences/${id}`);
  }

  // Enhanced method to get sequences with annotations
  async getSequencesWithAnnotations(filters: ExtendedSequenceFilters = {}): Promise<PaginatedResponse<SequenceWithAnnotation>> {
    const enhancedFilters = {
      ...filters,
      include_annotation: true, // Always include annotation data
    };

    const response: AxiosResponse<PaginatedResponse<SequenceWithAnnotation>> = await this.client.get(API_ENDPOINTS.SEQUENCES, {
      params: enhancedFilters,
    });
    return response.data;
  }

  // Cameras
  async getCameras(): Promise<Camera[]> {
    const response: AxiosResponse<Camera[]> = await this.client.get(API_ENDPOINTS.CAMERAS);
    return response.data;
  }

  // Organizations
  async getOrganizations(): Promise<Organization[]> {
    const response: AxiosResponse<Organization[]> = await this.client.get(API_ENDPOINTS.ORGANIZATIONS);
    return response.data;
  }

  // Source APIs
  async getSourceApis(): Promise<SourceApi[]> {
    const response: AxiosResponse<SourceApi[]> = await this.client.get(API_ENDPOINTS.SOURCE_APIS);
    return response.data;
  }

  // Sequence Annotations
  async getSequenceAnnotations(filters: SequenceAnnotationFilters = {}): Promise<PaginatedResponse<SequenceAnnotation>> {
    const response: AxiosResponse<PaginatedResponse<SequenceAnnotation>> = await this.client.get(API_ENDPOINTS.SEQUENCE_ANNOTATIONS, {
      params: filters,
    });
    return response.data;
  }

  async getSequenceAnnotation(id: number): Promise<SequenceAnnotation> {
    const response: AxiosResponse<SequenceAnnotation> = await this.client.get(`/annotations/sequences/${id}`);
    return response.data;
  }

  async createSequenceAnnotation(annotation: Omit<SequenceAnnotation, 'id' | 'created_at' | 'updated_at'>): Promise<SequenceAnnotation> {
    const response: AxiosResponse<SequenceAnnotation> = await this.client.post(API_ENDPOINTS.SEQUENCE_ANNOTATIONS, annotation);
    return response.data;
  }

  async updateSequenceAnnotation(id: number, updates: Partial<SequenceAnnotation>): Promise<SequenceAnnotation> {
    const response: AxiosResponse<SequenceAnnotation> = await this.client.patch(`/annotations/sequences/${id}`, updates);
    return response.data;
  }

  async deleteSequenceAnnotation(id: number): Promise<void> {
    await this.client.delete(`/annotations/sequences/${id}`);
  }


  // Detections
  async getDetections(filters: { sequence_id?: number; order_by?: 'created_at' | 'recorded_at'; order_direction?: 'asc' | 'desc'; page?: number; size?: number } = {}): Promise<PaginatedResponse<Detection>> {
    const response: AxiosResponse<PaginatedResponse<Detection>> = await this.client.get(API_ENDPOINTS.DETECTIONS, {
      params: filters,
    });
    return response.data;
  }

  async getDetection(id: number): Promise<Detection> {
    const response: AxiosResponse<Detection> = await this.client.get(`/detections/${id}`);
    return response.data;
  }

  async getDetectionImageUrl(id: number): Promise<{ url: string }> {
    const response = await this.client.get(`/detections/${id}/url`);
    return response.data;
  }

  // Detection Annotations (for future use)
  async getDetectionAnnotations(filters: DetectionAnnotationFilters = {}): Promise<PaginatedResponse<DetectionAnnotation>> {
    const response: AxiosResponse<PaginatedResponse<DetectionAnnotation>> = await this.client.get(API_ENDPOINTS.DETECTION_ANNOTATIONS, {
      params: filters,
    });
    return response.data;
  }

  async getDetectionAnnotation(id: number): Promise<DetectionAnnotation> {
    const response: AxiosResponse<DetectionAnnotation> = await this.client.get(`/annotations/detections/${id}`);
    return response.data;
  }

  async createDetectionAnnotation(annotation: Omit<DetectionAnnotation, 'id' | 'created_at' | 'updated_at'>): Promise<DetectionAnnotation> {
    // Backend expects form data, not JSON
    const formData = new FormData();
    formData.append('detection_id', annotation.detection_id.toString());
    formData.append('annotation', JSON.stringify(annotation.annotation));
    formData.append('processing_stage', annotation.processing_stage);

    const response: AxiosResponse<DetectionAnnotation> = await this.client.post(API_ENDPOINTS.DETECTION_ANNOTATIONS, formData, {
      headers: {
        // Remove Content-Type to let browser set multipart/form-data with boundary
        'Content-Type': undefined,
      },
    });
    return response.data;
  }

  async updateDetectionAnnotation(id: number, updates: Partial<DetectionAnnotation>): Promise<DetectionAnnotation> {
    const response: AxiosResponse<DetectionAnnotation> = await this.client.patch(`/annotations/detections/${id}`, updates);
    return response.data;
  }

  async deleteDetectionAnnotation(id: number): Promise<void> {
    await this.client.delete(`/annotations/detections/${id}`);
  }

  // Authentication
  async login(credentials: LoginRequest): Promise<LoginResponse> {
    const response: AxiosResponse<LoginResponse> = await this.client.post(API_ENDPOINTS.AUTH_LOGIN, credentials);
    return response.data;
  }

  async getCurrentUser(): Promise<User> {
    // Get current user info using the /users/me endpoint
    const response: AxiosResponse<User> = await this.client.get(API_ENDPOINTS.USERS_ME);
    return response.data;
  }

  // Users
  async getUsers(filters: UserFilters = {}): Promise<PaginatedResponse<User>> {
    const response: AxiosResponse<PaginatedResponse<User>> = await this.client.get(API_ENDPOINTS.USERS, {
      params: filters,
    });
    return response.data;
  }

  async getUser(id: number): Promise<User> {
    const response: AxiosResponse<User> = await this.client.get(`/users/${id}`);
    return response.data;
  }

  async createUser(user: UserCreate): Promise<User> {
    const response: AxiosResponse<User> = await this.client.post(API_ENDPOINTS.USERS, user);
    return response.data;
  }

  async updateUser(id: number, updates: UserUpdate): Promise<User> {
    const response: AxiosResponse<User> = await this.client.patch(`/users/${id}`, updates);
    return response.data;
  }

  async updateUserPassword(id: number, passwordUpdate: UserPasswordUpdate): Promise<User> {
    const response: AxiosResponse<User> = await this.client.patch(`/users/${id}/password`, passwordUpdate);
    return response.data;
  }

  async deleteUser(id: number): Promise<void> {
    await this.client.delete(`/users/${id}`);
  }

  // Health check
  async healthCheck(): Promise<{ status: string }> {
    // Note: health check is at /status, not in /api/v1
    const response = await axios.get(`${this.client.defaults.baseURL?.replace('/api/v1', '')}${API_ENDPOINTS.STATUS}`);
    return response.data;
  }
}

// Export a singleton instance
export const apiClient = new ApiClient();
export default apiClient;
