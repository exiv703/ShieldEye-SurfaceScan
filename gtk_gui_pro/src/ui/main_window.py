#!/usr/bin/env python3

import threading
import json
from typing import Optional, Dict, Any
import gi

gi.require_version('Gtk', '3.0')
gi.require_version('Gdk', '3.0')
from gi.repository import Gtk, Gdk, GLib, Pango

from .components.sidebar import Sidebar
from .components.header_bar import HeaderBar
from .components.status_bar import StatusBar
from .views.dashboard_view import DashboardView
from .views.scan_view import ScanView
from .views.results_view import ResultsView
from .views.analytics_view import AnalyticsView
from .views.settings_view import SettingsView
from .views.injection_view import InjectionView
from .views.hardening_view import HardeningView
from .dialogs.scan_dialog import ScanDialog
from .dialogs.export_dialog import ExportDialog
from ..services.api_client import ScanRequest

class MainWindow(Gtk.ApplicationWindow):
    def __init__(self, app):
        super().__init__(application=app)
        
        self.app = app
        self.api_client = app.get_service('api')
        self.settings = app.get_service('settings')
        self.logger = app.get_service('logger')
        
        self.set_title("ShieldEye SurfaceScan")
        self.set_default_size(1600, 1150)
        self.set_position(Gtk.WindowPosition.CENTER)
        
        self.current_view = "dashboard"
        self.current_scan_id: Optional[str] = None
        self.scan_polling_active = False
        self._status_timer = None
        
        self.header_bar: Optional[HeaderBar] = None
        self.sidebar: Optional[Sidebar] = None
        self.status_bar: Optional[StatusBar] = None
        self.main_stack: Optional[Gtk.Stack] = None
        
        self.views: Dict[str, Gtk.Widget] = {}
        
        self._build_ui()
        self._setup_signals()
        self._setup_api_callbacks()
        
        self.get_style_context().add_class('main-window')
        
        self.show_all()

        try:
            GLib.idle_add(self.sidebar.set_results_visible, False)
        except Exception:
            pass
        
        self._start_api_monitoring()
        
        self.logger.info("Main window initialized")
    
    def _build_ui(self):
        main_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        main_box.get_style_context().add_class('app-container')
        self.add(main_box)
        
        self.header_bar = HeaderBar(self)
        self.set_titlebar(self.header_bar)
        
        content_paned = Gtk.Paned(orientation=Gtk.Orientation.HORIZONTAL)
        content_paned.set_position(280)  # Sidebar width
        main_box.pack_start(content_paned, True, True, 0)
        
        self.sidebar = Sidebar(self)
        try:
            self.sidebar.set_results_visible(False)
        except Exception:
            pass
        content_paned.pack1(self.sidebar, False, False)
        
        content_area = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        content_area.get_style_context().add_class('content-area')
        content_paned.pack2(content_area, True, False)
        
        self.main_stack = Gtk.Stack()
        self.main_stack.set_transition_type(Gtk.StackTransitionType.SLIDE_LEFT_RIGHT)
        self.main_stack.set_transition_duration(200)
        content_area.pack_start(self.main_stack, True, True, 0)
        
        self._initialize_views()
        
        self.status_bar = StatusBar(self)
        main_box.pack_end(self.status_bar, False, False, 0)
    
    def _initialize_views(self):
        self.views['dashboard'] = DashboardView(self)
        self.main_stack.add_titled(self.views['dashboard'], 'dashboard', 'Dashboard')
        
        self.views['scan'] = ScanView(self)
        self.main_stack.add_titled(self.views['scan'], 'scan', 'New Scan')
        
        self.views['results'] = ResultsView(self)
        self.main_stack.add_titled(self.views['results'], 'results', 'Results')
        
        self.views['analytics'] = AnalyticsView(self)
        self.main_stack.add_titled(self.views['analytics'], 'analytics', 'Analytics')
        
        self.views['injection'] = InjectionView(self)
        self.main_stack.add_titled(self.views['injection'], 'injection', 'Injection Lab')
        
        self.views['hardening'] = HardeningView(self)
        self.main_stack.add_titled(self.views['hardening'], 'hardening', 'Hardening')
        
        self.views['settings'] = SettingsView(self)
        self.main_stack.add_titled(self.views['settings'], 'settings', 'Settings')
        
        self.main_stack.set_visible_child_name('dashboard')
    
    def _setup_signals(self):
        self.connect('delete-event', self._on_delete_event)
        self.connect('key-press-event', self._on_key_press)
        
        self.main_stack.connect('notify::visible-child-name', self._on_view_changed)
    
    def _setup_api_callbacks(self):
        self.api_client.add_status_callback(self._on_api_status_changed)
        try:
            GLib.idle_add(self.status_bar.update_connection_status, self.api_client.is_connected)
        except Exception:
            pass
    
    def _on_delete_event(self, widget, event):
        self.logger.info("Main window closing")
        
        self.scan_polling_active = False
        
        width, height = self.get_size()
        self.settings.set('window_width', width)
        self.settings.set('window_height', height)
        
        return False
    
    def _on_key_press(self, widget, event):
        keyval = event.keyval
        state = event.state
        
        if (state & Gdk.ModifierType.CONTROL_MASK and 
            keyval == Gdk.KEY_n):
            self.show_new_scan_dialog()
            return True
        
        if (state & Gdk.ModifierType.CONTROL_MASK and 
            keyval == Gdk.KEY_r):
            self.refresh_current_view()
            return True
        
        if (state & Gdk.ModifierType.CONTROL_MASK and 
            keyval == Gdk.KEY_comma):
            self.switch_view('settings')
            return True
        
        return False
    
    def _on_view_changed(self, stack, param):
        new_view = stack.get_visible_child_name()
        if new_view != self.current_view:
            self.current_view = new_view
            self.sidebar.update_selection(new_view)
            
            if hasattr(self.views[new_view], 'on_view_activated'):
                self.views[new_view].on_view_activated()
            
            self.logger.debug(f"Switched to view: {new_view}")
    
    def _on_api_status_changed(self, connected: bool):
        GLib.idle_add(self.status_bar.update_connection_status, connected)
        
        if connected:
            self.logger.info("API connection established")
        else:
            self.logger.warning("API connection lost")
    
    def switch_view(self, view_name: str):
        if view_name in self.views:
            self.main_stack.set_visible_child_name(view_name)
        else:
            self.logger.warning(f"Unknown view: {view_name}")
    
    def refresh_current_view(self):
        current_view = self.views.get(self.current_view)
        if current_view and hasattr(current_view, 'refresh'):
            current_view.refresh()
    
    def show_new_scan_dialog(self):
        dialog = ScanDialog(self)
        response = dialog.run()
        
        if response == Gtk.ResponseType.OK:
            scan_request = dialog.get_scan_request()
            dialog.destroy()
            self.start_scan(scan_request)
        else:
            dialog.destroy()
    
    def start_scan(self, scan_request: ScanRequest):
        self.logger.info(f"Starting scan for: {scan_request.url}")
        
        self.switch_view('scan')
        
        threading.Thread(
            target=self._perform_scan,
            args=(scan_request,),
            daemon=True
        ).start()
    
    def _perform_scan(self, scan_request: ScanRequest):
        try:
            self.logger.info(f"[Thread:{threading.get_ident()}] Attempting to create scan via API for URL: {scan_request.url}")
            
            response = self.api_client.create_scan(scan_request)
            
            self.logger.info(f"[Thread:{threading.get_ident()}] API response received: success={response.success}, status_code={response.status_code}, error={response.error}")

            if not response or not response.success:
                error_message = response.error if response else "No response from API"
                self.logger.error(f"[Thread:{threading.get_ident()}] Failed to create scan: {error_message}")
                GLib.idle_add(self._show_scan_error, f"Failed to create scan: {error_message}")
                return

            scan_data = response.data
            if not scan_data or 'id' not in scan_data:
                self.logger.error(f"[Thread:{threading.get_ident()}] Invalid data in API response: {scan_data}")
                GLib.idle_add(self._show_scan_error, "Invalid data received from API")
                return

            self.current_scan_id = scan_data.get('id')
            self.logger.info(f"[Thread:{threading.get_ident()}] Scan created with ID: {self.current_scan_id}")

            GLib.idle_add(self.views['scan'].update_scan_status, self.current_scan_id, 'pending', 0)

            self.scan_polling_active = True
            self._poll_scan_status()

        except Exception as e:
            self.logger.error(f"[Thread:{threading.get_ident()}] An unexpected error occurred in the scan thread: {e}", exc_info=True)
            GLib.idle_add(self._show_scan_error, f"An unexpected error occurred: {e}")
    
    def _schedule_scan_status_poll(self, delay_seconds: float):
        if not self.scan_polling_active or not self.current_scan_id:
            return
        if self._status_timer is not None:
            return

        def _run():
            self._status_timer = None
            self._poll_scan_status()

        timer = threading.Timer(delay_seconds, _run)
        timer.daemon = True
        self._status_timer = timer
        timer.start()
    
    def _poll_scan_status(self):
        if not self.scan_polling_active or not self.current_scan_id:
            return
        
        try:
            response = self.api_client.get_scan_status(self.current_scan_id)
            if response.success:
                status_data = response.data
                status = status_data.get('status', 'pending')
                progress = status_data.get('progress', 0)
                stage = status_data.get('stage')
                
                GLib.idle_add(self.views['scan'].update_scan_status,
                             self.current_scan_id, status, progress, stage)
                
                if status in ('completed', 'failed'):
                    self.scan_polling_active = False
                    if status == 'completed':
                        GLib.idle_add(self._load_scan_results)
                    else:
                        error = status_data.get('error', 'Scan failed')
                        GLib.idle_add(self._show_scan_error, error)

                    try:
                        dashboard_view = self.views.get('dashboard')
                        if dashboard_view and hasattr(dashboard_view, 'refresh'):
                            GLib.idle_add(dashboard_view.refresh)
                    except Exception:
                        pass

                    try:
                        analytics_view = self.views.get('analytics')
                        if analytics_view and hasattr(analytics_view, 'refresh'):
                            GLib.idle_add(analytics_view.refresh)
                    except Exception:
                        pass
                    return
            
                if self.scan_polling_active:
                    self._schedule_scan_status_poll(2.0)
            else:
                self.logger.warning(f"Failed to get scan status: {response.error}")
                if self.scan_polling_active:
                    self._schedule_scan_status_poll(5.0)  # Longer delay on error
                
        except Exception as e:
            self.logger.error(f"Status polling error: {e}")
            if self.scan_polling_active:
                self._schedule_scan_status_poll(5.0)
    
    def _load_scan_results(self):
        if not self.current_scan_id:
            return
        
        def load_results():
            try:
                response = self.api_client.get_scan_results(self.current_scan_id)
                if response.success:
                    GLib.idle_add(self._display_results, response.data)
                else:
                    GLib.idle_add(self._show_scan_error, 
                                 f"Failed to load results: {response.error}")
            except Exception as e:
                GLib.idle_add(self._show_scan_error, str(e))
        
        threading.Thread(target=load_results, daemon=True).start()
    
    def _display_results(self, results_data: Dict):
        self.views['results'].display_results(results_data)
        try:
            scan = results_data.get('scan', {}) if isinstance(results_data, dict) else {}
            url = scan.get('url')
            score = scan.get('globalRiskScore')
            if url is not None and score is not None:
                self.app.notifications.show_scan_complete(str(url), float(score))
        except Exception:
            pass
        try:
            self.sidebar.set_results_visible(True)
        except Exception:
            pass
        self.switch_view('results')
    
    def _show_scan_error(self, error_message: str):
        self.app.show_error_dialog("Scan Error", error_message, self)
        
        self.current_scan_id = None
        self.scan_polling_active = False
    
    def show_export_dialog(self, scan_id: str = None):
        target_scan_id = scan_id or self.current_scan_id
        if not target_scan_id:
            self.app.show_error_dialog(
                "Export Error", 
                "No scan selected for export", 
                self
            )
            return
        
        dialog = ExportDialog(self, target_scan_id)
        response = dialog.run()
        if response == Gtk.ResponseType.OK:
            fmt = dialog.get_selected_format()
            if fmt in ("cyclonedx", "vex"):
                results_view = self.views.get('results')
                results = getattr(results_view, '_last_results_data', None)
                if not results:
                    self.app.show_error_dialog("Export Error", "No results loaded to export", self)
                else:
                    try:
                        if fmt == "cyclonedx":
                            content = json.dumps(self._generate_cyclonedx(results), indent=2)
                            self._save_text_via_dialog(content, "sbom-cyclonedx.json")
                        else:
                            content = json.dumps(self._generate_vex(results), indent=2)
                            self._save_text_via_dialog(content, "vex.json")
                        self.set_status_message("Export completed", 3000)
                    except Exception as e:
                        self._show_scan_error(str(e))
            else:
                def do_export():
                    resp = self.api_client.export_scan_report(target_scan_id, fmt)
                    if resp.success:
                        data = resp.data
                        try:
                            if isinstance(data, (dict, list)):
                                text = json.dumps(data, indent=2)
                                GLib.idle_add(self._save_text_via_dialog, text, f"scan_export.{fmt}")
                            else:
                                GLib.idle_add(self._save_text_via_dialog, str(data), f"scan_export.{fmt}")
                            GLib.idle_add(self.set_status_message, "Export completed", 3000)
                        except Exception as e:
                            GLib.idle_add(self._show_scan_error, str(e))
                    else:
                        GLib.idle_add(self._show_scan_error, resp.error or "Export failed")
                threading.Thread(target=do_export, daemon=True).start()
        dialog.destroy()

    def _save_text_via_dialog(self, text: str, suggested: str):
        chooser = Gtk.FileChooserDialog(
            title="Save File",
            transient_for=self,
            action=Gtk.FileChooserAction.SAVE,
            buttons=(Gtk.STOCK_CANCEL, Gtk.ResponseType.CANCEL, Gtk.STOCK_SAVE, Gtk.ResponseType.OK),
        )
        chooser.set_current_name(suggested)
        response = chooser.run()
        if response == Gtk.ResponseType.OK:
            path = chooser.get_filename()
            try:
                with open(path, 'w') as f:
                    f.write(text)
            except Exception as e:
                self._show_scan_error(str(e))
        chooser.destroy()

    def _generate_cyclonedx(self, results: Dict) -> Dict:
        scan = results.get('scan', {}) if isinstance(results, dict) else {}
        libs = results.get('libraries', []) if isinstance(results, dict) else []
        components = []
        for lib in libs:
            name = str(lib.get('name', 'unknown'))
            version = str(lib.get('detectedVersion', ''))
            components.append({
                "type": "library",
                "name": name,
                "version": version or None,
            })
        return {
            "bomFormat": "CycloneDX",
            "specVersion": "1.4",
            "version": 1,
            "metadata": {"tools": [{"name": "ShieldEye"}], "component": {"name": scan.get('url', 'unknown')}} ,
            "components": components,
        }

    def _generate_vex(self, results: Dict) -> Dict:
        scan = results.get('scan', {}) if isinstance(results, dict) else {}
        libs = results.get('libraries', []) if isinstance(results, dict) else []
        findings = []
        for lib in libs:
            entry = {
                "component": {
                    "name": lib.get('name'),
                    "version": lib.get('detectedVersion')
                },
                "riskScore": lib.get('riskScore', 0),
            }
            if 'vulns' in lib:
                entry["vulnerabilities"] = lib.get('vulns')
            findings.append(entry)
        return {
            "vexVersion": "1.0",
            "subject": scan.get('url'),
            "findings": findings
        }
    
    def get_current_scan_id(self) -> Optional[str]:
        return self.current_scan_id
    
    def set_status_message(self, message: str, timeout: int = 5000):
        self.status_bar.set_message(message, timeout)
    
    def _start_api_monitoring(self):
        def check_api_connection():
            try:
                connected = self.api_client.test_connection()
                if connected and not self.api_client.is_connected:
                    self.logger.info("API connection restored")
                    GLib.idle_add(self.set_status_message, "API connection restored", 3000)
                    if self.current_view == "dashboard":
                        GLib.idle_add(self.views['dashboard'].refresh)
                elif not connected and self.api_client.is_connected:
                    self.logger.warning("API connection lost")
                    GLib.idle_add(self.set_status_message, "API connection lost", 3000)
            except Exception as e:
                self.logger.debug(f"API monitoring error: {e}")
            
            return True  # Continue periodic checks
        
        GLib.timeout_add_seconds(10, check_api_connection)
