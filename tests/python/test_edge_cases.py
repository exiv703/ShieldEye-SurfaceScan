#!/usr/bin/env python3
"""Edge case and invalid data type testing"""

import requests
import json
import time

def test_invalid_data_types():
    """Test API with various invalid data types"""
    print("Testing invalid data types...")
    
    test_cases = [
        # Invalid URL types
        {"url": 123},  # Number instead of string
        {"url": []},   # Array instead of string
        {"url": {}},   # Object instead of string
        {"url": None}, # Null value
        {"url": True}, # Boolean instead of string
        
        # Invalid nested objects
        {"url": "https://test.com", "options": "invalid"},  # String instead of object
        {"url": "https://test.com", "options": 123},        # Number instead of object
        
        # Extremely long strings
        {"url": "https://" + "a" * 10000 + ".com"},
        
        # Special characters and encoding issues
        {"url": "https://test.com/\x00\x01\x02"},
        {"url": "https://test.com/" + "🚀" * 100},
        
        # Empty and whitespace
        {"url": ""},
        {"url": "   "},
        {"url": "\n\t\r"},
    ]
    
    results = []
    for i, test_case in enumerate(test_cases):
        try:
            response = requests.post("http://localhost:3000/api/scans", 
                                   json=test_case, timeout=5)
            results.append({
                "test": i+1,
                "payload": str(test_case)[:100],
                "status": response.status_code,
                "response": response.text[:200]
            })
        except Exception as e:
            results.append({
                "test": i+1,
                "payload": str(test_case)[:100],
                "status": "ERROR",
                "response": str(e)[:200]
            })
        
        time.sleep(0.1)  # Small delay to avoid rate limiting
    
    return results

def test_boundary_values():
    """Test boundary values and limits"""
    print("Testing boundary values...")
    
    boundary_tests = [
        # Very large numbers
        {"url": "https://test.com", "options": {"timeout": 999999999}},
        {"url": "https://test.com", "options": {"depth": -1}},
        {"url": "https://test.com", "options": {"depth": 0}},
        {"url": "https://test.com", "options": {"depth": 999999}},
        
        # Unicode and special characters
        {"url": "https://тест.com"},
        {"url": "https://test.com/пуÿ"},
        {"url": "https://test.com/\u0000"},
        
        # Protocol edge cases
        {"url": "ftp://test.com"},
        {"url": "file:///etc/passwd"},
        {"url": "javascript:alert(1)"},
        {"url": "data:text/html,<script>alert(1)</script>"},
    ]
    
    results = []
    for i, test_case in enumerate(boundary_tests):
        try:
            response = requests.post("http://localhost:3000/api/scans", 
                                   json=test_case, timeout=5)
            results.append({
                "test": f"boundary_{i+1}",
                "payload": str(test_case)[:100],
                "status": response.status_code,
                "response": response.text[:200]
            })
        except Exception as e:
            results.append({
                "test": f"boundary_{i+1}",
                "payload": str(test_case)[:100],
                "status": "ERROR",
                "response": str(e)[:200]
            })
        
        time.sleep(0.1)
    
    return results

def test_malformed_requests():
    """Test malformed HTTP requests"""
    print("Testing malformed requests...")
    
    malformed_tests = [
        # Missing Content-Type
        ("POST", "/api/scans", '{"url":"https://test.com"}', {}),
        
        # Wrong Content-Type
        ("POST", "/api/scans", '{"url":"https://test.com"}', {"Content-Type": "text/plain"}),
        ("POST", "/api/scans", '{"url":"https://test.com"}', {"Content-Type": "application/xml"}),
        
        # Invalid JSON with correct Content-Type
        ("POST", "/api/scans", '{"url":}', {"Content-Type": "application/json"}),
        ("POST", "/api/scans", '{url:"test"}', {"Content-Type": "application/json"}),
        ("POST", "/api/scans", 'not json at all', {"Content-Type": "application/json"}),
    ]
    
    results = []
    for i, (method, endpoint, data, headers) in enumerate(malformed_tests):
        try:
            response = requests.request(method, f"http://localhost:3000{endpoint}",
                                      data=data, headers=headers, timeout=5)
            results.append({
                "test": f"malformed_{i+1}",
                "method": method,
                "headers": str(headers),
                "status": response.status_code,
                "response": response.text[:200]
            })
        except Exception as e:
            results.append({
                "test": f"malformed_{i+1}",
                "method": method,
                "headers": str(headers),
                "status": "ERROR",
                "response": str(e)[:200]
            })
        
        time.sleep(0.1)
    
    return results

if __name__ == "__main__":
    print("=== Edge Case Testing ===\n")
    
    # Wait for rate limit reset
    print("Waiting for rate limit reset...")
    time.sleep(15)
    
    all_results = []
    
    # Test 1: Invalid data types
    invalid_results = test_invalid_data_types()
    all_results.extend(invalid_results)
    
    time.sleep(2)
    
    # Test 2: Boundary values
    boundary_results = test_boundary_values()
    all_results.extend(boundary_results)
    
    time.sleep(2)
    
    # Test 3: Malformed requests
    malformed_results = test_malformed_requests()
    all_results.extend(malformed_results)
    
    # Analyze results
    print(f"\n=== EDGE CASE RESULTS ===")
    print(f"Total tests: {len(all_results)}")
    
    error_count = 0
    status_500_count = 0
    status_400_count = 0
    
    for result in all_results:
        if result["status"] == "ERROR":
            error_count += 1
        elif result["status"] == 500:
            status_500_count += 1
            print(f"500 ERROR in {result['test']}: {result['response'][:100]}")
        elif result["status"] == 400:
            status_400_count += 1
    
    print(f"Connection errors: {error_count}")
    print(f"500 Internal Server Errors: {status_500_count}")
    print(f"400 Bad Request (expected): {status_400_count}")
    
    if status_500_count > 0:
        print("\n⚠️  Found internal server errors - these need investigation!")
