#!/usr/bin/env python3

import gi
gi.require_version('Gtk', '3.0')
from gi.repository import Gtk
from services.api_client import ScanRequest


class ScanView(Gtk.Box):
    
    def __init__(self, main_window):
        super().__init__(orientation=Gtk.Orientation.VERTICAL, spacing=24)
        
        self.main_window = main_window
        self.set_margin_left(24)
        self.set_margin_right(24)
        self.set_margin_top(24)
        self.set_margin_bottom(24)
        
        self._build_ui()
    
    def _build_ui(self):
        center_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=20)
        center_box.set_valign(Gtk.Align.CENTER)
        center_box.set_halign(Gtk.Align.CENTER)
        center_box.set_size_request(720, -1)
        
        title_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4)
        title = Gtk.Label()
        title.set_markup('<span size="xx-large" weight="bold">New Security Scan</span>')
        title.set_xalign(0.5)
        title_box.pack_start(title, False, False, 0)
        
        subtitle = Gtk.Label(label="Configure and launch a new security assessment")
        subtitle.get_style_context().add_class('text-secondary')
        subtitle.set_xalign(0.5)
        title_box.pack_start(subtitle, False, False, 0)
        
        center_box.pack_start(title_box, False, False, 0)
        
        card = Gtk.Frame()
        card.set_shadow_type(Gtk.ShadowType.NONE)
        card.get_style_context().add_class('card')
        
        form_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=16)
        form_box.set_margin_top(24)
        form_box.set_margin_bottom(24)
        form_box.set_margin_left(24)
        form_box.set_margin_right(24)
        form_box.set_hexpand(True)
        
        url_label = Gtk.Label(label="Target URL")
        url_label.set_xalign(0)
        url_label.get_style_context().add_class('text-secondary')
        form_box.pack_start(url_label, False, False, 0)
        
        self.url_entry = Gtk.Entry()
        self.url_entry.set_placeholder_text("https://example.com")
        self.url_entry.set_hexpand(True)
        self.url_entry.connect('activate', self._on_start_scan)
        form_box.pack_start(self.url_entry, False, False, 0)
        
        url_helper = Gtk.Label(label="Include protocol. Both http and https are supported.")
        url_helper.get_style_context().add_class('form-helper')
        url_helper.set_xalign(0)
        form_box.pack_start(url_helper, False, False, 0)
        
        opts_label = Gtk.Label(label="Scan Options")
        opts_label.set_xalign(0)
        opts_label.get_style_context().add_class('text-secondary')
        form_box.pack_start(opts_label, False, False, 0)
        
        opts_grid = Gtk.Grid()
        opts_grid.set_column_spacing(20)
        opts_grid.set_row_spacing(12)
        opts_grid.set_column_homogeneous(False)
        
        self.render_js_check = Gtk.CheckButton.new_with_label("Render JavaScript")
        self.render_js_check.set_active(True)
        self.render_js_check.set_tooltip_text("Execute client-side JavaScript to find DOM-based vulnerabilities")
        opts_grid.attach(self.render_js_check, 0, 0, 2, 1)
        
        crawl_label = Gtk.Label(label="Crawl Depth")
        crawl_label.set_xalign(0)
        crawl_label.get_style_context().add_class('text-secondary')
        crawl_adj = Gtk.Adjustment(1, 0, 5, 1, 1, 0)
        self.crawl_spin = Gtk.SpinButton.new(crawl_adj, 1, 0)
        self.crawl_spin.set_numeric(True)
        self.crawl_spin.set_width_chars(3)
        opts_grid.attach(crawl_label, 0, 1, 1, 1)
        opts_grid.attach(self.crawl_spin, 1, 1, 1, 1)

        crawl_helper = Gtk.Label(label="How many link levels to follow from the start URL.")
        crawl_helper.get_style_context().add_class('form-helper')
        crawl_helper.set_xalign(0)
        opts_grid.attach(crawl_helper, 0, 2, 2, 1)
        
        timeout_label = Gtk.Label(label="Timeout (ms)")
        timeout_label.set_xalign(0)
        timeout_label.get_style_context().add_class('text-secondary')
        timeout_adj = Gtk.Adjustment(30000, 5000, 300000, 5000, 10000, 0)
        self.timeout_spin = Gtk.SpinButton.new(timeout_adj, 1000, 0)
        self.timeout_spin.set_numeric(True)
        self.timeout_spin.set_width_chars(6)
        opts_grid.attach(timeout_label, 0, 3, 1, 1)
        opts_grid.attach(self.timeout_spin, 1, 3, 1, 1)

        timeout_helper = Gtk.Label(label="Maximum time to wait for server responses during crawling.")
        timeout_helper.get_style_context().add_class('form-helper')
        timeout_helper.set_xalign(0)
        opts_grid.attach(timeout_helper, 0, 4, 2, 1)
        
        form_box.pack_start(opts_grid, False, False, 0)
        
        scan_btn = Gtk.Button.new_with_label("🚀 Start Security Scan")
        scan_btn.get_style_context().add_class('primary')
        scan_btn.set_margin_top(16)
        scan_btn.connect('clicked', self._on_start_scan)
        form_box.pack_start(scan_btn, False, False, 0)
        
        card.add(form_box)
        center_box.pack_start(card, False, False, 0)
        
        self.progress_bar = Gtk.ProgressBar()
        self.progress_bar.set_show_text(True)
        self.progress_bar.set_text("Ready to scan")
        center_box.pack_start(self.progress_bar, False, False, 0)
        
        self.pack_start(center_box, True, True, 0)
    
    def update_scan_status(self, scan_id: str, status: str, progress: int, stage: str = None):
        self.progress_bar.set_fraction(progress / 100.0)
        stage_txt = ""
        if stage:
            stage_pretty = str(stage).replace("_", " ").strip().title()
            if stage_pretty:
                stage_txt = f" ({stage_pretty})"
        self.progress_bar.set_text(f"{status.title()} - {progress}%{stage_txt}")

    def _on_start_scan(self, widget):
        url = (self.url_entry.get_text() or "").strip()
        if not (url.startswith("http://") or url.startswith("https://")):
            self.main_window.app.show_error_dialog(
                "Invalid URL",
                "Please enter a valid URL starting with http:// or https://",
                self.main_window,
            )
            return
        
        # Update UI and start scan
        self.progress_bar.set_fraction(0.0)
        self.progress_bar.set_text("Initializing...")
        request = ScanRequest(
            url=url,
            render_javascript=self.render_js_check.get_active(),
            crawl_depth=int(self.crawl_spin.get_value()),
            timeout=int(self.timeout_spin.get_value())
        )
        self.main_window.start_scan(request)
