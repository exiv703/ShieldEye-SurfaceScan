#!/usr/bin/env python3

import threading
import gi
gi.require_version('Gtk', '3.0')
from gi.repository import Gtk, GLib
from ..components.metric_card import MetricCard


class AnalyticsView(Gtk.ScrolledWindow):
    
    def __init__(self, main_window):
        super().__init__()
        
        self.main_window = main_window
        self.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
        
        main_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=24)
        main_box.set_margin_left(24)
        main_box.set_margin_right(24)
        main_box.set_margin_top(24)
        main_box.set_margin_bottom(24)
        self.add(main_box)
        
        self.metric_cards = {}

        header = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL)
        title_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4)
        title = Gtk.Label()
        title.set_markup('<span size="xx-large" weight="bold">Detailed Analytics</span>')
        title.set_xalign(0)
        title_box.pack_start(title, False, False, 0)
        subtitle = Gtk.Label(label="In-depth analysis of security posture and performance")
        subtitle.set_xalign(0)
        subtitle.get_style_context().add_class('text-secondary')
        title_box.pack_start(subtitle, False, False, 0)
        header.pack_start(title_box, True, True, 0)

        refresh_btn = Gtk.Button.new_with_label("Refresh")
        refresh_btn.connect('clicked', self._on_refresh_clicked)
        header.pack_end(refresh_btn, False, False, 0)
        main_box.pack_start(header, False, False, 0)

        metrics_grid = Gtk.Grid()
        metrics_grid.set_column_spacing(16)
        metrics_grid.set_column_homogeneous(True)

        self.metric_cards['total_scans'] = MetricCard("Total Scans", "0", "", "📊")
        metrics_grid.attach(self.metric_cards['total_scans'], 0, 0, 1, 1)
        
        self.metric_cards['avg_duration'] = MetricCard("Avg Duration", "0s", "Per scan", "⏱️")
        metrics_grid.attach(self.metric_cards['avg_duration'], 1, 0, 1, 1)
        
        self.metric_cards['libraries'] = MetricCard("Libraries Analyzed", "0", "Total detected", "📚")
        metrics_grid.attach(self.metric_cards['libraries'], 2, 0, 1, 1)
        
        main_box.pack_start(metrics_grid, False, False, 0)

        columns_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=24)
        columns_box.set_homogeneous(True)
        
        left_col = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        
        vuln_title = Gtk.Label()
        vuln_title.set_markup('<span size="large" weight="bold">Top Vulnerabilities</span>')
        vuln_title.set_xalign(0)
        left_col.pack_start(vuln_title, False, False, 0)
        
        vuln_frame = Gtk.Frame()
        vuln_frame.set_shadow_type(Gtk.ShadowType.NONE)
        vuln_frame.get_style_context().add_class('card')
        
        self.vuln_list = Gtk.ListBox()
        self.vuln_list.set_selection_mode(Gtk.SelectionMode.NONE)
        self.vuln_list.get_style_context().add_class('results-list') # Reuse existing style
        vuln_frame.add(self.vuln_list)
        left_col.pack_start(vuln_frame, True, True, 0)
        
        columns_box.pack_start(left_col, True, True, 0)
        
        right_col = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        
        risk_title = Gtk.Label()
        risk_title.set_markup('<span size="large" weight="bold">Risk Distribution</span>')
        risk_title.set_xalign(0)
        right_col.pack_start(risk_title, False, False, 0)
        
        risk_frame = Gtk.Frame()
        risk_frame.set_shadow_type(Gtk.ShadowType.NONE)
        risk_frame.get_style_context().add_class('card')

        self.risk_list = Gtk.ListBox()
        self.risk_list.set_selection_mode(Gtk.SelectionMode.NONE)
        self.risk_list.get_style_context().add_class('results-list')
        risk_frame.add(self.risk_list)
        right_col.pack_start(risk_frame, True, True, 0)
        
        columns_box.pack_start(right_col, True, True, 0)
        
        main_box.pack_start(columns_box, True, True, 0)

        self.status_label = Gtk.Label(label="")
        self.status_label.set_xalign(0)
        self.status_label.get_style_context().add_class('text-secondary')
        main_box.pack_end(self.status_label, False, False, 0)

    def on_view_activated(self):
        self.refresh()

    def _on_refresh_clicked(self, button):
        self.refresh()

    def refresh(self):
        self.status_label.set_text("Loading detailed analytics...")
        threading.Thread(target=self._load_summary, daemon=True).start()

    def _load_summary(self):
        resp = self.main_window.api_client.get_analytics_summary()
        if resp.success and isinstance(resp.data, dict):
            GLib.idle_add(self._update_ui, resp.data)
        else:
            GLib.idle_add(self._set_unavailable)

    def _update_ui(self, data):
        scans = data.get('totalScans', 0)
        duration = data.get('avgScanDurationSeconds', 0)
        libs = data.get('libraries_analyzed', 0)
        
        self.metric_cards['total_scans'].update_value(str(scans), "")
        self.metric_cards['avg_duration'].update_value(f"{duration:.1f}s", "")
        self.metric_cards['libraries'].update_value(str(libs), "")
        
        for row in self.vuln_list.get_children():
            self.vuln_list.remove(row)
            
        top_vulns = data.get('top_vulnerabilities', [])
        if top_vulns:
            for v in top_vulns[:5]: 
                self._add_list_row(self.vuln_list, v.get('name', 'Unknown'), v.get('count', 0), v.get('severity'))
        else:
            self._add_placeholder(self.vuln_list, "No top vulnerabilities data")
            
        for row in self.risk_list.get_children():
            self.risk_list.remove(row)
            
        dist = data.get('riskDistribution', {})
        for level in ['critical', 'high', 'medium', 'low']:
            count = dist.get(level, 0)
            self._add_list_row(self.risk_list, level.title(), count, level)
            
        self.status_label.set_text("")

    def _add_list_row(self, listbox, title, count, severity=None):
        row = Gtk.ListBoxRow()
        box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=12)
        
        # Title
        lbl = Gtk.Label(label=str(title))
        lbl.set_xalign(0)
        box.pack_start(lbl, True, True, 0)
        
        # Badge if severity
        if severity:
            sev_lbl = Gtk.Label(label=severity.upper())
            sev_lbl.get_style_context().add_class('severity-badge')
            # Map severity to CSS class
            s = str(severity).lower()
            if 'critical' in s: sev_lbl.get_style_context().add_class('severity-critical')
            elif 'high' in s: sev_lbl.get_style_context().add_class('severity-high')
            elif 'medium' in s: sev_lbl.get_style_context().add_class('severity-medium')
            elif 'low' in s: sev_lbl.get_style_context().add_class('severity-low')
            else: sev_lbl.get_style_context().add_class('severity-info')
            box.pack_start(sev_lbl, False, False, 0)
            
        # Count
        count_lbl = Gtk.Label(label=str(count))
        count_lbl.get_style_context().add_class('text-secondary')
        box.pack_end(count_lbl, False, False, 0)
        
        row.add(box)
        listbox.add(row)
        listbox.show_all()

    def _add_placeholder(self, listbox, text):
        row = Gtk.ListBoxRow()
        lbl = Gtk.Label(label=text)
        lbl.get_style_context().add_class('text-tertiary')
        lbl.set_padding(0, 12)
        row.add(lbl)
        listbox.add(row)
        listbox.show_all()

    def _set_unavailable(self):
        self.status_label.set_text("Analytics unavailable. Check connection.")
