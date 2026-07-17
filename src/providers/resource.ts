export type ResourceState<T> = {
  data: T;
  status: 'idle' | 'loading' | 'ready' | 'error';
  isRefreshing: boolean;
  lastSuccessfulAt: string | null;
  error: string | null;
};
