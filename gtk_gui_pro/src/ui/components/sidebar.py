#!/usr/bin/env python3

from typing import Dict, Optional
import gi

gi.require_version('Gtk', '3.0')
from gi.repository import Gtk, GLib

class SidebarItem(Gtk.Box):
    
    def __init__(self, icon: str, label: str, view_name: str, parent_sidebar):
        super().__init__(orientation=Gtk.Orientation.HORIZONTAL, spacing=12)
        
        self.view_name = view_name
        self.parent_sidebar = parent_sidebar
        self.is_active = False
        
        self.get_style_context().add_class('sidebar-item')
        
        icon_label = Gtk.Label(label=icon)
        icon_label.set_size_request(24, 24)
        self.pack_start(icon_label, False, False, 0)
        
        text_label = Gtk.Label(label=label)
        text_label.set_xalign(0)
        self.pack_start(text_label, True, True, 0)
        
        self.event_box = Gtk.EventBox()
        self.event_box.add(self)
        self.event_box.connect('button-press-event', self._on_click)
        self.event_box.connect('enter-notify-event', self._on_enter)
        self.event_box.connect('leave-notify-event', self._on_leave)
        
        self.set_margin_left(8)
        self.set_margin_right(8)
        self.set_margin_top(2)
        self.set_margin_bottom(2)
        
        self.show_all()
    
    def _on_click(self, widget, event):
        self.parent_sidebar.select_item(self.view_name)
        return True
    
    def _on_enter(self, widget, event):
        return False
    
    def _on_leave(self, widget, event):
        return False
    
    def set_active(self, active: bool):
        self.is_active = active
        if active:
            self.get_style_context().add_class('sidebar-item-active')
        else:
            self.get_style_context().remove_class('sidebar-item-active')
    
    def get_widget(self):
        return self.event_box

class QuickActionButton(Gtk.Button):
    
    def __init__(self, icon: str, tooltip: str, callback, use_icon_name: bool = False):
        super().__init__()
        
        self.callback = callback
        
        self.get_style_context().add_class('quick-action-btn')
        self.set_tooltip_text(tooltip)
        self.set_relief(Gtk.ReliefStyle.NONE)
        
        if use_icon_name:
            icon_image = Gtk.Image.new_from_icon_name(icon, Gtk.IconSize.BUTTON)
            icon_image.get_style_context().add_class('quick-action-icon')
            self.add(icon_image)
        else:
            icon_label = Gtk.Label(label=icon)
            icon_label.get_style_context().add_class('quick-action-icon')
            self.add(icon_label)
        
        self.connect('clicked', self._on_clicked)
    
    def _on_clicked(self, button):
        if self.callback:
            self.callback()

class Sidebar(Gtk.Box):
    
    def __init__(self, main_window):
        super().__init__(orientation=Gtk.Orientation.VERTICAL, spacing=0)
        
        self.main_window = main_window
        self.api_client = main_window.api_client
        
        self.nav_items: Dict[str, SidebarItem] = {}
        self.current_selection = "dashboard"
        
        self.pulse_opacity = 1.0
        self.pulse_direction = -1
        
        self.get_style_context().add_class('sidebar')
        self.set_size_request(280, -1)
        
        self._build_ui()
        
        GLib.timeout_add(100, self._pulse_checking_status)
        GLib.timeout_add_seconds(30, self._update_stats)
        
        self.show_all()
    
    def _build_ui(self):
        header = self._create_header()
        self.pack_start(header, False, False, 0)
        
        nav_section = self._create_navigation_section()
        self.pack_start(nav_section, False, False, 8)
        
        actions_section = self._create_quick_actions_section()
        self.pack_start(actions_section, False, False, 8)
        
        stats_section = self._create_stats_section()
        self.pack_start(stats_section, False, False, 8)
        
        spacer = Gtk.Box()
        self.pack_start(spacer, True, True, 0)
        
        footer = self._create_footer()
        self.pack_end(footer, False, False, 0)
    
    def _create_header(self):
        header = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        header.get_style_context().add_class('sidebar-header')
        header.set_margin_left(16)
        header.set_margin_right(16)
        header.set_margin_top(16)
        header.set_margin_bottom(8)
        
        logo_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=12)
        
        logo = Gtk.Label(label="🛡️")
        logo_box.pack_start(logo, False, False, 0)
        
        title = Gtk.Label(label="ShieldEye SurfaceScan")
        title.get_style_context().add_class('sidebar-title')
        title.set_xalign(0)
        logo_box.pack_start(title, True, True, 0)
        
        header.pack_start(logo_box, False, False, 0)
        
        subtitle = Gtk.Label(label="Web Surface Security Scanner")
        subtitle.get_style_context().add_class('sidebar-subtitle')
        subtitle.set_xalign(0)
        header.pack_start(subtitle, False, False, 0)
        
        return header
    
    def _create_navigation_section(self):
        section = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=2)
        section.get_style_context().add_class('sidebar-section')
        
        title = Gtk.Label(label="NAVIGATION")
        title.get_style_context().add_class('sidebar-section-title')
        title.set_xalign(0)
        title.set_margin_left(16)
        title.set_margin_bottom(10)
        section.pack_start(title, False, False, 0)
        
        nav_items = [
            ("📊", "Dashboard", "dashboard"),
            ("🔍", "New Scan", "scan"),
            ("📋", "Results", "results"),
            ("📈", "Analytics", "analytics"),
            ("🧪", "Injection Lab", "injection"),
            ("🛡️", "Hardening", "hardening"),
            ("⚙️", "Settings", "settings")
        ]
        
        for icon, label, view_name in nav_items:
            item = SidebarItem(icon, label, view_name, self)
            self.nav_items[view_name] = item
            widget = item.get_widget()
            if view_name == "results" and getattr(self.main_window, "get_current_scan_id", None):
                if self.main_window.get_current_scan_id() is None:
                    widget.set_visible(False)
            section.pack_start(widget, False, False, 0)
        
        self.nav_items["dashboard"].set_active(True)
        
        return section

    def set_results_visible(self, visible: bool):
        item = self.nav_items.get("results")
        if not item:
            return
        widget = item.get_widget()
        widget.set_visible(visible)
    
    def _create_quick_actions_section(self):
        section = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        section.get_style_context().add_class('sidebar-section')
        section.set_margin_left(16)
        section.set_margin_right(16)
        
        title = Gtk.Label(label="QUICK ACTIONS")
        title.get_style_context().add_class('sidebar-section-title')
        title.set_xalign(0)
        title.set_margin_bottom(8)
        section.pack_start(title, False, False, 0)
        
        actions_grid = Gtk.Grid()
        actions_grid.set_column_spacing(16)  
        actions_grid.set_row_spacing(16)     
        actions_grid.set_column_homogeneous(True)
        
        new_scan_btn = QuickActionButton(
            "list-add-symbolic", "Start New Scan (Ctrl+N)", 
            self.main_window.show_new_scan_dialog,
            use_icon_name=True
        )
        actions_grid.attach(new_scan_btn, 0, 0, 1, 1)
        
        export_btn = QuickActionButton(
            "document-save-symbolic", "Export Results", 
            lambda: self.main_window.show_export_dialog(),
            use_icon_name=True
        )
        actions_grid.attach(export_btn, 1, 0, 1, 1)
        
        refresh_btn = QuickActionButton(
            "view-refresh-symbolic", "Refresh View (Ctrl+R)", 
            self.main_window.refresh_current_view,
            use_icon_name=True
        )
        actions_grid.attach(refresh_btn, 0, 1, 1, 1)
        
        help_btn = QuickActionButton(
            "help-contents-symbolic", "Help & Support", 
            self._show_help,
            use_icon_name=True
        )
        actions_grid.attach(help_btn, 1, 1, 1, 1)
        
        section.pack_start(actions_grid, False, False, 0)
        
        return section
    
    def _create_stats_section(self):
        section = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        section.get_style_context().add_class('sidebar-section')
        section.set_margin_left(16)
        section.set_margin_right(16)
        
        title = Gtk.Label(label="SYSTEM STATUS")
        title.get_style_context().add_class('sidebar-section-title')
        title.set_xalign(0)
        title.set_margin_bottom(8)
        section.pack_start(title, False, False, 0)
        
        stats_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4)
        
        self.api_status_box = self._create_stat_item("API Status", "Checking...", "🔗")
        self.api_status_box.value_widget.get_style_context().add_class('stat-value-checking')
        stats_box.pack_start(self.api_status_box, False, False, 0)
        
        self.queue_status_box = self._create_stat_item("Queue", "0 pending", "⏳")
        stats_box.pack_start(self.queue_status_box, False, False, 0)
        
        section.pack_start(stats_box, False, False, 0)
        
        return section
    
    def _create_stat_item(self, label: str, value: str, icon: str):
        item = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=10)
        item.get_style_context().add_class('stat-item')
        item.set_margin_bottom(4)
        
        icon_label = Gtk.Label(label=icon)
        icon_label.get_style_context().add_class('stat-icon')
        item.pack_start(icon_label, False, False, 0)
        
        content = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=3)
        
        label_widget = Gtk.Label(label=label)
        label_widget.get_style_context().add_class('stat-label')
        label_widget.set_xalign(0)
        content.pack_start(label_widget, False, False, 0)
        
        value_widget = Gtk.Label(label=value)
        value_widget.get_style_context().add_class('stat-value')
        value_widget.set_xalign(0)
        content.pack_start(value_widget, False, False, 0)
        
        item.pack_start(content, True, True, 0)
        
        item.value_widget = value_widget
        
        return item
    
    def _create_footer(self):
        footer = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4)
        footer.set_margin_left(16)
        footer.set_margin_right(16)
        footer.set_margin_bottom(16)
        
        version = Gtk.Label(label="Version 2.0.0")
        version.set_xalign(0)
        footer.pack_start(version, False, False, 0)
        
        copyright_label = Gtk.Label(label=" 2025 ShieldEye SurfaceScan")
        copyright_label.set_xalign(0)
        footer.pack_start(copyright_label, False, False, 0)
        
        return footer
    
    def select_item(self, view_name: str):
        if view_name == self.current_selection:
            return
        
        if self.current_selection in self.nav_items:
            self.nav_items[self.current_selection].set_active(False)
        
        if view_name in self.nav_items:
            self.nav_items[view_name].set_active(True)
            self.current_selection = view_name
            
            self.main_window.switch_view(view_name)
    
    def update_selection(self, view_name: str):
        if view_name == self.current_selection:
            return
        
        if self.current_selection in self.nav_items:
            self.nav_items[self.current_selection].set_active(False)
        
        if view_name in self.nav_items:
            self.nav_items[view_name].set_active(True)
            self.current_selection = view_name
    
    def _pulse_checking_status(self):
        if not hasattr(self, 'api_status_box'):
            return False
            
        current_text = self.api_status_box.value_widget.get_text()
        if "Checking" not in current_text:
            self.api_status_box.value_widget.set_opacity(1.0)
            return True  
        
        self.pulse_opacity += self.pulse_direction * 0.05
        if self.pulse_opacity <= 0.4:
            self.pulse_direction = 1
        elif self.pulse_opacity >= 1.0:
            self.pulse_direction = -1
        
        self.api_status_box.value_widget.set_opacity(self.pulse_opacity)
        return True  
    
    def _update_stats(self):
        def update_api_status():
            if self.api_client.is_connected:
                self.api_status_box.value_widget.set_text("Connected")
                self.api_status_box.value_widget.set_opacity(1.0)  
                self.api_status_box.value_widget.get_style_context().remove_class('stat-value-checking')
                self.api_status_box.value_widget.get_style_context().add_class('stat-success')
            else:
                self.api_status_box.value_widget.set_text("Disconnected")
                self.api_status_box.value_widget.set_opacity(1.0)  
                self.api_status_box.value_widget.get_style_context().remove_class('stat-value-checking')
                self.api_status_box.value_widget.get_style_context().remove_class('stat-success')
                self.api_status_box.value_widget.get_style_context().add_class('stat-error')
        
        def update_queue_status():
            response = self.api_client.get_queue_stats()
            if response.success:
                stats = response.data
                pending = stats.get('waiting', 0)
                active = stats.get('active', 0)
                total = pending + active
                self.queue_status_box.value_widget.set_text(f"{total} active")
            else:
                self.queue_status_box.value_widget.set_text("Unknown")
        
        GLib.idle_add(update_api_status)
        
        import threading
        threading.Thread(target=update_queue_status, daemon=True).start()
        
        return True
    
    def _show_help(self):
        dialog = Gtk.MessageDialog(
            transient_for=self.main_window,
            flags=Gtk.DialogFlags.MODAL,
            message_type=Gtk.MessageType.INFO,
            buttons=Gtk.ButtonsType.OK,
            text="ShieldEye Professional Help"
        )
        
        help_text = """
ShieldEye Professional - Web Security Scanner

Keyboard Shortcuts:
• Ctrl+N: New Scan
• Ctrl+R: Refresh View
• Ctrl+,: Settings

For more help, visit: https://shieldeye.com/docs
        """
        
        dialog.format_secondary_text(help_text.strip())
        dialog.run()
        dialog.destroy()
