import threading
import json
import gi
gi.require_version('Gtk', '3.0')
gi.require_version('Gdk', '3.0')
from gi.repository import Gtk, GLib, Gdk


class HardeningView(Gtk.Box):

    def __init__(self, main_window):
        super().__init__(orientation=Gtk.Orientation.VERTICAL, spacing=16)
        self.main_window = main_window
        self.set_margin_left(24)
        self.set_margin_right(24)
        self.set_margin_top(24)
        self.set_margin_bottom(24)
        self._build_ui()

    def _build_ui(self):
        title = Gtk.Label()
        title.set_markup('<span size="x-large" weight="bold">Security Hardening</span>')
        title.set_xalign(0)
        self.pack_start(title, False, False, 0)

        subtitle = Gtk.Label()
        subtitle.set_markup(
            '<span size="small">Generate Content-Security-Policy, SRI tags and related '
            'headers based on your latest scan results.</span>'
        )
        subtitle.set_xalign(0)
        subtitle.get_style_context().add_class('text-secondary')
        self.pack_start(subtitle, False, False, 0)

        controls = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        gen_btn = Gtk.Button.new_with_label("Generate CSP / SRI")
        gen_btn.get_style_context().add_class('primary')
        gen_btn.connect('clicked', self._on_generate)
        controls.pack_start(gen_btn, False, False, 0)

        copy_btn = Gtk.Button.new_with_label("Copy Output")
        copy_btn.connect('clicked', self._on_copy)
        controls.pack_start(copy_btn, False, False, 0)

        save_btn = Gtk.Button.new_with_label("Save As…")
        save_btn.connect('clicked', self._on_save)
        controls.pack_start(save_btn, False, False, 0)
        self.pack_start(controls, False, False, 0)

        helper = Gtk.Label()
        helper.set_markup(
            '<span size="small">Uses the most recent scan from the Results tab. '
            'Start with <i>Report-Only</i> CSP in production, then tighten based '
            'on real traffic.</span>'
        )
        helper.set_xalign(0)
        helper.set_line_wrap(True)
        helper.get_style_context().add_class('form-helper')
        self.pack_start(helper, False, False, 0)

        self.progress = Gtk.ProgressBar()
        self.progress.set_show_text(True)
        self.progress.set_text("Ready")
        self.pack_start(self.progress, False, False, 0)

        content = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=16)
        self.pack_start(content, True, True, 0)

        checklist_frame = Gtk.Frame()
        checklist_frame.set_shadow_type(Gtk.ShadowType.NONE)
        checklist_frame.get_style_context().add_class('card')

        checklist_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)
        checklist_box.set_margin_top(10)
        checklist_box.set_margin_bottom(10)
        checklist_box.set_margin_left(12)
        checklist_box.set_margin_right(12)

        checklist_title = Gtk.Label()
        checklist_title.set_markup('<span weight="semibold">Hardening Checklist</span>')
        checklist_title.set_xalign(0)
        checklist_box.pack_start(checklist_title, False, False, 0)

        items = [
            "Review generated CSP directives and allowed domains.",
            "Roll out CSP in Report-Only mode first and watch violations.",
            "Add SRI hashes for third‑party scripts and pin versions.",
            "Document changes in your deployment / infra repo."
        ]
        for txt in items:
            l = Gtk.Label()
            l.set_markup(f'<span size="small">• {txt}</span>')
            l.set_xalign(0)
            l.set_line_wrap(True)
            l.get_style_context().add_class('text-tertiary')
            checklist_box.pack_start(l, False, False, 0)

        note_title = Gtk.Label()
        note_title.set_markup('<span weight="semibold" size="small">Output format</span>')
        note_title.set_xalign(0)
        note_title.set_margin_top(8)
        checklist_box.pack_start(note_title, False, False, 0)

        note = Gtk.Label()
        note.set_markup(
            '<span size="small">Depending on backend support, the output may be JSON '
            'with headers/snippets or directly formatted text you can paste into '
            'your server configuration.</span>'
        )
        note.set_xalign(0)
        note.set_line_wrap(True)
        note.get_style_context().add_class('text-secondary')
        checklist_box.pack_start(note, False, False, 0)

        checklist_frame.add(checklist_box)
        content.pack_start(checklist_frame, False, False, 0)

        headers_frame = Gtk.Frame()
        headers_frame.set_shadow_type(Gtk.ShadowType.NONE)
        headers_frame.get_style_context().add_class('card')

        headers_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        headers_box.set_margin_top(10)
        headers_box.set_margin_bottom(10)
        headers_box.set_margin_left(12)
        headers_box.set_margin_right(12)

        headers_title = Gtk.Label()
        headers_title.set_markup('<span weight="semibold">Proposed Headers / Snippets</span>')
        headers_title.set_xalign(0)
        headers_box.pack_start(headers_title, False, False, 0)

        scroller = Gtk.ScrolledWindow()
        scroller.set_policy(Gtk.PolicyType.AUTOMATIC, Gtk.PolicyType.AUTOMATIC)

        self.headers_view = Gtk.TextView()
        self.headers_view.set_editable(False)
        self.headers_view.set_wrap_mode(Gtk.WrapMode.WORD_CHAR)
        self.headers_view.set_cursor_visible(False)
        ctx = self.headers_view.get_style_context()
        ctx.add_class('results-area')

        self.headers_view.override_background_color(
            Gtk.StateFlags.NORMAL,
            Gdk.RGBA(red=0.141, green=0.161, blue=0.219, alpha=1.0),
        )

        buf = self.headers_view.get_buffer()
        buf.set_text(
            "💡 Hardening tips\n"
            "\n"
            "- Use 'Generate CSP / SRI' to build headers from the last scan.\n"
            "- Review allowed domains and directives before deploying.\n"
            "- Start with Report-Only mode and watch violations in logs.\n"
        )

        scroller.add(self.headers_view)

        headers_box.pack_start(scroller, True, True, 0)
        headers_frame.add(headers_box)
        content.pack_start(headers_frame, True, True, 0)

    def _set_text(self, tv: Gtk.TextView, text: str):
        buf = tv.get_buffer()
        buf.set_text(text)

    def _on_generate(self, button):
        results_view = self.main_window.views.get('results')
        last = getattr(results_view, '_last_results_data', None) if results_view else None
        if not last:
            self.main_window.app.show_error_dialog("Hardening", "No scan results available. Run a scan first.", self.main_window)
            return
        self.progress.set_fraction(0.1)
        self.progress.set_text("Generating...")
        self._set_text(self.headers_view, "")
        def run():
            # Optionally, try dedicated hardening endpoint first
            resp = self.main_window.api_client.generate_hardening(last)
            if resp.success:
                data = resp.data
                if isinstance(data, dict):
                    try:
                        pretty = json.dumps(data, indent=2)
                        GLib.idle_add(self._set_text, self.headers_view, pretty)
                    except Exception:
                        GLib.idle_add(self._set_text, self.headers_view, str(data))
                else:
                    GLib.idle_add(self._set_text, self.headers_view, str(data))
                GLib.idle_add(self.progress.set_fraction, 1.0)
                GLib.idle_add(self.progress.set_text, "Completed")
                return

            # Fallback: use local LLM and include surface analysis from backend /api/scans/:id/surface
            scan = last.get('scan', {}) or {}
            url = scan.get('url') or "the target web application"
            scan_id = scan.get('id') or self.main_window.get_current_scan_id()

            surface_data = None
            if scan_id:
                try:
                    surf_resp = self.main_window.api_client.get_scan_surface(scan_id)
                    if surf_resp.success and isinstance(surf_resp.data, dict):
                        surface_data = surf_resp.data
                except Exception:
                    # Surface enrichment is optional – ignore errors silently here
                    surface_data = None

            prompt = (
                "Given the following scan summary, libraries and HTTP/application surface analysis, "
                "propose a safe, modern Content-Security-Policy header and SRI (sha256) tags for external scripts. "
                "Output should include: 1) a recommended CSP header, 2) a short explanation of key directives, "
                "3) a list of allowed script / connect / frame domains, and 4) sample link/script tags with SRI where applicable."
            )
            context = {
                'scan': {
                    'url': url,
                    'globalRiskScore': scan.get('globalRiskScore'),
                },
                'summary': last.get('summary', {}),
                'libraries': last.get('libraries', []),
            }
            if surface_data:
                context['surface'] = surface_data

            ai = self.main_window.api_client.generate_ai_analysis(
                prompt,
                context=context,
            )
            if ai.success:
                GLib.idle_add(self._set_text, self.headers_view, str(ai.data))
                GLib.idle_add(self.progress.set_fraction, 1.0)
                GLib.idle_add(self.progress.set_text, "Completed (AI)")
            else:
                GLib.idle_add(
                    self.main_window.app.show_error_dialog,
                    "Hardening",
                    ai.error or "Generation failed",
                    self.main_window,
                )
                GLib.idle_add(self.progress.set_text, "Failed")
        threading.Thread(target=run, daemon=True).start()

    def _on_copy(self, button):
        buf = self.headers_view.get_buffer()
        text = buf.get_text(buf.get_start_iter(), buf.get_end_iter(), True)
        clipboard = Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD)
        clipboard.set_text(text, -1)
        clipboard.store()
        self.main_window.set_status_message("Copied to clipboard", 2000)

    def _on_save(self, button):
        buf = self.headers_view.get_buffer()
        text = buf.get_text(buf.get_start_iter(), buf.get_end_iter(), True)
        chooser = Gtk.FileChooserDialog(
            title="Save File",
            transient_for=self.main_window,
            action=Gtk.FileChooserAction.SAVE,
            buttons=(Gtk.STOCK_CANCEL, Gtk.ResponseType.CANCEL, Gtk.STOCK_SAVE, Gtk.ResponseType.OK),
        )
        chooser.set_current_name("hardening.txt")
        response = chooser.run()
        if response == Gtk.ResponseType.OK:
            path = chooser.get_filename()
            try:
                with open(path, 'w') as f:
                    f.write(text)
                self.main_window.set_status_message("Saved", 2000)
            except Exception as e:
                self.main_window.app.show_error_dialog("Save Error", str(e), self.main_window)
        chooser.destroy()
