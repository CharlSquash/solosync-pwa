// src/services/api.js
import axios from 'axios';

// --- Configuration ---
// This will be 'http://127.0.0.1:8000' in local development (from .env.development)
// and 'https://www.squashsync.com' in production (from .env.production).
const API_BASE_URL = process.env.REACT_APP_API_URL;
console.log("Using API Base URL:", API_BASE_URL);

// This endpoint is relative to the API_BASE_URL
const REFRESH_TOKEN_ENDPOINT = '/api/token/refresh/'; // CORRECTED path

// --- Axios Instance Creation ---
const apiClient = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
    xsrfCookieName: 'csrftoken',
    xsrfHeaderName: 'X-CSRFToken',
    withCredentials: true,
});

// --- Request Interceptor (Adds Auth Token) ---
apiClient.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('accessToken');
        if (token) {
            config.headers['Authorization'] = `Bearer ${token}`;
        }
        return config;
    },
    (error) => {
        console.error("Request Interceptor Error:", error);
        return Promise.reject(error);
    }
);

// --- Response Interceptor (Handles Token Refresh) ---

let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
    failedQueue.forEach(prom => {
        if (error) { prom.reject(error); }
        else { prom.resolve(token); }
    });
    failedQueue = [];
};

apiClient.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;
        console.log(`Response Interceptor: Error Status ${error.response?.status} on URL ${originalRequest.url}`);

        if (error.response?.status === 401 && !originalRequest._retry && !originalRequest.url.endsWith(REFRESH_TOKEN_ENDPOINT)) {
            console.log("Response Interceptor: Detected 401, potentially expired token.");

            if (isRefreshing) {
                console.log("Response Interceptor: Refresh already in progress, adding request to queue.");
                return new Promise(function(resolve, reject) {
                    failedQueue.push({ resolve, reject });
                }).then(token => {
                    console.log("Response Interceptor: Retrying request from queue with new token.");
                    originalRequest.headers['Authorization'] = 'Bearer ' + token;
                    return apiClient(originalRequest);
                }).catch(err => Promise.reject(err));
            }

            originalRequest._retry = true;
            isRefreshing = true;
            const refreshToken = localStorage.getItem('refreshToken');
            console.log("Response Interceptor: Attempting token refresh.");

            if (!refreshToken) {
                console.log("Response Interceptor: No refresh token found. Forcing logout.");
                isRefreshing = false;
                localStorage.removeItem('accessToken');
                localStorage.removeItem('refreshToken');
                window.location.href = '/login';
                return Promise.reject(error);
            }

            try {
                // Use a separate axios instance for the refresh call to avoid an interceptor loop
                const refreshResponse = await axios.post(`${API_BASE_URL}${REFRESH_TOKEN_ENDPOINT}`, {
                    refresh: refreshToken
                }, { headers: { 'Content-Type': 'application/json' } });

                const newAccessToken = refreshResponse.data.access;
                console.log("Response Interceptor: Token refresh successful.");
                localStorage.setItem('accessToken', newAccessToken);
                apiClient.defaults.headers.common['Authorization'] = `Bearer ${newAccessToken}`;
                originalRequest.headers['Authorization'] = `Bearer ${newAccessToken}`;
                processQueue(null, newAccessToken);
                console.log("Response Interceptor: Retrying original request.");
                return apiClient(originalRequest);

            } catch (refreshError) {
                console.error("Response Interceptor: Token refresh failed:", refreshError);
                processQueue(refreshError, null);
                localStorage.removeItem('accessToken');
                localStorage.removeItem('refreshToken');
                window.location.href = '/login';
                return Promise.reject(refreshError);
            } finally {
                isRefreshing = false;
            }
        }
        return Promise.reject(error);
    }
);

// --- API Functions ---
// All paths are now relative to the API_BASE_URL, and must start with a '/'
export const loginUser = (username, password) => {
    // *** THIS IS THE MAIN FIX ***
    // The path should not include 'solo' for the token endpoint.
    return apiClient.post('/api/token/', { username, password });
};

export const getAssignedRoutines = () => {
    return apiClient.get('/api/solo/assigned-routines/');
};

export const getRoutineDetails = (routineId) => {
    return apiClient.get(`/api/solo/assigned-routines/${routineId}/`);
};

export const logSession = async (sessionData) => {
    const relativePath = '/api/solo/session-logs/';
    try {
        const response = await apiClient.post(relativePath, sessionData);
        return response.data;
    } catch (error) {
        console.error("Error in logSession API call:", error);
        if (error.response) {
            console.error("Error data:", error.response.data);
            console.error("Error status:", error.response.status);
            const apiError = new Error(
                error.response.data?.detail ||
                (error.response.data && typeof error.response.data === 'object' ? JSON.stringify(error.response.data) : null) ||
                `API Error: ${error.response.status}`
            );
            apiError.data = error.response.data;
            apiError.status = error.response.status;
            throw apiError;
        } else if (error.request) {
            console.error("Error request:", error.request);
            throw new Error('Network Error: Could not connect to server.');
        } else {
            console.error('Error message:', error.message);
            throw new Error('Request setup error.');
        }
    }
};

export const getLoggedSessions = async () => {
    const relativePath = '/api/solo/session-logs/';
    console.log(`API: Fetching logged sessions from ${relativePath}`);
    try {
        const response = await apiClient.get(relativePath);
        return response.data;
    } catch (error) {
        console.error("Error in getLoggedSessions API call:", error);
        if (error.response) {
            console.error("Error data:", error.response.data);
            console.error("Error status:", error.response.status);
            const apiError = new Error(
                error.response.data?.detail ||
                error.response.data?.message ||
                `API Error: ${error.response.status}`
            );
            apiError.data = error.response.data;
            apiError.status = error.response.status;
            throw apiError;
        } else if (error.request) {
            console.error("Error request:", error.request);
            throw new Error('Network Error: Could not connect to server.');
        } else {
            console.error('Error message:', error.message);
            throw new Error('Request setup error.');
        }
    }
};

export default apiClient;
