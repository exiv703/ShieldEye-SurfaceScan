#!/usr/bin/env python3

import logging
from typing import Optional
import gi

gi.require_version('Notify', '0.7')
try:
    from gi.repository import Notify
    NOTIFICATIONS_AVAILABLE = True
except ImportError:
    NOTIFICATIONS_AVAILABLE = False

class NotificationService:
    
    def __init__(self):
        self.logger = logging.getLogger('NotificationService')
        self.initialized = False
        
    def initialize(self) -> bool:
        if not NOTIFICATIONS_AVAILABLE:
            self.logger.warning("Notifications not available (libnotify not found)")
            return False
        
        try:
            Notify.init("ShieldEye SurfaceScan")
            self.initialized = True
            self.logger.info("Notification service initialized")
            return True
        except Exception as e:
            self.logger.error(f"Failed to initialize notifications: {e}")
            return False
    
    def show_notification(self, title: str, message: str, 
                         icon: str = "dialog-information",
                         urgency: str = "normal") -> bool:
        if not self.initialized:
            return False
        
        try:
            notification = Notify.Notification.new(title, message, icon)
            
            # Set urgency
            urgency_map = {
                'low': Notify.Urgency.LOW,
                'normal': Notify.Urgency.NORMAL,
                'critical': Notify.Urgency.CRITICAL
            }
            notification.set_urgency(urgency_map.get(urgency, Notify.Urgency.NORMAL))
            
            notification.show()
            return True
            
        except Exception as e:
            self.logger.error(f"Failed to show notification: {e}")
            return False
    
    def show_scan_complete(self, scan_url: str, risk_score: float):
        if risk_score >= 80:
            icon = "dialog-error"
            urgency = "critical"
            title = "⚠️ High Risk Scan Complete"
        elif risk_score >= 60:
            icon = "dialog-warning"
            urgency = "normal"
            title = "🔶 Medium Risk Scan Complete"
        else:
            icon = "dialog-information"
            urgency = "low"
            title = "✅ Scan Complete"
        
        message = f"Scan of {scan_url} completed with risk score: {risk_score:.1f}"
        self.show_notification(title, message, icon, urgency)
    
    def show_threat_alert(self, threat_type: str, details: str):
        title = f"🚨 Security Alert: {threat_type}"
        self.show_notification(title, details, "dialog-error", "critical")
    
    def cleanup(self):
        if self.initialized and NOTIFICATIONS_AVAILABLE:
            try:
                Notify.uninit()
                self.logger.info("Notification service cleaned up")
            except Exception as e:
                self.logger.error(f"Failed to cleanup notifications: {e}")
