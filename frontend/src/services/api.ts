import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { 
  Sequence, 
  SequenceAnnotation, 
  DetectionAnnotation,
  Detection,
  Camera,
  Organization,
  PaginatedResponse,
  SequenceFilters,
  ExtendedSequenceFilters,
  SequenceWithAnnotation,
  SequenceAnnotationFilters,
  DetectionAnnotationFilters,
  GifUrlsResponse,
  ApiError
} from '@/types/api';

class ApiClient {
  private client: AxiosInstance;

  constructor(baseURL: string = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5050') {
    this.client = axios.create({
      baseURL: `${baseURL}/api/v1`,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    // Request interceptor
    this.client.interceptors.request.use(
      (config) => {
        console.log(`Making ${config.method?.toUpperCase()} request to ${config.url}`);
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        const apiError: ApiError = {
          detail: error.response?.data?.detail || error.message || 'Unknown error occurred',
        };
        return Promise.reject(apiError);
      }
    );
  }

  // Sequences
  async getSequences(filters: SequenceFilters = {}): Promise<PaginatedResponse<Sequence>> {
    const response: AxiosResponse<PaginatedResponse<Sequence>> = await this.client.get('/sequences', {
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
    const response: AxiosResponse<Sequence> = await this.client.post('/sequences', sequence);
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
    
    // Debug logging for date range filters
    if (enhancedFilters.recorded_at_gte || enhancedFilters.recorded_at_lte) {
      console.log('Date range filter parameters:', {
        recorded_at_gte: enhancedFilters.recorded_at_gte,
        recorded_at_lte: enhancedFilters.recorded_at_lte
      });
    }
    
    const response: AxiosResponse<PaginatedResponse<SequenceWithAnnotation>> = await this.client.get('/sequences', {
      params: enhancedFilters,
    });
    return response.data;
  }

  // Cameras
  async getCameras(): Promise<Camera[]> {
    const response: AxiosResponse<Camera[]> = await this.client.get('/cameras');
    return response.data;
  }

  // Organizations
  async getOrganizations(): Promise<Organization[]> {
    const response: AxiosResponse<Organization[]> = await this.client.get('/organizations');
    return response.data;
  }

  // Sequence Annotations
  async getSequenceAnnotations(filters: SequenceAnnotationFilters = {}): Promise<PaginatedResponse<SequenceAnnotation>> {
    const response: AxiosResponse<PaginatedResponse<SequenceAnnotation>> = await this.client.get('/annotations/sequences', {
      params: filters,
    });
    return response.data;
  }

  async getSequenceAnnotation(id: number): Promise<SequenceAnnotation> {
    const response: AxiosResponse<SequenceAnnotation> = await this.client.get(`/annotations/sequences/${id}`);
    return response.data;
  }

  async createSequenceAnnotation(annotation: Omit<SequenceAnnotation, 'id' | 'created_at' | 'updated_at'>): Promise<SequenceAnnotation> {
    const response: AxiosResponse<SequenceAnnotation> = await this.client.post('/annotations/sequences', annotation);
    return response.data;
  }

  async updateSequenceAnnotation(id: number, updates: Partial<SequenceAnnotation>): Promise<SequenceAnnotation> {
    const response: AxiosResponse<SequenceAnnotation> = await this.client.patch(`/annotations/sequences/${id}`, updates);
    return response.data;
  }

  async deleteSequenceAnnotation(id: number): Promise<void> {
    await this.client.delete(`/annotations/sequences/${id}`);
  }

  // GIF Generation
  async generateGifs(annotationId: number): Promise<void> {
    await this.client.post(`/annotations/sequences/${annotationId}/generate-gifs`);
  }

  async getGifUrls(annotationId: number): Promise<GifUrlsResponse> {
    const response: AxiosResponse<GifUrlsResponse> = await this.client.get(`/annotations/sequences/${annotationId}/gifs/urls`);
    return response.data;
  }

  // Detections
  async getDetections(filters: { sequence_id?: number; order_by?: 'created_at' | 'recorded_at'; order_direction?: 'asc' | 'desc'; page?: number; size?: number } = {}): Promise<PaginatedResponse<Detection>> {
    const response: AxiosResponse<PaginatedResponse<Detection>> = await this.client.get('/detections', {
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
    const response: AxiosResponse<PaginatedResponse<DetectionAnnotation>> = await this.client.get('/annotations/detections', {
      params: filters,
    });
    return response.data;
  }

  async getDetectionAnnotation(id: number): Promise<DetectionAnnotation> {
    const response: AxiosResponse<DetectionAnnotation> = await this.client.get(`/annotations/detections/${id}`);
    return response.data;
  }

  async createDetectionAnnotation(annotation: Omit<DetectionAnnotation, 'id' | 'updated_at'>): Promise<DetectionAnnotation> {
    const response: AxiosResponse<DetectionAnnotation> = await this.client.post('/annotations/detections', annotation);
    return response.data;
  }

  async updateDetectionAnnotation(id: number, updates: Partial<DetectionAnnotation>): Promise<DetectionAnnotation> {
    const response: AxiosResponse<DetectionAnnotation> = await this.client.patch(`/annotations/detections/${id}`, updates);
    return response.data;
  }

  async deleteDetectionAnnotation(id: number): Promise<void> {
    await this.client.delete(`/annotations/detections/${id}`);
  }

  // Health check
  async healthCheck(): Promise<{ status: string }> {
    // Note: health check is at /status, not in /api/v1
    const response = await axios.get(`${this.client.defaults.baseURL?.replace('/api/v1', '')}/status`);
    return response.data;
  }
}

// Export a singleton instance
export const apiClient = new ApiClient();
export default apiClient;