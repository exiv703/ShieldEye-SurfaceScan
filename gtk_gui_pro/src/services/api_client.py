#!/usr/bin/env python3
"""
ShieldEye Professional - API Client
Enterprise-grade API client with retry logic, caching, and error handling
"""

import json
import time
import threading
from typing import Dict, Any, Optional, List, Callable
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import logging

@dataclass
class ScanRequest:
    """Scan request data structure"""
    url: str
    render_javascript: bool = True
    timeout: int = 30000
    crawl_depth: int = 1
    scan_type: str = "comprehensive"
    
@dataclass
class ScanStatus:
    """Scan status data structure"""
    id: str
    status: str
    progress: int
    created_at: str
    stage: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    error: Optional[str] = None

@dataclass
class ApiResponse:
    """Generic API response wrapper"""
    success: bool
    data: Any = None
    error: Optional[str] = None
    status_code: int = 200

class APIClient:
    """Professional API client with enterprise features"""
    
    def __init__(self, base_url: str = "http://localhost:3000"):
        self.base_url = base_url.rstrip('/')
        self.logger = logging.getLogger('APIClient')
        
        # Session with retry strategy
        self.session = requests.Session()
        retry_strategy = Retry(
            total=3,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["HEAD", "GET", "OPTIONS"],
            backoff_factor=1
        )
        adapter = HTTPAdapter(max_retries=retry_strategy)
        self.session.mount("http://", adapter)
        self.session.mount("https://", adapter)
        
        # Request timeout
        self.timeout = 30
        
        # Cache for responses
        self._cache: Dict[str, Dict] = {}
        self._cache_ttl: Dict[str, datetime] = {}
        self._cache_lock = threading.Lock()
        
        # Connection status
        self._is_connected = False
        self._last_health_check = None
        
        # Event callbacks
        self._status_callbacks: List[Callable] = []
        
    def set_base_url(self, url: str):
        """Set API base URL"""
        self.base_url = url.rstrip('/')
        self._is_connected = False  # Reset connection status
        
    def add_status_callback(self, callback: Callable[[bool], None]):
        """Add callback for connection status changes"""
        self._status_callbacks.append(callback)
        
    def _notify_status_change(self, connected: bool):
        """Notify all callbacks of status change"""
        if connected != self._is_connected:
            self._is_connected = connected
            for callback in self._status_callbacks:
                try:
                    callback(connected)
                except Exception as e:
                    self.logger.error(f"Status callback error: {e}")
    
    def _get_cache_key(self, endpoint: str, params: Dict = None) -> str:
        """Generate cache key for request"""
        key = f"{endpoint}"
        if params:
            key += f"_{hash(str(sorted(params.items())))}"
        return key
    
    def _get_cached_response(self, cache_key: str) -> Optional[Dict]:
        """Get cached response if still valid"""
        with self._cache_lock:
            if cache_key in self._cache:
                if datetime.now() < self._cache_ttl.get(cache_key, datetime.min):
                    return self._cache[cache_key]
                else:
                    # Expired, remove from cache
                    del self._cache[cache_key]
                    if cache_key in self._cache_ttl:
                        del self._cache_ttl[cache_key]
        return None
    
    def _cache_response(self, cache_key: str, response: Dict, ttl_seconds: int = 300):
        """Cache response with TTL"""
        with self._cache_lock:
            self._cache[cache_key] = response
            self._cache_ttl[cache_key] = datetime.now() + timedelta(seconds=ttl_seconds)
    
    def _make_request(self, method: str, endpoint: str, **kwargs) -> ApiResponse:
        """Make HTTP request with error handling"""
        url = f"{self.base_url}{endpoint}"
        
        try:
            response = self.session.request(
                method=method,
                url=url,
                timeout=self.timeout,
                **kwargs
            )
            
            # Update connection status
            self._notify_status_change(True)
            
            if response.ok:
                try:
                    data = response.json()
                    return ApiResponse(success=True, data=data, status_code=response.status_code)
                except json.JSONDecodeError:
                    return ApiResponse(success=True, data=response.text, status_code=response.status_code)
            else:
                error_msg = f"HTTP {response.status_code}: {response.reason}"
                try:
                    error_data = response.json()
                    if 'error' in error_data:
                        error_msg = error_data['error']
                except:
                    pass
                
                return ApiResponse(
                    success=False, 
                    error=error_msg, 
                    status_code=response.status_code
                )
                
        except requests.exceptions.RequestException as e:
            self._notify_status_change(False)
            self.logger.error(f"Request failed: {e}")
            return ApiResponse(success=False, error=str(e), status_code=0)
    
    def test_connection(self) -> bool:
        """Test API connection"""
        try:
            response = self._make_request('GET', '/health')
            connected = response.success
            self._notify_status_change(connected)
            self._last_health_check = datetime.now()
            return connected
        except Exception as e:
            self.logger.error(f"Connection test failed: {e}")
            self._notify_status_change(False)
            return False
    
    def get_health(self) -> ApiResponse:
        """Get API health status"""
        cache_key = self._get_cache_key('/health')
        cached = self._get_cached_response(cache_key)
        
        if cached:
            return ApiResponse(success=True, data=cached)
        
        response = self._make_request('GET', '/health')
        if response.success:
            self._cache_response(cache_key, response.data, ttl_seconds=30)
        
        return response
    
    def get_ready(self) -> ApiResponse:
        """Get API readiness status"""
        return self._make_request('GET', '/ready')
    
    def create_scan(self, scan_request: ScanRequest) -> ApiResponse:
        """Create new scan"""
        payload = asdict(scan_request)
        # Convert snake_case to camelCase for API
        api_payload = {
            'url': payload['url'],
            'renderJavaScript': payload['render_javascript'],
            'timeout': payload['timeout'],
            'crawlDepth': payload['crawl_depth'],
            'scanType': payload.get('scan_type', 'comprehensive')
        }
        
        return self._make_request('POST', '/api/scans', json=api_payload)
    
    def get_scan_status(self, scan_id: str) -> ApiResponse:
        """Get scan status"""
        return self._make_request('GET', f'/api/scans/{scan_id}/status')
    
    def get_scan_results(self, scan_id: str) -> ApiResponse:
        """Get scan results"""
        cache_key = self._get_cache_key(f'/api/scans/{scan_id}/results')
        cached = self._get_cached_response(cache_key)
        
        if cached:
            return ApiResponse(success=True, data=cached)
        
        response = self._make_request('GET', f'/api/scans/{scan_id}/results')
        if response.success:
            # Cache results for longer since they don't change
            self._cache_response(cache_key, response.data, ttl_seconds=3600)
        
        return response
    
    def get_scan_surface(self, scan_id: str) -> ApiResponse:
        """Get surface-focused view (forms, headers, cookies, iframes, inline JS) for a scan."""
        cache_key = self._get_cache_key(f'/api/scans/{scan_id}/surface')
        cached = self._get_cached_response(cache_key)
        if cached:
            return ApiResponse(success=True, data=cached)

        response = self._make_request('GET', f'/api/scans/{scan_id}/surface')
        if response.success:
            # Surface view is also effectively static for a completed scan
            self._cache_response(cache_key, response.data, ttl_seconds=3600)
        return response
    
    def get_scan_list(self, limit: int = 50, offset: int = 0) -> ApiResponse:
        """Get list of scans"""
        params = {'limit': limit, 'offset': offset}
        return self._make_request('GET', '/api/scans', params=params)
    
    def delete_scan(self, scan_id: str) -> ApiResponse:
        """Delete scan"""
        return self._make_request('DELETE', f'/api/scans/{scan_id}')
    
    def get_queue_stats(self) -> ApiResponse:
        """Get queue statistics"""
        cache_key = self._get_cache_key('/api/queue/stats')
        cached = self._get_cached_response(cache_key)
        
        if cached:
            return ApiResponse(success=True, data=cached)
        
        response = self._make_request('GET', '/api/queue/stats')
        if response.success:
            self._cache_response(cache_key, response.data, ttl_seconds=10)
        
        return response
    
    def get_analytics_summary(self) -> ApiResponse:
        """Get analytics summary"""
        # Always fetch fresh analytics to reflect latest scans and findings
        return self._make_request('GET', '/api/analytics/summary')
    
    def generate_ai_analysis(self, prompt: str, context: Dict = None, provider: Optional[str] = None, model: Optional[str] = None, temperature: Optional[float] = None, max_tokens: Optional[int] = None) -> ApiResponse:
        """Generate AI analysis"""
        payload = {
            'prompt': prompt,
            'system': (
                'You are a senior application security expert specializing in web application risk analysis. '
                'Given scan results and findings, you must produce a clear, structured report with the '
                'following sections: 1) Executive Summary (non-technical, 3–5 bullet points), '
                '2) Key Risks (ranked from most to least critical, mapped to a severity level), '
                '3) Technical Details (how the issues can be exploited, where applicable), '
                '4) Prioritized Remediation Plan (concrete, actionable steps ordered by impact and effort). '
                'Use concise language and avoid speculation not supported by the provided context.'
            ),
            'max_tokens': max_tokens if max_tokens is not None else 512,
            'temperature': temperature if temperature is not None else 0.2
        }
        
        if context:
            payload['context'] = context
        if provider:
            payload['provider'] = provider
        if model:
            payload['model'] = model
        
        primary = self._make_request('POST', '/api/ai/llm/generate', json=payload)
        if not primary.success and primary.status_code == 404:
            alt = self._make_request('POST', '/api/ai/generate', json=payload)
            if not alt.success and alt.status_code == 404:
                return self._make_request('POST', '/api/ai/analyze', json=payload)
            return alt
        return primary
    
    def export_scan_report(self, scan_id: str, format: str = 'json') -> ApiResponse:
        """Export scan report"""
        params = {'format': format}
        return self._make_request('GET', f'/api/scans/{scan_id}/export', params=params)
    
    def get_settings(self) -> ApiResponse:
        """Get application settings"""
        return self._make_request('GET', '/api/settings')
    
    def update_settings(self, settings: Dict) -> ApiResponse:
        """Update application settings"""
        return self._make_request('PUT', '/api/settings', json=settings)

    def run_injection_tests(self, url: str, tests: Optional[List[str]] = None) -> ApiResponse:
        payload = {'url': url}
        if tests:
            payload['tests'] = tests
        resp = self._make_request('POST', '/api/injection/run', json=payload)
        return resp

    def get_injection_status(self, task_id: str) -> ApiResponse:
        return self._make_request('GET', f'/api/injection/{task_id}/status')

    def generate_hardening(self, scan_data: Dict) -> ApiResponse:
        return self._make_request('POST', '/api/hardening/generate', json=scan_data)
    
    def cleanup(self):
        """Cleanup resources"""
        self.session.close()
        with self._cache_lock:
            self._cache.clear()
            self._cache_ttl.clear()
    
    @property
    def is_connected(self) -> bool:
        """Check if API is connected"""
        # Auto-refresh health check if old
        if (self._last_health_check is None or 
            datetime.now() - self._last_health_check > timedelta(minutes=5)):
            threading.Thread(target=self.test_connection, daemon=True).start()
        
        return self._is_connected
