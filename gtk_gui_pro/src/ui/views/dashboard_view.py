#!/usr/bin/env python3

import threading
from typing import Dict, List, Any, Optional
from datetime import datetime, timedelta
import gi

gi.require_version('Gtk', '3.0')
from gi.repository import Gtk, GLib, Pango
import math

from ..components.metric_card import MetricCard
from ..components.chart_widget import ChartWidget, ChartType
from ..components.recent_scans_widget import RecentScansWidget
from ..components.threat_overview_widget import ThreatOverviewWidget


class DashboardView(Gtk.ScrolledWindow):
    
    def __init__(self, main_window):
        super().__init__()
        
        self.main_window = main_window
        self.api_client = main_window.api_client
        self.logger = main_window.logger
        
        self.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
        self.get_style_context().add_class('dashboard-view')
        
        self._analytics_data: Optional[Dict] = None
        self._last_refresh = None
        
        self.metric_cards: Dict[str, MetricCard] = {}
        self.charts: Dict[str, ChartWidget] = {}
        
        self._build_ui()
        
        self.refresh()
    
    def _build_ui(self):
        main_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        main_box.set_margin_left(20)
        main_box.set_margin_right(20)
        main_box.set_margin_top(16)
        main_box.set_margin_bottom(16)
        self.add(main_box)
        
        header = self._create_header()
        main_box.pack_start(header, False, False, 0)
        
        metrics_row = self._create_metrics_row()
        main_box.pack_start(metrics_row, False, False, 0)
        
        charts_section = self._create_charts_section()
        main_box.pack_start(charts_section, False, False, 0)
    
    def _create_header(self):
        header = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL)
        header.get_style_context().add_class('dashboard-header')
        
        title_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4)
        
        title = Gtk.Label()
        title.set_markup('<span size="x-large" weight="bold">Security Dashboard</span>')
        title.get_style_context().add_class('dashboard-title')
        title.set_xalign(0)
        title_box.pack_start(title, False, False, 0)
        
        subtitle = Gtk.Label()
        subtitle.set_markup('<span size="small">Real-time security monitoring and analytics</span>')
        subtitle.get_style_context().add_class('dashboard-subtitle')
        subtitle.set_xalign(0)
        title_box.pack_start(subtitle, False, False, 0)
        
        header.pack_start(title_box, True, True, 0)
        
        actions_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=12)
        
        refresh_btn = Gtk.Button()
        refresh_btn.get_style_context().add_class('action-button')
        refresh_btn.get_style_context().add_class('btn-refresh')
        
        refresh_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        refresh_box.set_halign(Gtk.Align.CENTER)
        
        refresh_icon = Gtk.Image.new_from_icon_name("view-refresh-symbolic", Gtk.IconSize.BUTTON)
        refresh_label = Gtk.Label(label="Refresh")
        
        refresh_box.pack_start(refresh_icon, False, False, 0)
        refresh_box.pack_start(refresh_label, False, False, 0)
        refresh_btn.add(refresh_box)
        
        refresh_btn.connect('clicked', lambda x: self.refresh())
        actions_box.pack_start(refresh_btn, False, False, 0)
        
        new_scan_btn = Gtk.Button()
        new_scan_btn.get_style_context().add_class('action-button')
        new_scan_btn.get_style_context().add_class('btn-new-scan')
        
        scan_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        scan_box.set_halign(Gtk.Align.CENTER)
        
        scan_icon = Gtk.Image.new_from_icon_name("list-add-symbolic", Gtk.IconSize.BUTTON)
        scan_label = Gtk.Label(label="New Scan")
        
        scan_box.pack_start(scan_icon, False, False, 0)
        scan_box.pack_start(scan_label, False, False, 0)
        new_scan_btn.add(scan_box)
        
        new_scan_btn.connect('clicked', lambda x: self.main_window.show_new_scan_dialog())
        actions_box.pack_start(new_scan_btn, False, False, 0)
        
        header.pack_end(actions_box, False, False, 0)
        
        return header
    
    def _create_metrics_row(self):
        container = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        
        title = Gtk.Label()
        title.set_markup('<span size="large" weight="semibold">Key Metrics</span>')
        title.set_xalign(0)
        title.get_style_context().add_class('section-title-compact')
        container.pack_start(title, False, False, 0)
        
        metrics_grid = Gtk.Grid()
        metrics_grid.set_row_spacing(8)
        metrics_grid.set_column_spacing(12)
        metrics_grid.set_row_homogeneous(True)
        metrics_grid.set_column_homogeneous(True)
        
        metrics = [
            ("total_scans", "Total Scans", "", "0", "All time"),
            ("active_threats", "Active Threats", "", "0", "Requiring attention"),
            ("vulnerabilities", "Vulnerabilities", "", "0", "Last 30 days"),
            ("risk_score", "Avg Risk Score", "", "0", "Current average")
        ]
        
        for idx, (key, title_text, icon, value, subtitle) in enumerate(metrics):
            card = MetricCard(title_text, value, subtitle, icon)
            self.metric_cards[key] = card
            
            row = idx // 2
            col = idx % 2
            metrics_grid.attach(card, col, row, 1, 1)
        
        container.pack_start(metrics_grid, False, False, 0)
        
        return container
    
    def _create_charts_section(self):
        container = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        
        title = Gtk.Label()
        title.set_markup('<span size="large" weight="semibold">Live Analytics</span>')
        title.set_xalign(0)
        title.get_style_context().add_class('section-title-compact')
        container.pack_start(title, False, False, 0)
        
        grid = Gtk.Grid()
        grid.set_row_spacing(6)
        grid.set_column_spacing(12)
        grid.set_row_homogeneous(True)
        grid.set_column_homogeneous(True)
        
        vuln_chart = ChartWidget(
            title="Vulnerability Trends",
            chart_type=ChartType.LINE,
            height=290
        )
        self.charts['vulnerability_trends'] = vuln_chart
        grid.attach(vuln_chart, 0, 0, 1, 1)
        
        risk_chart = ChartWidget(
            title="Risk Distribution",
            chart_type=ChartType.BAR,
            height=290
        )
        self.charts['risk_distribution'] = risk_chart
        grid.attach(risk_chart, 1, 0, 1, 1)
        
        self.recent_scans_widget = RecentScansWidget(self.main_window, height=290)
        grid.attach(self.recent_scans_widget, 0, 1, 1, 1)
        
        self.threat_overview_widget = ThreatOverviewWidget(self.main_window, height=290)
        grid.attach(self.threat_overview_widget, 1, 1, 1, 1)
        
        container.pack_start(grid, False, False, 0)
        
        return container
    
    def refresh(self):
        self.logger.info("Refreshing dashboard data")
        self._set_loading_state(True)
        threading.Thread(target=self._load_dashboard_data, daemon=True).start()
    
    def _load_dashboard_data(self):
        try:
            response = self.api_client.get_analytics_summary()
            if response.success:
                self._analytics_data = response.data
                GLib.idle_add(self._update_metrics)
                GLib.idle_add(self._update_charts)
            else:
                self.logger.warning(f"Failed to load analytics: {response.error}")
                GLib.idle_add(self._show_error_state, response.error)
            
            self._last_refresh = datetime.now()
            
        except Exception as e:
            self.logger.error(f"Dashboard data loading error: {e}")
            GLib.idle_add(self._show_error_state, str(e))
        finally:
            GLib.idle_add(self._set_loading_state, False)
    
    def _update_metrics(self):
        if not self._analytics_data:
            return
        
        data = self._analytics_data
        
        self.metric_cards['total_scans'].update_value(
            str(data.get('totalScans', 0)),
            self._format_change(data.get('scansChange', 0))
        )
        
        self.metric_cards['active_threats'].update_value(
            str(data.get('activeThreats', 0)),
            self._format_change(data.get('threatsChange', 0))
        )
        if data.get('activeThreats', 0) > 0:
            self.metric_cards['active_threats'].set_alert_state(True)
        else:
            self.metric_cards['active_threats'].set_alert_state(False)
        
        self.metric_cards['vulnerabilities'].update_value(
            str(data.get('totalVulnerabilities', 0)),
            self._format_change(data.get('vulnerabilitiesChange', 0))
        )
        
        avg_risk = data.get('averageRiskScore', 0)
        self.metric_cards['risk_score'].update_value(
            f"{avg_risk:.1f}",
            self._get_risk_level_text(avg_risk)
        )
    
    def _update_charts(self):
        if not self._analytics_data:
            return
        
        data = self._analytics_data
        
        trends_data = data.get('vulnerabilityTrends', [])
        if trends_data:
            chart_data = []
            for point in trends_data[-30:]:  
                chart_data.append({
                    'x': point.get('date', ''),
                    'y': point.get('count', 0)
                })
            self.charts['vulnerability_trends'].update_data(chart_data)
        
        risk_dist = data.get('riskDistribution', {})
        
        levels = [
            ("CRITICAL", "Critical", "#dc2626"),
            ("HIGH", "High", "#ea580c"),
            ("MEDIUM", "Medium", "#ca8a04"),
            ("LOW", "Low", "#1f8f73"),
        ]
        
        chart_data = []
        threat_data = []
        for key, label, color in levels:
            count = 0
            if risk_dist:
                if key in risk_dist:
                    count = risk_dist[key]
                elif key.lower() in risk_dist:
                    count = risk_dist[key.lower()]
                elif key.title() in risk_dist:
                    count = risk_dist[key.title()]

            chart_data.append({
                'label': label,
                'value': count,
                'color': color,
            })

            threat_data.append({
                'label': label,
                'value': count,
                'color': color,
            })
            
        self.charts['risk_distribution'].update_data(chart_data)
        if hasattr(self, 'threat_overview_widget'):
            self.threat_overview_widget.update_data(threat_data)

        recent_scans = data.get('recentScans', []) or []
        if hasattr(self, 'recent_scans_widget') and recent_scans:
            items = list(recent_scans[-7:])
            
            try:
                while len(items) < 4:
                    first_date = (items[0].get('date') or '')[:10]
                    base = datetime.strptime(first_date, "%Y-%m-%d")
                    prev = (base - timedelta(days=1)).strftime("%Y-%m-%d")
                    items.insert(0, {'date': prev, 'count': 0})
            except Exception:
                items = recent_scans
            
            mapped = [
                {
                    'label': (item.get('date') or '')[-2:],
                    'value': item.get('count', 0),
                }
                for item in items
            ]
            self.recent_scans_widget.update_data(mapped)
    
    def _format_change(self, change: float) -> str:
        if change > 0:
            return f"↗ +{change:.1f}%"
        elif change < 0:
            return f"↘ {change:.1f}%"
        else:
            return "→ No change"
    
    def _get_risk_level_text(self, risk_score: float) -> str:
        if risk_score >= 80:
            return "Critical Risk"
        elif risk_score >= 60:
            return "High Risk"
        elif risk_score >= 30:
            return "Medium Risk"
        else:
            return "Low Risk"
    
    def _set_loading_state(self, loading: bool):
        pass
    
    def _show_error_state(self, error_message: str):
        self.main_window.set_status_message(f"Dashboard error: {error_message}")
    
    def on_view_activated(self):
        if (self._last_refresh is None or 
            datetime.now() - self._last_refresh > timedelta(minutes=5)):
            self.refresh()
