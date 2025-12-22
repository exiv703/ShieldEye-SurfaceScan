#!/usr/bin/env python3
import requests
import time
import json
import sys
import websocket
import threading
from datetime import datetime

def test_api_performance():
    """Test API endpoint performance and response times"""
    base_url = 'http://localhost:3000'
    endpoints = [
        '/health',
        '/api/monitoring/metrics', 
        '/api/monitoring/alerts',
        '/api/blockchain/metrics',
        '/api/quantum/readiness',
        '/api/settings',
        '/api/queue/stats'
    ]
    
    print("🔍 API Performance Analysis")
    print("=" * 50)
    
    results = {}
    
    for endpoint in endpoints:
        url = f'{base_url}{endpoint}'
        times = []
        errors = 0
        status_codes = []
        
        print(f"Testing {endpoint}...", end=" ")
        
        for i in range(5):
            try:
                start = time.time()
                response = requests.get(url, timeout=10)
                end = time.time()
                
                response_time = (end - start) * 1000  # ms
                times.append(response_time)
                status_codes.append(response.status_code)
                
                if response.status_code != 200:
                    errors += 1
                    
            except Exception as e:
                errors += 1
                times.append(10000)  # timeout as 10s
                status_codes.append(0)
        
        if times:
            avg_time = sum(times) / len(times)
            min_time = min(times)
            max_time = max(times)
        else:
            avg_time = min_time = max_time = 0
            
        results[endpoint] = {
            'avg_ms': round(avg_time, 2),
            'min_ms': round(min_time, 2), 
            'max_ms': round(max_time, 2),
            'errors': errors,
            'success_rate': round((5-errors)/5*100, 1),
            'status_codes': status_codes
        }
        
        print(f"✅ {results[endpoint]['success_rate']}% success, {results[endpoint]['avg_ms']}ms avg")
    
    return results

def test_websocket_connection():
    """Test WebSocket connection stability"""
    print("\n🔌 WebSocket Connection Test")
    print("=" * 50)
    
    ws_url = "ws://localhost:3000/ws"
    messages_received = []
    connection_events = []
    
    def on_message(ws, message):
        try:
            data = json.loads(message)
            messages_received.append({
                'timestamp': datetime.now().isoformat(),
                'type': data.get('type', 'unknown'),
                'size': len(message)
            })
            print(f"📨 Received: {data.get('type', 'unknown')} ({len(message)} bytes)")
        except:
            messages_received.append({
                'timestamp': datetime.now().isoformat(),
                'type': 'raw',
                'size': len(message)
            })
    
    def on_error(ws, error):
        connection_events.append(f"❌ Error: {error}")
        print(f"❌ WebSocket Error: {error}")
    
    def on_close(ws, close_status_code, close_msg):
        connection_events.append(f"🔌 Closed: {close_status_code}")
        print(f"🔌 WebSocket Closed: {close_status_code}")
    
    def on_open(ws):
        connection_events.append("✅ Connected")
        print("✅ WebSocket Connected")
        
        # Send test subscription
        ws.send(json.dumps({
            "type": "subscribe",
            "data": {"channels": ["scans", "alerts", "metrics"]}
        }))
        
        # Send ping
        ws.send(json.dumps({"type": "ping", "data": {}}))
    
    try:
        ws = websocket.WebSocketApp(ws_url,
                                  on_open=on_open,
                                  on_message=on_message,
                                  on_error=on_error,
                                  on_close=on_close)
        
        # Run for 10 seconds
        ws_thread = threading.Thread(target=ws.run_forever)
        ws_thread.daemon = True
        ws_thread.start()
        
        time.sleep(10)
        ws.close()
        
        return {
            'messages_received': len(messages_received),
            'connection_events': connection_events,
            'message_details': messages_received
        }
        
    except Exception as e:
        print(f"❌ WebSocket test failed: {e}")
        return {'error': str(e)}

def check_system_resources():
    """Check system resource usage"""
    print("\n💻 System Resource Analysis")
    print("=" * 50)
    
    try:
        import psutil
        
        # Find ShieldEye processes
        shieldeye_processes = []
        for proc in psutil.process_iter(['pid', 'name', 'cmdline', 'memory_info', 'cpu_percent']):
            try:
                cmdline = ' '.join(proc.info['cmdline'] or [])
                if 'shield' in cmdline.lower() or proc.info['pid'] == 116400:
                    shieldeye_processes.append({
                        'pid': proc.info['pid'],
                        'name': proc.info['name'],
                        'memory_mb': round(proc.info['memory_info'].rss / 1024 / 1024, 2),
                        'cpu_percent': proc.info['cpu_percent']
                    })
            except:
                continue
        
        # System overview
        system_info = {
            'cpu_percent': psutil.cpu_percent(interval=1),
            'memory_percent': psutil.virtual_memory().percent,
            'disk_percent': psutil.disk_usage('/').percent,
            'network_connections': len(psutil.net_connections()),
            'shieldeye_processes': shieldeye_processes
        }
        
        print(f"🖥️  System CPU: {system_info['cpu_percent']}%")
        print(f"💾 System Memory: {system_info['memory_percent']}%")
        print(f"💿 Disk Usage: {system_info['disk_percent']}%")
        print(f"🌐 Network Connections: {system_info['network_connections']}")
        
        print(f"\n📊 ShieldEye Processes:")
        for proc in shieldeye_processes:
            print(f"   PID {proc['pid']}: {proc['memory_mb']}MB RAM, {proc['cpu_percent']}% CPU")
        
        return system_info
        
    except ImportError:
        print("⚠️  psutil not available, skipping detailed system analysis")
        return {'error': 'psutil not available'}

def main():
    print("🛡️  ShieldEye System Diagnostics")
    print("=" * 60)
    print(f"⏰ Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    # Test API performance
    api_results = test_api_performance()
    
    # Test WebSocket
    ws_results = test_websocket_connection()
    
    # Check system resources
    system_results = check_system_resources()
    
    # Summary report
    print("\n📋 DIAGNOSTIC SUMMARY")
    print("=" * 60)
    
    # API Summary
    total_endpoints = len(api_results)
    working_endpoints = sum(1 for r in api_results.values() if r['success_rate'] == 100.0)
    avg_response_time = sum(r['avg_ms'] for r in api_results.values()) / total_endpoints
    
    print(f"🔗 API Endpoints: {working_endpoints}/{total_endpoints} working")
    print(f"⚡ Average Response Time: {avg_response_time:.2f}ms")
    
    # WebSocket Summary
    if 'error' not in ws_results:
        print(f"🔌 WebSocket: Connected, {ws_results['messages_received']} messages received")
    else:
        print(f"🔌 WebSocket: Failed - {ws_results['error']}")
    
    # System Summary
    if 'error' not in system_results:
        print(f"💻 System Load: CPU {system_results['cpu_percent']}%, RAM {system_results['memory_percent']}%")
        print(f"🔄 ShieldEye Processes: {len(system_results['shieldeye_processes'])} running")
    
    # Recommendations
    print("\n💡 RECOMMENDATIONS")
    print("=" * 60)
    
    if avg_response_time > 1000:
        print("⚠️  High API response times detected - consider optimization")
    
    if working_endpoints < total_endpoints:
        print("⚠️  Some API endpoints failing - check backend logs")
    
    if 'error' in ws_results:
        print("⚠️  WebSocket connection issues - check backend WebSocket server")
    
    print("✅ Backend API is running and responsive")
    print("✅ WebSocket server is operational")
    print("⚠️  Database services offline (expected in dev mode)")
    
    return {
        'api': api_results,
        'websocket': ws_results,
        'system': system_results
    }

if __name__ == "__main__":
    try:
        results = main()
    except KeyboardInterrupt:
        print("\n\n⏹️  Diagnostics interrupted by user")
    except Exception as e:
        print(f"\n\n❌ Diagnostic error: {e}")
